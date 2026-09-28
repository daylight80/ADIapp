"""Pure unit tests for email_service — no network, no running backend needed
(unlike the other files in this folder, which hit a live BASE_URL)."""
import asyncio
import json
import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import email_service  # noqa: E402


def test_clean_display_name_strips_header_injection():
    dirty = 'Sam"\r\nBcc: victim@example.com <x>'
    cleaned = email_service.clean_display_name(dirty)
    assert "\r" not in cleaned and "\n" not in cleaned
    assert '"' not in cleaned and "<" not in cleaned and ">" not in cleaned


def test_clean_display_name_fallback_and_truncation():
    assert email_service.clean_display_name("") == "A fellow instructor"
    assert email_service.clean_display_name(None) == "A fellow instructor"
    assert len(email_service.clean_display_name("x" * 500)) == 60


def test_sender_header_uses_configured_address_and_cleaned_name():
    header = email_service.sender_header('Sam <evil>')
    assert header == f'"Sam evil via ADI Pro" <{email_service.EMAIL_FROM_ADDRESS}>'


def test_render_referral_email_escapes_html_in_name():
    subject, html_body, text_body = email_service.render_referral_email(
        "<script>alert(1)</script>", "ABC234", "https://example.com/?ref=ABC234&x=1",
    )
    assert "<script>" not in html_body
    assert "&amp;x=1" in html_body           # link attribute is escaped
    assert "ABC234" in html_body and "ABC234" in text_body
    assert "<" not in subject                 # name is cleaned for the subject line


def test_render_referral_email_has_opt_out_route():
    _, html_body, text_body = email_service.render_referral_email("Sam", "ABC234", "https://example.com")
    assert email_service.EMAIL_SUPPORT_ADDRESS in html_body
    assert email_service.EMAIL_SUPPORT_ADDRESS in text_body


def test_build_payload_shape_and_reply_to():
    p = email_service.build_payload(
        to="a@b.co", subject="s", html_body="<p>h</p>", text_body="t",
        from_display_name="Sam", reply_to="sam@example.com",
    )
    assert p["to"] == ["a@b.co"] and p["reply_to"] == "sam@example.com"
    assert "reply_to" not in email_service.build_payload(
        to="a@b.co", subject="s", html_body="h", text_body="t", from_display_name="Sam",
    )


def test_is_configured_follows_env(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "")
    monkeypatch.setattr(email_service, "RESEND_API_KEY", "")
    assert email_service.is_configured() is False
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    assert email_service.is_configured() is True


def test_send_email_without_key_raises(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "")
    monkeypatch.setattr(email_service, "RESEND_API_KEY", "")
    with pytest.raises(email_service.EmailNotConfigured):
        asyncio.run(email_service.send_email({"to": ["a@b.co"]}))


def _client_returning(status: int, seen: dict) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(status, json={"id": "abc"} if status < 400 else {"message": "bad"})
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_send_email_posts_bearer_auth_and_payload(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    seen: dict = {}
    payload = {"to": ["a@b.co"], "subject": "s"}
    asyncio.run(email_service.send_email(payload, client=_client_returning(200, seen)))
    assert seen["auth"] == "Bearer re_test"
    assert seen["body"] == payload


def test_send_email_raises_on_resend_error(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    with pytest.raises(email_service.EmailSendError):
        asyncio.run(email_service.send_email({"to": []}, client=_client_returning(422, {})))


# --- Lesson reminder emails (Sept 2026) --------------------------------------

def _reminder(**over):
    args = dict(
        student_name="Jamie Carter", instructor_name="Alex Morgan", kind="h48",
        weekday="Thursday", date_text="8 October", time_text="09:00",
        pickup_address="12 High Street, Leeds",
    )
    args.update(over)
    return email_service.render_lesson_reminder_email(**args)


def test_reminder_48h_states_day_date_time_and_pickup():
    subject, html_body, text_body = _reminder()
    assert subject == "Reminder: your driving lesson on Thursday at 09:00"
    for body in (html_body, text_body):
        assert "Thursday 8 October at 09:00" in body
        assert "12 High Street, Leeds" in body
        assert "Alex Morgan" in body
    assert text_body.startswith("Hi Jamie,")


def test_reminder_25h_says_tomorrow():
    subject, html_body, _ = _reminder(kind="h25")
    assert subject == "Your driving lesson is tomorrow at 09:00"
    assert "Lesson tomorrow at 09:00" in html_body


def test_reminder_omits_pickup_line_when_no_address():
    _, html_body, text_body = _reminder(pickup_address=None)
    assert "Pick-up" not in html_body and "Pick-up" not in text_body


def test_reminder_falls_back_when_names_missing():
    subject, html_body, text_body = _reminder(student_name=None, instructor_name=None)
    assert text_body.startswith("Hi,\n")
    assert "your instructor" in html_body


def test_reminder_escapes_user_supplied_text():
    _, html_body, _ = _reminder(
        student_name="<script>alert(1)</script>",
        instructor_name="<b>Alex</b>",
        pickup_address='"><img src=x onerror=alert(1)>',
    )
    assert "<script>" not in html_body
    assert "<b>Alex</b>" not in html_body
    assert "<img" not in html_body


def test_reminder_has_no_marketing_content():
    _, html_body, text_body = _reminder()
    assert "http" not in text_body.lower()
    assert "sign up" not in html_body.lower()


@pytest.mark.parametrize("value,ok", [
    ("student@example.com", True),
    ("  student@example.com  ", True),
    ("first.last+tag@sub.example.co.uk", True),
    ("", False), (None, False), ("not-an-email", False), ("a@b", False),
    ("a b@example.com", False), ("a@example.com, b@example.com", False),
    ('evil@example.com>\r\nBcc: x@y.com', False), ("<a@example.com>", False),
])
def test_looks_like_email(value, ok):
    assert email_service.looks_like_email(value) is ok


# --- Deadline reminder emails (Sept 2026) -------------------------------------

def _deadline(**over):
    args = dict(instructor_name="Alex Morgan", kind="mot", label=None, stage="d7",
                days_left=5, due_date_text="Saturday 3 October 2026")
    args.update(over)
    return email_service.render_deadline_reminder_email(**args)


def test_deadline_subjects_by_stage():
    assert _deadline(stage="d30", days_left=20)[0] == "MOT due in 20 days (Saturday 3 October 2026)"
    assert _deadline(stage="d7", days_left=5)[0] == "MOT due in 5 days (Saturday 3 October 2026)"
    assert _deadline(stage="d1", days_left=1)[0] == "MOT is due tomorrow"
    assert _deadline(stage="d1", days_left=0)[0] == "MOT is due today"
    assert _deadline(stage="overdue", days_left=-3)[0] == "MOT was due on Saturday 3 October 2026"


def test_deadline_overdue_says_how_long():
    _, html_body, text_body = _deadline(stage="overdue", days_left=-3)
    assert "3 days ago" in text_body and "MOT is overdue" in html_body
    assert "1 day ago" in _deadline(stage="overdue", days_left=-1)[2]


@pytest.mark.parametrize("kind,expected", [
    ("adi_badge", "ADI badge renewal"), ("standards_check", "DVSA standards check"), ("mot", "MOT"),
    ("insurance", "Car insurance"), ("road_tax", "Road tax"), ("dual_controls", "Dual-control service"),
])
def test_deadline_uses_the_standard_name_for_each_kind(kind, expected):
    subject, _, text_body = _deadline(kind=kind)
    assert expected in subject and expected in text_body


def test_deadline_custom_item_uses_the_instructors_own_label():
    subject, html_body, _ = _deadline(kind="other", label="First aid certificate")
    assert "First aid certificate" in subject and "First aid certificate" in html_body


def test_deadline_custom_label_cannot_inject_headers_or_html():
    subject, html_body, _ = _deadline(kind="other", label='Bad\r\nBcc: x@y.com <script>alert(1)</script>')
    assert "\r" not in subject and "\n" not in subject
    assert "<script>" not in html_body and "<script>" not in subject


def test_deadline_standards_check_tells_you_to_log_it_not_edit_a_date():
    _, _, standards = _deadline(kind="standards_check")
    _, _, mot = _deadline(kind="mot")
    assert "My Standards Check" in standards and "Profile > Deadlines" not in standards
    assert "Profile > Deadlines" in mot


def test_deadline_button_only_when_app_domain_is_a_real_https_address(monkeypatch):
    monkeypatch.setenv("APP_DOMAIN", "https://webapp.example.co.uk/")
    _, html_body, text_body = _deadline()
    assert "https://webapp.example.co.uk/deadlines-screen" in html_body and "https://webapp.example.co.uk/deadlines-screen" in text_body
    for bad in ("", "http://localhost:3000", "webapp.example.co.uk"):
        monkeypatch.setenv("APP_DOMAIN", bad)
        assert "deadlines-screen" not in _deadline()[1]


def test_deadline_greets_by_first_name_and_survives_a_missing_name():
    assert _deadline()[2].startswith("Hi Alex,")
    assert _deadline(instructor_name=None)[2].startswith("Hi,\n")


def test_deadline_email_is_sent_from_adi_pro_itself():
    p = email_service.build_payload(to="a@b.co", subject="s", html_body="h", text_body="t",
                                    from_header=email_service.system_sender_header())
    assert p["from"] == f'"ADI Pro" <{email_service.EMAIL_FROM_ADDRESS}>'
    # the existing behaviour is untouched
    q = email_service.build_payload(to="a@b.co", subject="s", html_body="h", text_body="t", from_display_name="Sam")
    assert q["from"] == email_service.sender_header("Sam")
