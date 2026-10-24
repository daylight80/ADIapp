"""The model-backed endpoints cost money per call, so they need a paid plan, a size cap and a daily allowance. No network."""
import asyncio

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import address_search
import server

USER = {"auth_user_id": "auth-1"}


def run(coro):
    return asyncio.run(coro)


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, ""

    def json(self):
        return self._rows


class FakeClient:
    def __init__(self, tier):
        self.tier = tier

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, *a, **k):
        return Resp([{"tier": self.tier}])


@pytest.fixture
def on_plan(monkeypatch):
    """Sets the caller's plan; also gives the endpoints a key so they reach the checks."""
    monkeypatch.setattr(server, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(server, "SUPABASE_SERVICE_ROLE_KEY", "service-test")

    async def instructor(_uid):
        return {"id": "ins-1", "school_id": "school-1"}

    monkeypatch.setattr(server, "sb_get_instructor_by_auth_user", instructor)

    def pick(tier):
        monkeypatch.setattr(server.httpx, "AsyncClient", lambda **kw: FakeClient(tier))

    return pick


def test_receipt_scan_refuses_a_starter_school(on_plan):
    on_plan("starter")
    with pytest.raises(HTTPException) as e:
        run(server.receipts_scan(server.ReceiptScanRequest(image_base64="abcd", mime_type="image/jpeg"), USER))
    assert e.value.status_code == 403
    assert "Receipt scanning" in e.value.detail


def test_receipt_photo_over_the_cap_is_rejected():
    with pytest.raises(ValidationError):
        server.ReceiptScanRequest(image_base64="a" * (server.MAX_RECEIPT_B64_CHARS + 1), mime_type="image/jpeg")


def test_receipt_upload_over_the_cap_is_turned_away_before_it_is_read():
    client = TestClient(server.app)
    r = client.post("/api/receipts/scan", content=b"x" * (server.MAX_RECEIPT_B64_CHARS + 5000),
                    headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_mock_debrief_stops_at_the_daily_allowance(monkeypatch, on_plan):
    on_plan("pro")
    monkeypatch.setattr(server, "_ai_limiter", address_search.UserLimiter(1, 86400))

    async def gone(*a, **k):
        raise HTTPException(status_code=404, detail="stop here")

    monkeypatch.setattr(server, "_load_mock_attempt_for_caller", gone)
    with pytest.raises(HTTPException) as first:
        run(server.generate_mock_test_debrief("a1", USER))
    assert first.value.status_code == 404  # passed the allowance
    with pytest.raises(HTTPException) as second:
        run(server.generate_mock_test_debrief("a1", USER))
    assert second.value.status_code == 429


def test_lesson_debrief_stops_at_the_daily_allowance(monkeypatch, on_plan):
    monkeypatch.setattr(server, "_ai_limiter", address_search.UserLimiter(0, 86400))
    with pytest.raises(HTTPException) as e:
        run(server.generate_lesson_debrief("l1", USER))
    assert e.value.status_code == 429


def test_the_road_briefing_message_is_unchanged(on_plan):
    on_plan("starter")
    with pytest.raises(HTTPException) as e:
        run(server._require_paid_instructor(USER))
    assert e.value.detail == "The road briefing is part of the Pro plan."
