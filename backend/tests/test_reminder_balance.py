"""The 24-hour lesson reminder can mention an unpaid balance, if the instructor has switched that on.
It is one template either way: the balance paragraph is added only when there is something to say."""
import asyncio

import email_service
import lesson_reminders as lr

BASE = dict(
    student_name="Sam Pupil", instructor_name="Grant Robery", kind="h25", weekday="Thursday",
    date_text="22 October", time_text="09:00", instructor_phone="07806 750559",
)


def test_email_without_a_balance_is_unchanged():
    subject, html_body, text_body = email_service.render_lesson_reminder_email(**BASE)
    assert "outstanding balance" not in text_body and "outstanding balance" not in html_body
    assert subject == "Your driving lesson is tomorrow at 09:00"


def test_email_with_a_balance_adds_one_paragraph_in_both_versions():
    subject, html_body, text_body = email_service.render_lesson_reminder_email(**BASE, balance_owed_text="£46.00")
    expected = "You currently have an outstanding balance of £46.00 for your lessons. Please pay at your lesson, or arrange it with Grant Robery."
    assert expected in text_body
    assert expected in html_body
    assert subject == "Your driving lesson is tomorrow at 09:00"  # the subject does not mention money


def test_balance_text_cannot_smuggle_markup():
    _, html_body, text_body = email_service.render_lesson_reminder_email(**BASE, balance_owed_text="£5<script>x</script>")
    assert "<script>" not in html_body and "<script>" not in text_body


def test_push_mentions_a_balance_without_the_amount_and_only_for_the_24_hour_reminder():
    lesson = {"start_time": "2026-10-22T08:00:00Z", "instructors": {"full_name": "Grant Robery"}, "balance_owed": 46.0}
    h25 = lr._build_message(lesson, "h25", "Lesson tomorrow")["body"]
    assert h25.endswith("You also have a balance to settle. See your Wallet.")
    assert "£" not in h25 and "46" not in h25
    assert "balance" not in lr._build_message(lesson, "h48", "x")["body"]
    assert "balance" not in lr._build_message(lesson, "h1", "x")["body"]
    assert "balance" not in lr._build_message({**lesson, "balance_owed": None}, "h25", "x")["body"]


def _run_deliver(monkeypatch, kind, switch_on, owed):
    seen = {}

    async def fake_owed(student_id):
        seen["asked"] = student_id
        return owed

    async def fake_tokens(_):
        return ["ExponentPushToken[x]"]

    async def fake_push(lesson, k, label, tokens):
        seen["balance_owed"] = lesson.get("balance_owed")
        return {"accepted": 1, "receipt_ids": []}

    async def fake_log(*a, **kw):
        return True

    monkeypatch.setattr(lr, "_balance_owed", fake_owed)
    monkeypatch.setattr(lr, "_push_tokens_for_user", fake_tokens)
    monkeypatch.setattr(lr, "_send_push_reminder", fake_push)
    monkeypatch.setattr(lr, "_log_sent", fake_log)
    lesson = {
        "id": "l1", "student_id": "s1", "start_time": "2026-10-22T08:00:00Z",
        "students": {"id": "s1", "auth_user_id": "u1", "email": "", "full_name": "Sam"},
        "instructors": {"full_name": "Grant", "mention_balance_in_reminders": switch_on},
    }
    outcome = asyncio.run(lr._deliver_reminder(lesson, kind, "label"))
    return outcome, seen


def test_balance_is_looked_up_only_when_switched_on_and_for_the_24_hour_reminder(monkeypatch):
    outcome, seen = _run_deliver(monkeypatch, "h25", True, 46.0)
    assert outcome == "push" and seen["asked"] == "s1" and seen["balance_owed"] == 46.0

    _, seen = _run_deliver(monkeypatch, "h25", False, 46.0)
    assert "asked" not in seen and seen["balance_owed"] is None  # switch off: not even looked up

    _, seen = _run_deliver(monkeypatch, "h48", True, 46.0)
    assert "asked" not in seen  # only the 24-hour reminder

    _, seen = _run_deliver(monkeypatch, "h25", True, None)
    assert seen["balance_owed"] is None  # nothing owed: no line


def test_a_failed_balance_lookup_never_stops_the_reminder(monkeypatch):
    class _Boom:
        async def __aenter__(self):
            raise RuntimeError("database down")

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(lr, "_sb_url", lambda: "http://x")
    monkeypatch.setattr(lr, "_client", lambda: _Boom())
    assert asyncio.run(lr._balance_owed("s1")) is None
