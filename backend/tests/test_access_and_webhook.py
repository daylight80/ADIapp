"""Two things that decide money and access, run for real against a fake database and a fake Stripe. No network.

1. The Stripe webhook must answer with an error when it fails, so Stripe retries (a 200 drops the upgrade for good).
2. Changing a pupil's status, deleting a pupil and sending a free-slot alert must work for an instructor who is not the
   school owner (a Franchise instructor), and still refuse someone else's pupil."""
import asyncio

import httpx
import pytest
from fastapi import HTTPException

import server


def run(coro):
    return asyncio.run(coro)


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, ""

    def json(self):
        return self._rows


# --------------------------------------------------------------------------- the webhook
class FakeRequest:
    headers = {"Stripe-Signature": "sig"}

    async def body(self):
        return b"{}"


@pytest.fixture
def webhook(monkeypatch):
    monkeypatch.setattr(server, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    state = {"updates": [], "fail_with": None}

    def construct(payload, sig, secret):
        return {"type": "customer.subscription.deleted", "data": {"object": {"customer": "cus_1"}}}

    async def by_customer(_cid):
        return {"id": "school-1", "is_comp_account": False}

    async def update(school_id, patch):
        if state["fail_with"]:
            raise state["fail_with"]
        state["updates"].append((school_id, patch))
        return {}

    monkeypatch.setattr(server.stripe.Webhook, "construct_event", staticmethod(construct))
    monkeypatch.setattr(server, "sb_get_school_by_customer", by_customer)
    monkeypatch.setattr(server, "sb_update_school", update)
    return state


def test_webhook_applies_a_cancellation(webhook):
    out = run(server.stripe_webhook(FakeRequest()))
    assert out["handled"] is True
    assert webhook["updates"][0][0] == "school-1"
    assert webhook["updates"][0][1]["tier"] == "starter"


def test_webhook_answers_with_an_error_when_the_database_times_out_so_stripe_retries(webhook):
    webhook["fail_with"] = httpx.ReadTimeout("timed out")
    with pytest.raises(HTTPException) as e:
        run(server.stripe_webhook(FakeRequest()))
    assert e.value.status_code == 500


def test_webhook_still_rejects_a_bad_signature(monkeypatch):
    monkeypatch.setattr(server, "STRIPE_WEBHOOK_SECRET", "whsec_test")

    def bad(*a, **k):
        raise ValueError("bad signature")

    monkeypatch.setattr(server.stripe.Webhook, "construct_event", staticmethod(bad))
    with pytest.raises(HTTPException) as e:
        run(server.stripe_webhook(FakeRequest()))
    assert e.value.status_code == 400


# --------------------------------------------------------------------------- who may manage a pupil
INSTR_A = {"id": "instr-a"}
INSTR_B = {"id": "instr-b"}
PUPIL_OF_A = {"id": "stu-a", "school_id": "school-1", "instructor_id": "instr-a", "auth_user_id": None, "full_name": "Sam", "email": "s@x.co"}
PUPIL_OF_B = {**PUPIL_OF_A, "id": "stu-b", "instructor_id": "instr-b"}


def sb_user(auth_id, school=None):
    return {"auth_user_id": auth_id, "email": f"{auth_id}@x.co", "school": school, "user": {}}


# A Franchise instructor who is not the owner has no school of their own, so sb_user["school"] is None.
NON_OWNER_A = sb_user("auth-a")
OWNER = sb_user("auth-owner", {"id": "school-1", "owner_auth_id": "auth-owner"})
INSTRUCTORS = {"auth-a": INSTR_A, "auth-b": INSTR_B}


@pytest.fixture
def db(monkeypatch):
    log = {"patches": [], "deletes": [], "lesson": {"id": "les-1", "instructor_id": "instr-a", "start_time": "2026-10-30T10:00:00", "end_time": "2026-10-30T11:00:00", "topic": "x", "instructors": {"school_id": "school-1"}}}
    pupils = {p["id"]: p for p in (PUPIL_OF_A, PUPIL_OF_B)}

    class FakeHttp:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, params=None):
            table = url.rsplit("/", 1)[-1]
            params = params or {}
            if table == "students":
                sid = params.get("id", "").replace("eq.", "")
                return Resp([pupils[sid]] if sid in pupils else [])
            if table == "instructors":
                auth = params.get("auth_user_id", "").replace("eq.", "")
                return Resp([INSTRUCTORS[auth]] if auth in INSTRUCTORS else [])
            if table == "lessons":
                return Resp([log["lesson"]])
            if table == "driving_schools":
                return Resp([])
            return Resp([])

        async def patch(self, url, headers=None, params=None, json=None):
            log["patches"].append((params, json))
            return Resp([{"status": (json or {}).get("status", "Active")}])

        async def delete(self, url, headers=None, params=None):
            log["deletes"].append(params)
            return Resp([], 204)

    async def instructor_for(auth):
        return INSTRUCTORS.get(auth)

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(server, "_sb_headers", lambda *a, **k: {})
    monkeypatch.setattr(server, "_sb_rest_base", "https://db.example/rest/v1")
    monkeypatch.setattr(server, "SUPABASE_URL", "https://db.example")
    monkeypatch.setattr(server, "SUPABASE_SERVICE_ROLE_KEY", "key")
    monkeypatch.setattr(server, "sb_get_instructor_by_auth_user", instructor_for)
    return log


def set_status(user, student_id, status="Active"):
    return run(server.v2_update_student_status(student_id, server.StudentStatusPatch(status=status), user))


def test_a_non_owner_instructor_can_change_the_status_of_their_own_pupil(db):
    out = set_status(NON_OWNER_A, "stu-a", "Test Ready")
    assert out.ok and out.status == "Test Ready"


def test_a_non_owner_instructor_can_delete_their_own_pupil(db):
    out = run(server.v2_delete_student("stu-a", NON_OWNER_A))
    assert out.ok
    assert db["deletes"] == [{"id": "eq.stu-a"}]


def test_an_instructor_cannot_touch_another_instructors_pupil(db):
    with pytest.raises(HTTPException) as e:
        set_status(NON_OWNER_A, "stu-b")
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        run(server.v2_delete_student("stu-b", NON_OWNER_A))
    assert e.value.status_code == 403
    assert db["patches"] == [] and db["deletes"] == []


def test_the_school_owner_can_manage_any_pupil_in_their_school(db):
    assert set_status(OWNER, "stu-b", "Inactive").ok


def test_a_missing_pupil_is_a_404(db):
    with pytest.raises(HTTPException) as e:
        set_status(NON_OWNER_A, "nobody")
    assert e.value.status_code == 404


# --------------------------------------------------------------------------- free-slot alert
def broadcast(user):
    return run(server.broadcast_gap(server.GapBroadcastRequest(lesson_id="les-1"), user))


def test_the_instructor_who_teaches_a_lesson_can_send_its_free_slot_alert_without_owning_the_school(db):
    out = broadcast(NON_OWNER_A)
    assert out.sent == 0 and "waiting list" in out.detail  # got past the ownership check; nobody is on the list


def test_another_instructor_cannot_send_a_free_slot_alert_for_someone_elses_lesson(db):
    with pytest.raises(HTTPException) as e:
        broadcast(sb_user("auth-b"))
    assert e.value.status_code == 403


def test_the_school_owner_can_send_a_free_slot_alert_for_any_lesson_in_their_school(db):
    assert broadcast(OWNER).sent == 0
