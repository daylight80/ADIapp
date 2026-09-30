"""Pure unit tests for lesson_reminders channel selection — no network, no running
backend, no Supabase. Everything that would touch the outside world is patched.

The rules under test (see CHANNEL_ORDER in lesson_reminders.py):
  48h  email first, then push     25h  push first, then email     1h  push only
The first channel that delivers wins, so a student never gets a reminder twice.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import email_service  # noqa: E402
import lesson_reminders as lr  # noqa: E402


def make_lesson(*, email="student@example.com", auth_user_id="auth-1", tier="pro",
                instructor_phone="07700 900123", start="2026-10-08T08:00:00+00:00"):
    return {
        "id": "lesson-1",
        "start_time": start,
        "pickup_address": "12 High Street",
        "students": {"id": "s1", "full_name": "Jamie Carter", "email": email, "auth_user_id": auth_user_id},
        "instructors": {"id": "i1", "full_name": "Alex Morgan", "mobile_number": instructor_phone,
                        "driving_schools": {"tier": tier}},
    }


class Recorder:
    """Patches every outside-world call and records what the dispatcher did."""

    def __init__(self, monkeypatch, *, tokens=("ExpoPushToken[a]",), email_ok=True,
                 push_accepted=True, configured=True):
        self.emails, self.pushes, self.logs, self.token_lookups = [], [], [], 0
        self.tokens, self.email_ok, self.push_accepted = list(tokens), email_ok, push_accepted

        async def fake_send_email(lesson, kind):
            self.emails.append((lesson["id"], kind))
            return self.email_ok

        async def fake_tokens(_uid):
            self.token_lookups += 1
            return self.tokens

        async def fake_push(messages):
            self.pushes.append(messages)
            n = len(messages) if self.push_accepted else 0
            return {"accepted": n, "receipt_ids": ["r1"] if n else []}

        async def fake_log(lesson_id, kind, push_count, receipt_ids=None, channel="push"):
            self.logs.append({"lesson": lesson_id, "kind": kind, "push_count": push_count, "channel": channel})
            return True

        monkeypatch.setattr(lr, "_send_email_reminder", fake_send_email)
        monkeypatch.setattr(lr, "_push_tokens_for_user", fake_tokens)
        monkeypatch.setattr(lr, "_send_push", fake_push)
        monkeypatch.setattr(lr, "_log_sent", fake_log)
        monkeypatch.setattr(email_service, "is_configured", lambda: configured)
        monkeypatch.setattr(lr, "_warned_email_unconfigured", False)

    def run(self, lesson, kind):
        return asyncio.run(lr._deliver_reminder(lesson, kind, "Label"))


# --- 48h: email first, push as fallback --------------------------------------

def test_48h_with_email_and_app_sends_email_only(monkeypatch):
    r = Recorder(monkeypatch)
    assert r.run(make_lesson(), "h48") == "email"
    assert len(r.emails) == 1 and r.pushes == []
    assert r.logs == [{"lesson": "lesson-1", "kind": "h48", "push_count": 0, "channel": "email"}]


def test_48h_email_only_student_without_app_gets_email(monkeypatch):
    r = Recorder(monkeypatch)
    assert r.run(make_lesson(auth_user_id=None), "h48") == "email"
    assert r.token_lookups == 0  # never looked for push tokens


def test_48h_falls_back_to_push_when_email_fails(monkeypatch):
    r = Recorder(monkeypatch, email_ok=False)
    assert r.run(make_lesson(), "h48") == "push"
    assert len(r.emails) == 1 and len(r.pushes) == 1
    assert [l["channel"] for l in r.logs] == ["push"]


def test_48h_no_email_uses_push(monkeypatch):
    r = Recorder(monkeypatch)
    assert r.run(make_lesson(email=None), "h48") == "push"
    assert r.emails == []


def test_48h_email_fails_and_no_app_retries_and_logs_nothing(monkeypatch):
    r = Recorder(monkeypatch, email_ok=False)
    assert r.run(make_lesson(auth_user_id=None), "h48") == "retry"
    assert r.logs == []  # not logged, so the next tick tries again


# --- 25h: push first, email as fallback --------------------------------------

def test_25h_with_app_and_email_sends_push_only(monkeypatch):
    r = Recorder(monkeypatch)
    assert r.run(make_lesson(), "h25") == "push"
    assert r.emails == [] and len(r.pushes) == 1


def test_25h_no_device_token_falls_back_to_email(monkeypatch):
    r = Recorder(monkeypatch, tokens=())
    assert r.run(make_lesson(), "h25") == "email"
    assert r.logs[0]["channel"] == "email"


def test_25h_push_rejected_falls_back_to_email(monkeypatch):
    r = Recorder(monkeypatch, push_accepted=False)
    assert r.run(make_lesson(), "h25") == "email"
    assert len(r.pushes) == 1 and len(r.emails) == 1


def test_25h_student_without_app_gets_email(monkeypatch):
    r = Recorder(monkeypatch)
    assert r.run(make_lesson(auth_user_id=None), "h25") == "email"


# --- 1h: push only -----------------------------------------------------------

def test_1h_never_emails_even_if_only_email_is_available(monkeypatch):
    r = Recorder(monkeypatch)
    assert r.run(make_lesson(auth_user_id=None), "h1") == "no_link"
    assert r.emails == [] and r.logs == []


def test_1h_with_app_sends_push(monkeypatch):
    r = Recorder(monkeypatch)
    assert r.run(make_lesson(), "h1") == "push"
    assert r.emails == []


# --- nobody to tell ----------------------------------------------------------

def test_no_email_and_no_app_is_skipped_without_logging(monkeypatch):
    r = Recorder(monkeypatch)
    assert r.run(make_lesson(email=None, auth_user_id=None), "h48") == "no_link"
    assert r.logs == []  # linking the app or adding an email later must still work


def test_app_without_device_token_and_no_email_is_logged_as_no_audience(monkeypatch):
    r = Recorder(monkeypatch, tokens=())
    assert r.run(make_lesson(email=None), "h48") == "no_token"
    assert r.logs == [{"lesson": "lesson-1", "kind": "h48", "push_count": 0, "channel": "push"}]


@pytest.mark.parametrize("bad", ["", "not-an-email", "a@b", None])
def test_invalid_student_email_is_treated_as_no_email(monkeypatch, bad):
    r = Recorder(monkeypatch)
    assert r.run(make_lesson(email=bad), "h48") == "push"
    assert r.emails == []


# --- Resend not configured ---------------------------------------------------

def test_missing_resend_key_falls_back_to_push_without_counting_a_failure(monkeypatch):
    r = Recorder(monkeypatch, configured=False)
    assert r.run(make_lesson(), "h48") == "push"
    assert r.emails == []


def test_missing_resend_key_and_no_app_is_not_a_retry(monkeypatch):
    r = Recorder(monkeypatch, configured=False)
    assert r.run(make_lesson(auth_user_id=None), "h48") == "no_link"


# --- _process_kind: tier gating, dedupe and metrics ---------------------------

def _process(monkeypatch, lessons, *, already_sent=(), **rec):
    r = Recorder(monkeypatch, **rec)

    async def fake_find(_m, _w):
        return lessons

    async def fake_already(lesson_id, _kind):
        return lesson_id in already_sent

    monkeypatch.setattr(lr, "_find_due_lessons", fake_find)
    monkeypatch.setattr(lr, "_already_sent", fake_already)
    return r, asyncio.run(lr._process_kind("h48", 48 * 60, "Lesson reminder"))


def test_starter_tier_gets_no_reminders_on_any_channel(monkeypatch):
    r, m = _process(monkeypatch, [make_lesson(tier="starter")])
    assert m["skipped_tier"] == 1 and m["sent"] == 0
    assert r.emails == [] and r.pushes == []


def test_unknown_tier_is_treated_as_starter(monkeypatch):
    r, m = _process(monkeypatch, [make_lesson(tier="growth")])
    assert m["skipped_tier"] == 1 and r.emails == []


def test_already_sent_reminder_is_not_sent_again_on_any_channel(monkeypatch):
    r, m = _process(monkeypatch, [make_lesson()], already_sent={"lesson-1"})
    assert m["skipped_dup"] == 1 and m["sent"] == 0
    assert r.emails == [] and r.pushes == []


def test_metrics_split_email_and_push(monkeypatch):
    a = make_lesson()
    b = make_lesson(email=None); b["id"] = "lesson-2"
    c = make_lesson(email=None, auth_user_id=None); c["id"] = "lesson-3"
    _, m = _process(monkeypatch, [a, b, c])
    assert m["sent"] == 2 and m["sent_email"] == 1 and m["sent_push"] == 1
    assert m["skipped_no_link"] == 1 and m["candidates"] == 3


# --- the real email sender (Resend call patched) -----------------------------

def _capture_send(monkeypatch, *, fail=False):
    sent = []

    async def fake_send_email(payload, client=None):
        if fail:
            raise email_service.EmailSendError("boom")
        sent.append(payload)

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    monkeypatch.setattr(email_service, "is_configured", lambda: True)
    return sent


def test_email_payload_has_uk_time_phone_contact_and_instructor_sender(monkeypatch):
    sent = _capture_send(monkeypatch)
    ok = asyncio.run(lr._send_email_reminder(make_lesson(), "h48"))
    assert ok is True
    p = sent[0]
    assert p["to"] == ["student@example.com"]
    assert "reply_to" not in p
    assert "Alex Morgan via ADI Pro" in p["from"]
    assert "07700 900123" in p["text"]
    # 08:00 UTC on 8 Oct 2026 is 09:00 BST — the UK-time fix must apply to email too
    assert "09:00" in p["subject"] and "08:00" not in p["subject"]
    assert "Thursday 8 October at 09:00" in p["text"]


def test_email_payload_falls_back_when_instructor_has_no_phone(monkeypatch):
    sent = _capture_send(monkeypatch)
    asyncio.run(lr._send_email_reminder(make_lesson(instructor_phone=None), "h48"))
    assert "please contact Alex Morgan" in sent[0]["text"]


def test_email_send_error_returns_false_instead_of_raising(monkeypatch):
    _capture_send(monkeypatch, fail=True)
    assert asyncio.run(lr._send_email_reminder(make_lesson(), "h48")) is False


def test_unreadable_start_time_sends_nothing(monkeypatch):
    sent = _capture_send(monkeypatch)
    assert asyncio.run(lr._send_email_reminder(make_lesson(start="garbage"), "h48")) is False
    assert sent == []


def test_channel_order_matches_the_agreed_rules():
    assert lr.CHANNEL_ORDER == {"h48": ("email", "push"), "h25": ("push", "email"), "h1": ("push",)}
