"""Pure unit tests for slot alerts (pupils told when a lesson is cancelled) — no network, no
running backend, no Supabase. Everything that would touch the outside world is patched.

Rules under test (see backend/slot_alerts.py):
  tell the instructor's pupils who have alerts on and an app login, waiting pupils first, at most
  10 a slot and 3 a week each; never the pupil whose lesson it was, anyone busy at that time, or
  Passed/Inactive pupils; paid plans only; a cancellation is announced once and only if the slot
  is still free.
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lesson_reminders as lr  # noqa: E402
import slot_alerts as sa  # noqa: E402

# A Thursday afternoon in October (BST: UTC+1), so 13:00Z is 14:00 UK.
LESSON = {
    "id": "L1", "instructor_id": "I1", "student_id": "S0",
    "start_time": "2026-10-15T13:00:00+00:00", "end_time": "2026-10-15T14:00:00+00:00",
    "instructors": {"full_name": "Grant Robery", "driving_schools": {"tier": "pro"}},
}


def pupil(pid, status="Active", alerts=True, auth="auth-1", name=None):
    return {"id": pid, "auth_user_id": auth, "status": status, "slot_alerts": alerts, "full_name": name or pid}


# --------------------------------------------------------------------------- overlap


@pytest.mark.parametrize("a,b,expected", [
    (("13:00", "14:00"), ("13:30", "14:30"), True),
    (("13:00", "14:00"), ("12:00", "13:30"), True),
    (("13:00", "14:00"), ("13:15", "13:45"), True),
    (("13:00", "14:00"), ("14:00", "15:00"), False),  # touching ends do not overlap
    (("13:00", "14:00"), ("11:00", "13:00"), False),
])
def test_overlaps(a, b, expected):
    f = lambda t: f"2026-10-15T{t}:00+00:00"  # noqa: E731
    assert sa.overlaps(f(a[0]), f(a[1]), f(b[0]), f(b[1])) is expected


# --------------------------------------------------------------------------- message


def test_message_shows_uk_time_range_and_the_instructors_first_name():
    m = sa.slot_message(LESSON["start_time"], LESSON["end_time"], "Grant Robery")
    assert m["title"] == "A lesson slot has opened"
    assert m["body"] == "Thu 15 Oct, 14:00-15:00 with Grant. Contact your instructor to book it."


def test_message_without_an_instructor_name_still_reads_well():
    m = sa.slot_message(LESSON["start_time"], LESSON["end_time"], None)
    assert "with your instructor" in m["body"]


# --------------------------------------------------------------------------- recipients


def test_tells_active_pupils_with_alerts_on_and_an_app_login():
    out = sa.choose_recipients([pupil("A"), pupil("B")], LESSON, {}, {})
    assert [p["id"] for p in out] == ["A", "B"]


def test_never_tells_the_pupil_whose_lesson_it_was():
    out = sa.choose_recipients([pupil("S0"), pupil("A")], LESSON, {}, {})
    assert [p["id"] for p in out] == ["A"]


def test_skips_pupils_who_switched_alerts_off_or_have_no_app_login():
    out = sa.choose_recipients([pupil("A", alerts=False), pupil("B", auth=None), pupil("C")], LESSON, {}, {})
    assert [p["id"] for p in out] == ["C"]


@pytest.mark.parametrize("status", ["Passed", "Inactive", "Archived", None])
def test_skips_pupils_who_are_not_learning_now(status):
    assert sa.choose_recipients([pupil("A", status=status)], LESSON, {}, {}) == []


def test_waiting_pupils_first_then_test_ready_then_active_then_new():
    pupils = [pupil("a", "New"), pupil("b", "Active"), pupil("c", "Test Ready"), pupil("d", "Waitlist")]
    assert [p["id"] for p in sa.choose_recipients(pupils, LESSON, {}, {})] == ["d", "c", "b", "a"]


def test_skips_a_pupil_who_already_has_a_lesson_at_that_time_but_not_one_just_after():
    busy = {
        "A": [("2026-10-15T13:30:00+00:00", "2026-10-15T14:30:00+00:00")],
        "B": [("2026-10-15T14:00:00+00:00", "2026-10-15T15:00:00+00:00")],
    }
    out = sa.choose_recipients([pupil("A"), pupil("B")], LESSON, busy, {})
    assert [p["id"] for p in out] == ["B"]


def test_skips_a_pupil_who_has_had_three_alerts_this_week():
    out = sa.choose_recipients([pupil("A"), pupil("B")], LESSON, {}, {"A": 3, "B": 2})
    assert [p["id"] for p in out] == ["B"]


def test_tells_at_most_ten_pupils_a_slot():
    pupils = [pupil(f"p{i:02d}") for i in range(25)]
    assert len(sa.choose_recipients(pupils, LESSON, {}, {})) == 10


# --------------------------------------------------------------------------- dispatch


class World:
    """A fake of everything slot_alerts reads and writes, with a record of what it sent."""

    def __init__(self, monkeypatch, *, lessons=(LESSON,), pupils=(), claim=True, taken=False, tokens=("ExpoPushToken[x]",),
                 push_ok=True, busy=None, recent=None):
        self.sent, self.logged, self.claimed = [], [], []
        self.lessons, self.pupils = list(lessons), list(pupils)

        async def find(now): return self.lessons
        async def claim_(lid, now): self.claimed.append(lid); return claim
        async def taken_(lesson): return taken
        async def pupils_of(iid): return self.pupils
        async def busy_map(ids, lesson): return busy or {}
        async def recent_counts(ids, now): return recent or {}
        async def log_sent(sid, lid, n): self.logged.append((sid, lid, n))
        async def token_lookup(auth): return list(tokens)
        async def send_push(messages):
            self.sent.extend(messages)
            return {"accepted": len(messages) if push_ok else 0, "receipt_ids": []}

        monkeypatch.setattr(sa, "_find_cancelled", find)
        monkeypatch.setattr(sa, "_claim", claim_)
        monkeypatch.setattr(sa, "_slot_taken", taken_)
        monkeypatch.setattr(sa, "_pupils_of", pupils_of)
        monkeypatch.setattr(sa, "_busy_map", busy_map)
        monkeypatch.setattr(sa, "_recent_counts", recent_counts)
        monkeypatch.setattr(sa, "_log_sent", log_sent)
        monkeypatch.setattr(lr, "_push_tokens_for_user", token_lookup)
        monkeypatch.setattr(lr, "_send_push", send_push)
        monkeypatch.setattr(lr, "_sb_url", lambda: "http://sb")
        monkeypatch.setattr(lr, "_sb_key", lambda: "key")


def run():
    return asyncio.run(sa.dispatch_slot_alerts())


def test_announces_a_freed_slot_to_the_right_pupils_and_records_it(monkeypatch):
    w = World(monkeypatch, pupils=[pupil("A"), pupil("S0"), pupil("B", alerts=False)])
    summary = run()
    assert summary["announced"] == 1 and summary["pupils_told"] == 1
    assert [m["to"] for m in w.sent] == ["ExpoPushToken[x]"]
    assert w.sent[0]["title"] == "A lesson slot has opened"
    assert w.sent[0]["data"] == {"kind": "slot_alert", "lessonId": "L1"}
    assert w.logged == [("A", "L1", 1)]


def test_a_starter_plan_instructor_sends_nothing(monkeypatch):
    starter = {**LESSON, "instructors": {"full_name": "G", "driving_schools": {"tier": "starter"}}}
    w = World(monkeypatch, lessons=[starter], pupils=[pupil("A")])
    summary = run()
    assert summary["skipped_tier"] == 1 and w.sent == [] and w.claimed == []


def test_a_cancellation_already_claimed_is_not_announced_again(monkeypatch):
    w = World(monkeypatch, pupils=[pupil("A")], claim=False)
    summary = run()
    assert summary["skipped_claimed"] == 1 and w.sent == []


def test_a_slot_that_has_been_filled_again_is_not_announced(monkeypatch):
    w = World(monkeypatch, pupils=[pupil("A")], taken=True)
    summary = run()
    assert summary["skipped_taken"] == 1 and w.sent == [] and w.claimed == ["L1"]


def test_a_pupil_with_no_device_is_not_counted_as_told(monkeypatch):
    w = World(monkeypatch, pupils=[pupil("A")], tokens=())
    summary = run()
    assert summary["pupils_told"] == 0 and w.logged == []


def test_a_push_the_service_refuses_is_not_recorded_as_sent(monkeypatch):
    w = World(monkeypatch, pupils=[pupil("A")], push_ok=False)
    summary = run()
    assert summary["pupils_told"] == 0 and w.logged == []


def test_each_device_of_a_pupil_gets_the_message_but_it_counts_once(monkeypatch):
    w = World(monkeypatch, pupils=[pupil("A")], tokens=("ExpoPushToken[1]", "ExpoPushToken[2]"))
    summary = run()
    assert len(w.sent) == 2 and summary["pupils_told"] == 1 and w.logged == [("A", "L1", 2)]


def test_does_nothing_when_supabase_is_not_configured(monkeypatch):
    World(monkeypatch)
    monkeypatch.setattr(lr, "_sb_url", lambda: None)
    assert run()["ok"] is False
