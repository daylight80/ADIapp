"""Who may use the school-wide endpoints: the live diary, student allocations and the free-slot alert. No network."""
import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import server

OWNER = {"auth_user_id": "auth-owner", "email": "o@x.co", "school": {"id": "school-1", "owner_auth_id": "auth-owner"}, "user": {}}
TEACHER = {"auth_user_id": "auth-teacher", "email": "t@x.co", "school": None, "user": {}}
STRANGER = {"auth_user_id": "auth-x", "email": "x@x.co", "school": None, "user": {}}


def run(coro):
    return asyncio.run(coro)


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, "boom"

    def json(self):
        return self._rows


@pytest.fixture
def db(monkeypatch):
    log = {"gets": [], "pushes": [], "tables": {}, "status": {}}

    class FakeHttp:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, params=None):
            table = url.rsplit("/", 1)[-1]
            log["gets"].append((table, params or {}))
            return Resp(log["tables"].get(table, []), log["status"].get(table, 200))

        async def post(self, url, json=None, headers=None):
            log["pushes"].append(json)
            return Resp({"data": [{"status": "ok"} for _ in json]})

    async def school_for(auth):
        return OWNER["school"] if auth == "auth-owner" else None

    async def instructor_for(auth):
        return {"id": "instr-1"} if auth == "auth-teacher" else None

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(server, "_sb_headers", lambda *a, **k: {})
    monkeypatch.setattr(server, "_sb_rest_base", "https://db.example/rest/v1")
    monkeypatch.setattr(server, "SUPABASE_URL", "https://db.example")
    monkeypatch.setattr(server, "SUPABASE_SERVICE_ROLE_KEY", "key")
    monkeypatch.setattr(server, "sb_get_school_by_auth_user", school_for)
    monkeypatch.setattr(server, "sb_get_instructor_by_auth_user", instructor_for)
    return log


# --------------------------------------------------------------------------- the live diary (owner only)
def lesson_row(lid, school):
    return {"id": lid, "instructor_id": "instr-1", "student_id": "s1", "start_time": "2026-10-28T09:00:00", "end_time": "2026-10-28T10:00:00",
            "status": "Scheduled", "instructors": {"id": "instr-1", "full_name": "Hannah", "school_id": school}, "students": {"id": "s1", "full_name": "Ben"}}


def test_the_live_diary_is_for_the_school_owner_only(db):
    with pytest.raises(HTTPException) as e:
        run(server.v2_school_today(TEACHER))
    assert e.value.status_code == 403
    assert db["gets"] == []


def test_the_live_diary_lists_only_this_schools_lessons(db):
    db["tables"]["lessons"] = [lesson_row("mine", "school-1"), lesson_row("theirs", "school-2")]
    out = run(server.v2_school_today(OWNER))
    assert [r.lesson_id for r in out] == ["mine"]


def test_today_is_the_uk_day_in_utc_both_in_summer_and_winter():
    from datetime import datetime, timezone
    # BST: 00:30 on 1 July in London is 23:30 UTC on 30 June, and the UK day starts at 23:00 UTC.
    assert server.uk_day_bounds_utc(datetime(2026, 6, 30, 23, 30, tzinfo=timezone.utc)) == ("2026-06-30T23:00:00", "2026-07-01T23:00:00")
    # GMT: UK time equals UTC.
    assert server.uk_day_bounds_utc(datetime(2026, 12, 1, 0, 30, tzinfo=timezone.utc)) == ("2026-12-01T00:00:00", "2026-12-02T00:00:00")
    # The clocks go back on 25 Oct 2026, so that UK day is 25 hours long.
    assert server.uk_day_bounds_utc(datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)) == ("2026-10-24T23:00:00", "2026-10-26T00:00:00")


def test_the_live_diary_asks_for_the_uk_day(db, monkeypatch):
    monkeypatch.setattr(server, "uk_day_bounds_utc", lambda: ("2026-06-30T23:00:00", "2026-07-01T23:00:00"))
    run(server.v2_school_today(OWNER))
    params = next(p for t, p in db["gets"] if t == "lessons")
    assert params["start_time"] == "gte.2026-06-30T23:00:00"
    assert params["and"] == "(start_time.lt.2026-07-01T23:00:00)"


def test_a_failed_read_is_a_502_not_an_empty_diary(db):
    db["status"]["lessons"] = 500
    with pytest.raises(HTTPException) as e:
        run(server.v2_school_today(OWNER))
    assert e.value.status_code == 502


# --------------------------------------------------------------------------- student allocations (owner only)
def test_allocations_are_for_the_school_owner_only(db):
    with pytest.raises(HTTPException) as e:
        run(server.v2_school_student_allocations("2026-10-01", "2026-10-31", TEACHER))
    assert e.value.status_code == 403


def test_allocations_count_new_pupils_per_instructor_busiest_first(db):
    db["tables"]["instructors"] = [{"id": "i1", "full_name": "Sam"}, {"id": "i2", "full_name": "Hannah"}, {"id": "i3", "full_name": None}]
    db["tables"]["students"] = [{"id": "a", "instructor_id": "i2"}, {"id": "b", "instructor_id": "i2"}, {"id": "c", "instructor_id": "i1"}]
    out = run(server.v2_school_student_allocations("2026-10-01", "2026-10-31", OWNER))
    assert out.total == 3
    assert [(r.full_name, r.student_count) for r in out.rows] == [("Hannah", 2), ("Sam", 1), ("(unnamed)", 0)]
    students_call = next(p for t, p in db["gets"] if t == "students")
    assert students_call["school_id"] == "eq.school-1"


@pytest.mark.parametrize("a,b", [("01/10/2026", "2026-10-31"), ("2026-10-31", "2026-10-01")])
def test_allocations_refuse_bad_or_backwards_dates(db, a, b):
    with pytest.raises(HTTPException) as e:
        run(server.v2_school_student_allocations(a, b, OWNER))
    assert e.value.status_code == 400


# --------------------------------------------------------------------------- free-slot alert
S1 = "11111111-1111-4111-8111-111111111111"
S2 = "22222222-2222-4222-8222-222222222222"
LESSON = {"id": "les-1", "instructor_id": "instr-1", "start_time": "2026-10-30T10:00:00", "end_time": "2026-10-30T11:00:00", "topic": "x", "instructors": {"school_id": "school-1"}}


def alert(user, **kw):
    return run(server.broadcast_gap(server.GapBroadcastRequest(lesson_id="les-1", **kw), user))


def test_the_alert_for_an_unknown_lesson_is_a_404(db):
    with pytest.raises(HTTPException) as e:
        alert(OWNER)
    assert e.value.status_code == 404


def test_someone_who_neither_owns_the_school_nor_teaches_the_lesson_is_refused(db):
    db["tables"]["lessons"] = [LESSON]
    with pytest.raises(HTTPException) as e:
        alert(STRANGER)
    assert e.value.status_code == 403
    assert db["pushes"] == []


def test_a_picked_list_is_limited_to_the_lessons_own_school_and_only_those_with_tokens_are_pushed(db):
    db["tables"]["lessons"] = [LESSON]
    db["tables"]["students"] = [{"id": "s1", "auth_user_id": "u1", "full_name": "Ben"}, {"id": "s2", "auth_user_id": "u2", "full_name": "Priya"}]
    db["tables"]["push_tokens"] = [{"auth_user_id": "u1", "expo_token": "ExponentPushToken[a]"}]
    out = alert(TEACHER, student_ids=[S1, S2])
    students_call = next(p for t, p in db["gets"] if t == "students")
    assert students_call["school_id"] == "eq.school-1"
    assert out.sent == 1 and out.skipped == 1
    assert [m["to"] for m in db["pushes"][0]] == ["ExponentPushToken[a]"]


def test_nobody_with_a_push_token_means_nothing_is_sent(db):
    db["tables"]["lessons"] = [LESSON]
    db["tables"]["students"] = [{"id": "s1", "auth_user_id": "u1", "full_name": "Ben"}]
    out = alert(OWNER, student_ids=[S1])
    assert out.sent == 0
    assert db["pushes"] == []


def test_a_teacher_who_is_not_the_owner_reaches_only_their_own_pupils(db):
    db["tables"]["lessons"] = [LESSON]
    alert(TEACHER, student_ids=[S1])
    students_call = next(p for t, p in db["gets"] if t == "students")
    assert students_call["instructor_id"] == "eq.instr-1"


def test_the_owner_is_not_limited_to_one_instructors_pupils(db):
    db["tables"]["lessons"] = [LESSON]
    alert(OWNER, student_ids=[S1])
    students_call = next(p for t, p in db["gets"] if t == "students")
    assert "instructor_id" not in students_call


def test_the_active_pupils_added_by_the_plus_active_mode_are_also_own_pupils_only_for_a_teacher(db):
    db["tables"]["lessons"] = [LESSON]
    alert(TEACHER, target="longest_waiting_plus_active")
    active_call = next(p for t, p in db["gets"] if t == "students")
    assert active_call["status"] == "eq.Active" and active_call["instructor_id"] == "eq.instr-1"


def test_the_picked_list_is_capped_and_must_be_real_ids():
    server.GapBroadcastRequest(lesson_id="l", student_ids=[S1] * 100)
    with pytest.raises(ValidationError):
        server.GapBroadcastRequest(lesson_id="l", student_ids=[S1] * 101)
    with pytest.raises(ValidationError):
        server.GapBroadcastRequest(lesson_id="l", student_ids=["x),school_id.neq.1"])
