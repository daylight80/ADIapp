"""Sign-in check is cached briefly, the school row is not, and Stripe calls run off the main thread. No network."""
import asyncio
import threading
from collections import OrderedDict

import pytest
from fastapi import HTTPException

import server


class Resp:
    def __init__(self, body, status=200):
        self._body, self.status_code, self.text = body, status, "nope"

    def json(self):
        return self._body


class FakeHttp:
    def __init__(self):
        self.user_checks = 0
        self.valid = True

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **k):
        self.user_checks += 1
        return Resp({"id": "u1", "email": "a@b.co"}) if self.valid else Resp({}, 401)


@pytest.fixture
def http(monkeypatch):
    fake = FakeHttp()
    monkeypatch.setattr(server.httpx, "AsyncClient", fake)
    monkeypatch.setattr(server, "SUPABASE_URL", "http://sb.test")
    monkeypatch.setattr(server, "SUPABASE_SERVICE_ROLE_KEY", "service-test")
    monkeypatch.setattr(server, "_token_cache", OrderedDict())
    return fake


def check(token="t1"):
    return asyncio.run(server.get_current_supabase_user(f"Bearer {token}"))


def test_second_request_with_same_token_skips_the_supabase_check(monkeypatch, http):
    schools = []

    async def school(uid):
        schools.append(uid)
        return {"id": "s1", "tier": "pro" if len(schools) > 1 else "starter"}

    monkeypatch.setattr(server, "sb_get_school_by_auth_user", school)
    first, second = check(), check()
    assert http.user_checks == 1
    # The school is read every time, so a plan change shows at once.
    assert schools == ["u1", "u1"]
    assert (first["school"]["tier"], second["school"]["tier"]) == ("starter", "pro")


def test_different_token_and_expired_entries_are_checked_again(monkeypatch, http):
    async def school(uid):
        return None

    monkeypatch.setattr(server, "sb_get_school_by_auth_user", school)
    check("a"), check("b")
    assert http.user_checks == 2
    for k, (_, user) in list(server._token_cache.items()):
        server._token_cache[k] = (0.0, user)  # long expired
    check("a")
    assert http.user_checks == 3


def test_a_rejected_token_is_never_cached(monkeypatch, http):
    http.valid = False
    for _ in range(2):
        with pytest.raises(HTTPException) as e:
            check()
        assert e.value.status_code == 401
    assert http.user_checks == 2 and not server._token_cache


def test_cache_is_capped(monkeypatch, http):
    async def school(uid):
        return None

    monkeypatch.setattr(server, "sb_get_school_by_auth_user", school)
    monkeypatch.setattr(server, "TOKEN_CACHE_MAX", 3)
    for i in range(5):
        check(f"t{i}")
    assert len(server._token_cache) == 3


def test_stripe_calls_run_off_the_main_thread(monkeypatch):
    seen = {}

    def create(**kw):
        seen["thread"] = threading.get_ident()
        return type("S", (), {"url": "https://stripe.test/portal"})()

    monkeypatch.setattr(server.stripe.billing_portal.Session, "create", staticmethod(create))
    user = {"school": {"stripe_customer_id": "cus_1"}}

    async def run():
        main = threading.get_ident()
        res = await server.billing_v2_portal(user)
        return main, res

    main, res = asyncio.run(run())
    assert res.url == "https://stripe.test/portal"
    assert seen["thread"] != main
