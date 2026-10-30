"""The school owner's control of the website form (see it, make a new key, switch it off) and the public question the
hosted form page asks (is this form live, and whose is it). The key and the switch live in school_enquiry_forms, a
table only the owner can read. In-memory database. No network."""
import asyncio

import pytest
from fastapi import HTTPException

import address_search
import server

KEY = "a" * 32
OWNER = {"auth_user_id": "auth-owner", "school": {"id": "sc1", "owner_auth_id": "auth-owner"}}
INSTRUCTOR = {"auth_user_id": "auth-sub", "school": {"id": "sc1", "owner_auth_id": "auth-owner"}}


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, ""

    def json(self):
        return self._rows


@pytest.fixture
def world(monkeypatch):
    w = {
        "school": {"id": "sc1", "tier": "pro", "owner_auth_id": "auth-owner", "business_name": "Formula Jon Driving School"},
        "forms": [{"school_id": "sc1", "form_key": KEY, "enabled": True}],
        "posts": 0,
    }

    def rows(table, params):
        data = [w["school"]] if table == "driving_schools" else w["forms"]
        for col in ("id", "school_id", "form_key"):
            if col in (params or {}):
                want = params[col].removeprefix("eq.")
                data = [r for r in data if str(r.get(col)) == want]
        return data

    class Http:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None, headers=None):
            return Resp([dict(r) for r in rows(url.rsplit("/", 1)[-1], params)])

        async def post(self, url, params=None, headers=None, json=None):
            w["posts"] += 1
            if any(f["school_id"] == json["school_id"] for f in w["forms"]):
                return Resp([], 201)  # on_conflict ... ignore-duplicates: the second one is dropped
            w["forms"].append({"school_id": json["school_id"], "form_key": json["form_key"], "enabled": True})
            return Resp([], 201)

        async def patch(self, url, params=None, headers=None, json=None):
            for r in rows("school_enquiry_forms", params):
                r.update({k: v for k, v in json.items() if k != "updated_at"})
            return Resp([], 204)

    monkeypatch.setattr(server.httpx, "AsyncClient", Http)
    monkeypatch.setattr(server, "_sb_headers", lambda *a, **k: {})
    monkeypatch.setattr(server, "_sb_rest_base", "https://db.example/rest/v1")
    monkeypatch.setattr(server, "_enquiry_info_limiter", address_search.UserLimiter(60, 3600))
    return w


def run(coro):
    return asyncio.run(coro)


# --- the owner -------------------------------------------------------------------------------------------------------------
def test_the_owner_sees_the_key_and_the_address_to_paste(world):
    out = run(server.get_enquiry_form(OWNER))
    assert out.available and out.enabled and out.key == KEY and out.form_path == f"/api/public/enquiries/{KEY}"


@pytest.mark.parametrize("tier", ["pro", "franchise"])
def test_dc_pro_and_franchise_have_the_form(world, tier):
    world["school"]["tier"] = tier
    assert run(server.get_enquiry_form(OWNER)).available


def test_a_starter_school_is_told_it_is_not_available_and_given_no_key(world):
    world["school"]["tier"] = "starter"
    world["forms"].clear()
    out = run(server.get_enquiry_form(OWNER))
    assert out.available is False and out.key is None and out.form_path is None
    assert world["forms"] == []  # and nothing was made for it


def test_the_first_visit_makes_the_key_and_it_is_long_and_random(world):
    world["forms"].clear()
    out = run(server.get_enquiry_form(OWNER))
    assert out.available and out.enabled and len(out.key) == 32 and all(c in "0123456789abcdef" for c in out.key)
    assert world["forms"] == [{"school_id": "sc1", "form_key": out.key, "enabled": True}]


def test_a_second_visit_keeps_the_same_key(world):
    world["forms"].clear()
    first = run(server.get_enquiry_form(OWNER)).key
    assert run(server.get_enquiry_form(OWNER)).key == first and len(world["forms"]) == 1


def test_two_first_visits_at_once_leave_one_key(world):
    world["forms"].clear()

    async def both():
        import asyncio as a
        return await a.gather(server._enquiry_form_status("sc1"), server._enquiry_form_status("sc1"))

    first, second = run(both())
    assert len(world["forms"]) == 1 and world["forms"][0]["form_key"] in (first.key, second.key)


def test_only_the_owner_may_see_or_change_it_and_a_sub_instructor_makes_no_key(world):
    world["forms"].clear()
    for call in (server.get_enquiry_form(INSTRUCTOR), server.regenerate_enquiry_form_key(INSTRUCTOR),
                 server.set_enquiry_form_enabled(server.EnquiryFormToggle(enabled=False), INSTRUCTOR)):
        with pytest.raises(HTTPException) as e:
            run(call)
        assert e.value.status_code == 403
    assert world["forms"] == []


def test_a_new_key_is_long_and_random_and_the_old_one_stops_working(world):
    out = run(server.regenerate_enquiry_form_key(OWNER))
    assert out.key != KEY and len(out.key) == 32 and all(c in "0123456789abcdef" for c in out.key)
    assert world["forms"][0]["form_key"] == out.key
    assert run(server.public_enquiry_info(KEY, FakeRequest())) == {"available": False}  # the old address is dead
    assert run(server.public_enquiry_info(out.key, FakeRequest()))["available"] is True


def test_two_new_keys_differ(world):
    assert run(server.regenerate_enquiry_form_key(OWNER)).key != run(server.regenerate_enquiry_form_key(OWNER)).key


def test_the_owner_can_switch_it_off_and_on_without_changing_the_key(world):
    off = run(server.set_enquiry_form_enabled(server.EnquiryFormToggle(enabled=False), OWNER))
    assert off.enabled is False and off.key == KEY
    on = run(server.set_enquiry_form_enabled(server.EnquiryFormToggle(enabled=True), OWNER))
    assert on.enabled is True and on.key == KEY


def test_a_starter_school_cannot_make_a_key_or_switch_it_on(world):
    world["school"]["tier"] = "starter"
    for call in (server.regenerate_enquiry_form_key(OWNER), server.set_enquiry_form_enabled(server.EnquiryFormToggle(enabled=True), OWNER)):
        with pytest.raises(HTTPException) as e:
            run(call)
        assert e.value.status_code == 403
    assert world["forms"][0]["form_key"] == KEY


# --- the public question -----------------------------------------------------------------------------------------------------
class FakeRequest:
    def __init__(self, ip="1.2.3.4"):
        self.headers = {"x-forwarded-for": f"9.9.9.9, {ip}"}
        self.client = None


def test_a_live_form_says_whose_it_is(world):
    assert run(server.public_enquiry_info(KEY, FakeRequest())) == {"available": True, "school_name": "Formula Jon Driving School"}


@pytest.mark.parametrize("setup", ["wrong key", "short key", "off", "starter", "no form row"])
def test_anything_else_looks_exactly_the_same_and_names_nobody(world, setup):
    key = KEY
    if setup == "wrong key":
        key = "b" * 32
    elif setup == "short key":
        key = "abc"
    elif setup == "off":
        world["forms"][0]["enabled"] = False
    elif setup == "starter":
        world["school"]["tier"] = "starter"
    elif setup == "no form row":
        world["forms"].clear()
    assert run(server.public_enquiry_info(key, FakeRequest())) == {"available": False}


def test_the_school_name_is_cleaned_for_display(world):
    world["school"]["business_name"] = 'Jon"s <b>School</b>\r\n'
    assert "<" not in run(server.public_enquiry_info(KEY, FakeRequest()))["school_name"]


def test_asking_is_limited_per_address(world):
    for _ in range(60):
        run(server.public_enquiry_info(KEY, FakeRequest()))
    with pytest.raises(HTTPException) as e:
        run(server.public_enquiry_info(KEY, FakeRequest()))
    assert e.value.status_code == 429
    assert run(server.public_enquiry_info(KEY, FakeRequest("5.6.7.8")))["available"] is True  # another address is fine


def test_the_routes_are_mounted_and_the_owner_ones_need_a_login(world, monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setattr(server, "SUPABASE_URL", "https://db.example")
    monkeypatch.setattr(server, "SUPABASE_SERVICE_ROLE_KEY", "service-test")
    client = TestClient(server.app)
    assert client.get(f"/api/public/enquiries/{KEY}").json() == {"available": True, "school_name": "Formula Jon Driving School"}
    for method, path in (("get", "/api/v2/enquiry-form"), ("post", "/api/v2/enquiry-form/regenerate"), ("post", "/api/v2/enquiry-form/enabled")):
        r = getattr(client, method)(path)  # no Authorization header
        assert r.status_code == 401, (path, r.status_code)
