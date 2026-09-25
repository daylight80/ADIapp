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
