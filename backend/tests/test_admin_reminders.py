"""Pure unit tests for the instructor deadline reminders — no network, no running
backend, no Supabase. Everything that would touch the outside world is patched.

Rules under test (see backend/admin_reminders.py):
  stage by days left:  8-30 -> d30 | 2-7 -> d7 | 0-1 -> d1 | -30..-1 -> overdue
  paid plans only; each (instructor, deadline, due date, stage) is sent once;
  email AND push when both are possible; a run where everything failed is retried.
"""
import asyncio
import os
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import admin_reminders as ar  # noqa: E402
import email_service  # noqa: E402
import lesson_reminders as lr  # noqa: E402

TODAY = date(2026, 9, 28)


def item(kind="mot", days=5, instructor="i1", key=None, label=None):
    return {
        "item_key": key or f"key-{kind}",
        "instructor_id": instructor,
        "kind": kind,
        "label": label,
        "due_date": (TODAY + timedelta(days=days)).isoformat(),
    }


def instructor(iid="i1", tier="pro", email="alex@example.com", auth="auth-1"):
    return {"id": iid, "full_name": "Alex Morgan", "email": email, "auth_user_id": auth,
            "driving_schools": {"tier": tier}}


# --- stage boundaries ---------------------------------------------------------

@pytest.mark.parametrize("days,stage", [
    (45, None), (31, None),
    (30, "d30"), (15, "d30"), (8, "d30"),
    (7, "d7"), (4, "d7"), (2, "d7"),
    (1, "d1"), (0, "d1"),
    (-1, "overdue"), (-15, "overdue"), (-30, "overdue"),
    (-31, None), (-400, None),
])
def test_stage_for(days, stage):
    assert ar.stage_for(days) == stage


def test_every_stage_is_one_the_database_allows():
    # the CHECK constraint on deadline_reminder_log.stage
    assert set(ar.STAGES) == {"d30", "d7", "d1", "overdue"}
    assert {ar.stage_for(d) for d in range(-30, 31)} == set(ar.STAGES)


# --- dates --------------------------------------------------------------------

def test_uk_today_uses_uk_not_utc():
    # 23:30 UTC on 30 June is 00:30 on 1 July in the UK (BST)
    assert ar.uk_today(datetime(2026, 6, 30, 23, 30, tzinfo=timezone.utc)) == date(2026, 7, 1)
    # in winter there is no offset
    assert ar.uk_today(datetime(2026, 12, 10, 23, 30, tzinfo=timezone.utc)) == date(2026, 12, 10)


def test_format_due_date():
    assert ar.format_due_date(date(2026, 10, 8)) == "Thursday 8 October 2026"
    assert ar.format_due_date(date(2027, 3, 1)) == "Monday 1 March 2027"


def test_parse_due_date():
    assert ar.parse_due_date("2026-10-08") == date(2026, 10, 8)
    assert ar.parse_due_date("2026-10-08T00:00:00+00:00") == date(2026, 10, 8)
    assert ar.parse_due_date("garbage") is None and ar.parse_due_date(None) is None


# --- plan_reminders ------------------------------------------------------------

def plan(items, instructors=None, sent=(), today=TODAY):
    return ar.plan_reminders(items, instructors or {"i1": instructor()}, set(sent), today)


def test_plans_one_reminder_per_deadline_in_a_stage():
    p = plan([item("mot", 5), item("insurance", 20), item("road_tax", 60)])
    assert [(r["item"]["kind"], r["stage"]) for r in p] == [("mot", "d7"), ("insurance", "d30")]  # 60 days: too far off
    assert p[0]["days_left"] == 5 and p[0]["due"] == TODAY + timedelta(days=5)


def test_starter_plan_gets_nothing():
    assert plan([item("mot", 5)], {"i1": instructor(tier="starter")}) == []


def test_unknown_or_legacy_tier_is_treated_as_starter():
    assert plan([item("mot", 5)], {"i1": instructor(tier="growth")}) == []
    assert plan([item("mot", 5)], {"i1": instructor(tier=None)}) == []


@pytest.mark.parametrize("tier", ["pro", "franchise"])
def test_paid_plans_are_included(tier):
    assert len(plan([item("mot", 5)], {"i1": instructor(tier=tier)})) == 1


def test_already_sent_stage_is_not_repeated():
    it = item("mot", 5)
    sent = [("i1", it["item_key"], it["due_date"], "d7")]
    assert plan([it], sent=sent) == []


def test_a_different_stage_or_due_date_is_not_blocked_by_an_old_log_row():
    it = item("mot", 5)
    # d30 already went out earlier for this same date; today is a new stage (d7)
    assert len(plan([it], sent=[("i1", it["item_key"], it["due_date"], "d30")])) == 1
    # the MOT was renewed: new due date, so an old d7 for the OLD date must not block it
    old = (TODAY - timedelta(days=300)).isoformat()
    assert len(plan([it], sent=[("i1", it["item_key"], old, "d7")])) == 1


def test_overdue_is_sent_once_within_the_grace_window_only():
    assert plan([item("mot", -3)])[0]["stage"] == "overdue"
    assert plan([item("mot", -45)]) == []


def test_unknown_instructor_and_bad_dates_are_skipped():
    assert plan([item("mot", 5, instructor="nobody")]) == []
    bad = item("mot", 5)
    bad["due_date"] = "not-a-date"
    assert plan([bad]) == []


def test_each_instructor_is_judged_on_their_own_plan():
    both = {"i1": instructor("i1", tier="pro"), "i2": instructor("i2", tier="starter")}
    p = plan([item("mot", 5, "i1"), item("mot", 5, "i2")], both)
    assert [r["instructor"]["id"] for r in p] == ["i1"]


# --- delivery -----------------------------------------------------------------

class Rec:
    def __init__(self, monkeypatch, *, tokens=("ExpoPushToken[a]",), email_ok=True, push_ok=True, configured=True):
        self.emails, self.pushes, self.logs, self.token_lookups = [], [], [], 0
        self.tokens, self.email_ok, self.push_ok = list(tokens), email_ok, push_ok

        async def fake_email(rem):
            self.emails.append(rem["stage"])
            return self.email_ok

        async def fake_push(rem, tokens):
            self.pushes.append(rem["stage"])
            return self.push_ok

        async def fake_tokens(_uid):
            self.token_lookups += 1
            return self.tokens

        async def fake_log(rem, channels):
            self.logs.append((rem["item"]["item_key"], rem["stage"], channels))
            return True

        monkeypatch.setattr(ar, "_send_email", fake_email)
        monkeypatch.setattr(ar, "_send_push", fake_push)
        monkeypatch.setattr(lr, "_push_tokens_for_user", fake_tokens)
        monkeypatch.setattr(ar, "_log_sent", fake_log)
        monkeypatch.setattr(email_service, "is_configured", lambda: configured)

    def deliver(self, **inst):
        rem = plan([item("mot", 5)], {"i1": instructor(**inst)})[0]
        return asyncio.run(ar._deliver(rem))


def test_email_and_push_both_go_when_both_possible(monkeypatch):
    r = Rec(monkeypatch)
    assert r.deliver() == "email+push"
    assert len(r.emails) == 1 and len(r.pushes) == 1


def test_email_only_when_no_device_token(monkeypatch):
    r = Rec(monkeypatch, tokens=())
    assert r.deliver() == "email" and r.pushes == []


def test_push_only_when_no_email_address(monkeypatch):
    r = Rec(monkeypatch)
    assert r.deliver(email=None) == "push" and r.emails == []


def test_push_only_when_email_is_not_configured_and_that_is_not_a_failure(monkeypatch):
    r = Rec(monkeypatch, configured=False)
    assert r.deliver() == "push" and r.emails == []


def test_one_channel_failing_still_counts_if_the_other_worked(monkeypatch):
    assert Rec(monkeypatch, email_ok=False).deliver() == "push"
    assert Rec(monkeypatch, push_ok=False).deliver() == "email"


def test_everything_failing_is_a_retry(monkeypatch):
    assert Rec(monkeypatch, email_ok=False, push_ok=False).deliver() == "retry"


def test_nobody_reachable_is_none_not_retry(monkeypatch):
    assert Rec(monkeypatch, tokens=()).deliver(email=None) == "none"
    # email not configured and no tokens: nothing was attempted, so nothing to retry
    assert Rec(monkeypatch, tokens=(), configured=False).deliver() == "none"


@pytest.mark.parametrize("bad", ["", "nope", "a@b", None])
def test_invalid_instructor_email_is_treated_as_no_email(monkeypatch, bad):
    r = Rec(monkeypatch, tokens=())
    assert r.deliver(email=bad) == "none" and r.emails == []


def test_no_auth_user_means_no_push_lookup(monkeypatch):
    r = Rec(monkeypatch)
    assert r.deliver(auth=None) == "email" and r.token_lookups == 0


# --- the whole run ------------------------------------------------------------

def run_dispatch(monkeypatch, items, instructors, sent=(), **rec):
    r = Rec(monkeypatch, **rec)

    async def fake_items(_today): return items
    async def fake_instructors(_ids): return instructors
    async def fake_sent(_ids, _today): return set(sent)

    monkeypatch.setattr(ar, "_fetch_items", fake_items)
    monkeypatch.setattr(ar, "_fetch_instructors", fake_instructors)
    monkeypatch.setattr(ar, "_fetch_sent", fake_sent)
    monkeypatch.setattr(ar, "uk_today", lambda now=None: TODAY)
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")
    return r, asyncio.run(ar.dispatch_deadline_reminders())


def test_run_sends_and_logs_each_due_reminder(monkeypatch):
    items = [item("mot", 5), item("insurance", 20), item("road_tax", 90)]
    r, summary = run_dispatch(monkeypatch, items, {"i1": instructor()})
    assert summary["ok"] and summary["due_now"] == 2 and summary["email+push"] == 2
    assert [(k, s) for k, s, _ in r.logs] == [("key-mot", "d7"), ("key-insurance", "d30")]


def test_run_does_not_log_a_failed_attempt_so_it_retries_tomorrow(monkeypatch):
    r, summary = run_dispatch(monkeypatch, [item("mot", 5)], {"i1": instructor()}, email_ok=False, push_ok=False)
    assert summary["retry"] == 1 and r.logs == []


def test_run_logs_an_unreachable_instructor_so_it_stops_rechecking(monkeypatch):
    r, summary = run_dispatch(monkeypatch, [item("mot", 5)], {"i1": instructor(email=None, auth=None)})
    assert summary["none"] == 1 and r.logs == [("key-mot", "d7", "none")]


def test_a_second_run_sends_nothing_new(monkeypatch):
    it = item("mot", 5)
    sent = {("i1", it["item_key"], it["due_date"], "d7")}
    r, summary = run_dispatch(monkeypatch, [it], {"i1": instructor()}, sent=sent)
    assert summary["due_now"] == 0 and r.emails == [] and r.pushes == [] and r.logs == []


def test_run_with_nothing_to_do(monkeypatch):
    _, summary = run_dispatch(monkeypatch, [], {})
    assert summary == {"ok": True, "candidates": 0, "sent": 0}


def test_run_skips_everything_if_it_cannot_read_the_sent_log(monkeypatch):
    r = Rec(monkeypatch)

    async def fake_items(_today): return [item("mot", 5)]
    async def fake_instructors(_ids): return {"i1": instructor()}
    async def broken_sent(_ids, _today): raise RuntimeError("log read failed: 500")

    monkeypatch.setattr(ar, "_fetch_items", fake_items)
    monkeypatch.setattr(ar, "_fetch_instructors", fake_instructors)
    monkeypatch.setattr(ar, "_fetch_sent", broken_sent)
    monkeypatch.setattr(ar, "uk_today", lambda now=None: TODAY)
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")
    summary = asyncio.run(ar.dispatch_deadline_reminders())
    assert summary["ok"] is False
    assert r.emails == [] and r.pushes == [] and r.logs == []  # never risk a double-send


def test_run_without_supabase_config_does_nothing(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    assert asyncio.run(ar.dispatch_deadline_reminders())["ok"] is False


# --- catch-up run only in daytime ---------------------------------------------

def _freeze_uk_hour(monkeypatch, hour):
    # 15 Oct 2026 is BST (UTC+1), so UK hour H is UTC hour H-1
    fixed = datetime(2026, 10, 15, hour - 1, 30, tzinfo=timezone.utc)

    class FakeDT(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz) if tz else fixed

    monkeypatch.setattr(ar, "datetime", FakeDT)


@pytest.mark.parametrize("hour,should_run", [(2, False), (7, False), (8, True), (14, True), (19, True), (20, False), (23, False)])
def test_catchup_only_runs_in_daytime(monkeypatch, hour, should_run):
    called = []

    async def fake_dispatch():
        called.append(1)
        return {"ok": True}

    monkeypatch.setattr(ar, "dispatch_deadline_reminders", fake_dispatch)
    _freeze_uk_hour(monkeypatch, hour)
    asyncio.run(ar.catchup_deadline_reminders())
    assert bool(called) is should_run


# --- scheduler wiring -----------------------------------------------------------

def test_register_jobs_adds_the_daily_and_catchup_jobs():
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    s = AsyncIOScheduler(timezone="UTC")
    ar.register_jobs(s)
    assert sorted(j.id for j in s.get_jobs()) == ["deadline_reminders_catchup", "deadline_reminders_daily"]


def test_daily_job_fires_at_0800_uk_time_in_summer_and_winter():
    from apscheduler.triggers.cron import CronTrigger
    trig = CronTrigger(hour=ar.REMIND_HOUR_UK, minute=0, timezone=lr.UK_TZ)
    for start, expect_utc_hour in [(datetime(2026, 9, 28, 9, tzinfo=timezone.utc), 7),   # BST
                                   (datetime(2026, 12, 10, 9, tzinfo=timezone.utc), 8)]:  # GMT
        nxt = trig.get_next_fire_time(None, start).astimezone(timezone.utc)
        assert nxt.hour == expect_utc_hour and nxt.minute == 0
