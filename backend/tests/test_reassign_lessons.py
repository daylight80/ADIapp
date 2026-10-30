"""Reassigning a pupil moves their booked lessons too, because a lesson is visible only to the instructor named on
it. No network."""
import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import server

OWNER = {"auth_user_id": "auth-owner", "email": "o@x.co", "school": {"id": "school-1", "owner_auth_id": "auth-owner"}, "user": {}}


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, "boom"

    def json(self):
        return self._rows


@pytest.fixture
def db(monkeypatch):
    log = {"patches": [], "lessons_status": 200, "b_auth": "auth-b"}
    names = {"stu-1": "Dayana Arachchige", "stu-2": "Ben Carter"}

    class FakeHttp:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, params=None):
            table = url.rsplit("/", 1)[-1]
            if table == "instructors":
                return Resp([{"id": "instr-a", "auth_user_id": "auth-a"}, {"id": "instr-b", "auth_user_id": log["b_auth"]}])
            if table == "students":
                sid = params["id"].removeprefix("eq.")
                return Resp([{"id": sid, "instructor_id": "instr-a", "full_name": names[sid]}] if sid in names else [])
            return Resp([])

        async def patch(self, url, headers=None, params=None, json=None):
            table = url.rsplit("/", 1)[-1]
            log["patches"].append((table, params, json))
            return Resp([], log["lessons_status"] if table == "lessons" else 204)

    async def owner(_u):
        return True

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(server, "_sb_headers", lambda *a, **k: {})
    monkeypatch.setattr(server, "_sb_rest_base", "https://db.example/rest/v1")
    monkeypatch.setattr(server, "_is_school_owner", owner)
    return log


def reassign(*pairs):
    req = server.ReassignStudentsRequest(assignments=[{"student_id": s, "new_instructor_id": i} for s, i in pairs])
    return asyncio.run(server.v2_reassign_students(req, OWNER))


def test_the_pupils_future_scheduled_lessons_move_with_them(db):
    out = reassign(("stu-1", "instr-b"))
    assert out.moved == 1 and out.errors == []
    tables = [p[0] for p in db["patches"]]
    assert tables == ["students", "lessons"]
    _, params, body = db["patches"][1]
    assert body == {"instructor_id": "instr-b"}
    assert params["student_id"] == "eq.stu-1" and params["status"] == "eq.Scheduled" and params["start_time"].startswith("gte.")


def test_a_pupil_already_with_that_instructor_changes_nothing(db):
    out = reassign(("stu-1", "instr-a"))
    assert out.moved == 0 and out.skipped == 1
    assert db["patches"] == []


def test_a_target_outside_the_school_is_refused_and_nothing_moves(db):
    out = reassign(("stu-1", "someone-else"))
    assert out.moved == 0 and out.skipped == 1
    assert db["patches"] == []


def test_a_failure_moving_the_lessons_is_reported(db):
    db["lessons_status"] = 500
    out = reassign(("stu-1", "instr-b"))
    assert out.moved == 1
    assert any("booked lessons could not be moved" in e for e in out.errors)


def test_one_request_takes_at_most_100_pupils():
    pairs = [{"student_id": f"s{i}", "new_instructor_id": "instr-b"} for i in range(101)]
    server.ReassignStudentsRequest(assignments=pairs[:100])
    with pytest.raises(ValidationError):
        server.ReassignStudentsRequest(assignments=pairs)


def test_only_the_school_owner_may_reassign(monkeypatch, db):
    async def not_owner(_u):
        return False

    monkeypatch.setattr(server, "_is_school_owner", not_owner)
    with pytest.raises(HTTPException) as e:
        reassign(("stu-1", "instr-b"))
    assert e.value.status_code == 403
    assert db["patches"] == []


# --- The new instructor is told by push when pupils are moved to them ---
import lesson_reminders as lr  # noqa: E402


@pytest.fixture
def push(monkeypatch):
    sent = {"messages": [], "tokens": {"auth-b": ["ExponentPushToken[b]"]}, "fail": False}

    async def tokens(auth_user_id):
        return sent["tokens"].get(auth_user_id, [])

    async def send(messages):
        if sent["fail"]:
            raise RuntimeError("expo down")
        sent["messages"].extend(messages)
        return {"accepted": len(messages), "receipt_ids": []}

    monkeypatch.setattr(lr, "_push_tokens_for_user", tokens)
    monkeypatch.setattr(lr, "_send_push", send)
    return sent


def test_only_the_allocated_instructor_gets_a_push_and_it_names_nobody(db, push):
    push["tokens"]["auth-a"] = ["ExponentPushToken[a]"]  # the previous instructor must not be told
    out = reassign(("stu-1", "instr-b"))
    assert out.moved == 1 and out.notified == 1
    [msg] = push["messages"]
    assert msg["to"] == "ExponentPushToken[b]"
    assert (msg["title"], msg["body"]) == ("New Student Allocation", "Check DualControl for more details")


def test_several_pupils_make_one_push(db, push):
    out = reassign(("stu-1", "instr-b"), ("stu-2", "instr-b"))
    assert out.moved == 2 and out.notified == 1
    assert len(push["messages"]) == 1


def test_an_instructor_with_no_phone_registered_is_not_notified_but_the_pupil_still_moves(db, push):
    push["tokens"].clear()
    out = reassign(("stu-1", "instr-b"))
    assert out.moved == 1 and out.notified == 0 and push["messages"] == []


def test_a_push_failure_does_not_undo_the_move(db, push):
    push["fail"] = True
    out = reassign(("stu-1", "instr-b"))
    assert out.moved == 1 and out.notified == 0
    assert [p[0] for p in db["patches"]] == ["students", "lessons"]


def test_the_owner_moving_a_pupil_to_themselves_is_not_pushed(db, push):
    db["b_auth"] = "auth-owner"
    push["tokens"]["auth-owner"] = ["ExponentPushToken[owner]"]
    out = reassign(("stu-1", "instr-b"))
    assert out.moved == 1 and out.notified == 0 and push["messages"] == []


def test_nothing_is_pushed_for_a_pupil_who_did_not_move(db, push):
    out = reassign(("stu-1", "instr-a"))
    assert out.moved == 0 and push["messages"] == []
