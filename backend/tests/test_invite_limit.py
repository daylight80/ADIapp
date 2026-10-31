"""Each invite sends a real email, so one account gets a daily allowance. No network."""
import asyncio

import pytest
from fastapi import HTTPException

import address_search
import server

USER = {"auth_user_id": "a1", "school": {"id": "school-1", "business_name": "Test School"}}


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, ""

    def json(self):
        return self._rows


class FakeHttp:
    def __init__(self):
        self.invites = 0
        self.payloads = []

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, *a, **k):
        return Resp([{"id": "i1", "full_name": "Alex"}])

    async def post(self, url, **k):
        if url.endswith("/auth/v1/invite"):
            self.invites += 1
            self.payloads.append(k.get("json"))
        if url.endswith("/rpc/can_add_instructor"):
            return Resp(True)
        return Resp({})


@pytest.fixture
def http(monkeypatch):
    fake = FakeHttp()
    monkeypatch.setattr(server.httpx, "AsyncClient", fake)
    monkeypatch.setattr(server, "SUPABASE_URL", "http://sb.test")
    monkeypatch.setattr(server, "SUPABASE_SERVICE_ROLE_KEY", "service-test")
    return fake


def invite(email="pupil@example.com"):
    return asyncio.run(server.v2_invite_student(server.StudentInviteRequest(email=email), USER))


def test_student_invites_stop_at_the_daily_allowance(monkeypatch, http):
    monkeypatch.setattr(server, "_invite_limiter", address_search.UserLimiter(2, 86400))
    invite()
    invite("b@example.com")
    with pytest.raises(HTTPException) as e:
        invite("c@example.com")
    assert e.value.status_code == 429
    assert http.invites == 2  # the refused one never reached Supabase


def test_instructor_invites_share_the_allowance(monkeypatch, http):
    async def owner(_u):
        return True

    monkeypatch.setattr(server, "_is_school_owner", owner)
    monkeypatch.setattr(server, "_invite_limiter", address_search.UserLimiter(0, 86400))
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.v2_invite_instructor(
            server.InstructorInviteRequest(email="new@example.com", full_name="New Person"), USER))
    assert e.value.status_code == 429
    assert http.invites == 0


def test_invite_emails_land_on_the_choose_a_password_screen(monkeypatch, http):
    # The email link signs them in; without this they would never be asked for a password.
    monkeypatch.setattr(server, "APP_DOMAIN", "https://app.test")
    monkeypatch.setattr(server, "_invite_limiter", address_search.UserLimiter(5, 86400))

    async def owner(_u):
        return True

    monkeypatch.setattr(server, "_is_school_owner", owner)
    invite()
    asyncio.run(server.v2_invite_instructor(
        server.InstructorInviteRequest(email="new@example.com", full_name="New Person"), USER))
    assert [p["redirect_to"] for p in http.payloads] == ["https://app.test/reset-password-screen"] * 2
