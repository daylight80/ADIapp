import asyncio
from datetime import datetime, timedelta, timezone

import email_service
import payment_reminders as pr

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)


def test_one_reminder_every_few_days():
    assert pr.REMINDER_COOLDOWN_DAYS == 3
    assert pr.can_send(None, NOW)
    last = (NOW - timedelta(days=1)).isoformat()
    assert not pr.can_send(last, NOW)
    assert pr.can_send((NOW - timedelta(days=3)).isoformat(), NOW)
    assert pr.can_send((NOW - timedelta(days=10)).isoformat(), NOW)
    assert pr.next_allowed_at(None) is None
    assert pr.next_allowed_at("2026-10-14T09:00:00Z") == datetime(2026, 10, 17, 9, 0, tzinfo=timezone.utc)
    assert pr.next_allowed_at("garbage") is None


def test_describes_the_wait_without_platform_specific_date_codes():
    assert pr.describe_wait("2026-10-04T09:00:00Z") == ("4 Oct", "7 Oct")
    assert pr.describe_wait("2026-10-29T09:00:00Z") == ("29 Oct", "1 Nov")


def test_formats_pounds():
    assert pr.format_gbp(46) == "£46.00"
    assert pr.format_gbp(1234.5) == "£1,234.50"
    assert pr.format_gbp(-3) == "£3.00"


def test_push_has_no_amount_and_names_the_instructor():
    m = pr.push_message("Grant Robery")
    assert m["title"] == "Payment reminder"
    assert m["body"].startswith("Grant has sent you a payment reminder")
    assert "£" not in m["body"]
    assert "Your instructor" in pr.push_message(None)["body"] or "Your" in pr.push_message(None)["body"]


def test_email_says_the_amount_who_to_call_and_escapes_names():
    subject, html_body, text_body = email_service.render_payment_reminder_email(
        student_name="Sam <b>Pupil</b>", instructor_name='Grant "Robery"', amount_text="£46.00", instructor_phone="07806 750559",
    )
    assert subject == "A payment reminder from Grant Robery"
    assert "£46.00" in text_body and "£46.00" in html_body
    assert "07806 750559" in text_body
    assert "<b>" not in html_body
    assert "Hi Sam," in text_body
    assert "pay at your next lesson" in text_body


def test_email_amount_cannot_smuggle_markup():
    _, html_body, text_body = email_service.render_payment_reminder_email(
        student_name="Sam", instructor_name="Grant", amount_text="£5<script>x</script>",
    )
    assert "<script>" not in html_body
    assert "<script>" not in text_body


def test_email_without_a_phone_still_says_who_to_contact():
    _, _, text_body = email_service.render_payment_reminder_email(student_name="Sam", instructor_name="Grant", amount_text="£10.00")
    assert "please contact Grant." in text_body


def test_no_way_to_reach_the_pupil_means_no_send(monkeypatch):
    async def no_tokens(_):
        return []
    monkeypatch.setattr(pr.lr, "_push_tokens_for_user", no_tokens)
    monkeypatch.setattr(pr.email_service, "is_configured", lambda: True)
    pupil = {"id": "s1", "auth_user_id": "u1", "email": "not-an-email", "full_name": "Sam"}
    assert asyncio.run(pr.send_reminder(pupil, {"full_name": "Grant"}, 20.0)) is None


def test_push_first_and_email_only_when_push_fails(monkeypatch):
    sent = {"push": 0, "email": 0}

    async def tokens(_):
        return ["ExponentPushToken[x]"]

    async def push_ok(messages):
        sent["push"] += len(messages)
        return {"accepted": len(messages), "receipt_ids": []}

    async def push_refused(messages):
        return {"accepted": 0, "receipt_ids": []}

    async def fake_send_email(payload, client=None):
        sent["email"] += 1

    class _Ctx:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(pr.lr, "_push_tokens_for_user", tokens)
    monkeypatch.setattr(pr.lr, "_client", lambda: _Ctx())
    monkeypatch.setattr(pr.email_service, "is_configured", lambda: True)
    monkeypatch.setattr(pr.email_service, "send_email", fake_send_email)
    pupil = {"id": "s1", "auth_user_id": "u1", "email": "sam@example.com", "full_name": "Sam"}

    monkeypatch.setattr(pr.lr, "_send_push", push_ok)
    assert asyncio.run(pr.send_reminder(pupil, {"full_name": "Grant"}, 20.0)) == "push"
    assert sent == {"push": 1, "email": 0}

    monkeypatch.setattr(pr.lr, "_send_push", push_refused)
    assert asyncio.run(pr.send_reminder(pupil, {"full_name": "Grant"}, 20.0)) == "email"
    assert sent["email"] == 1
