"""The weather-for-lessons endpoint, run against a fake database, a fake postcode service and a fake Google
forecast: who may use it, what is sent where, what comes back, caching and limits. No network."""
import asyncio
import collections
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import address_search
import server

SB_USER = {"auth_user_id": "auth-instr", "email": "i@example.com", "school": None, "user": {}}
INSTRUCTOR = {"id": "instr-1", "school_id": "school-1"}


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


NOW = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)


def forecast_hour(offset, **kw):
    s = NOW + timedelta(hours=offset)
    return {
        "interval": {"startTime": iso(s), "endTime": iso(s + timedelta(hours=1))},
        "temperature": {"degrees": kw.get("temp", 11.0), "unit": "CELSIUS"},
        "precipitation": {"probability": {"percent": kw.get("p", 0)}, "qpf": {"quantity": kw.get("mm", 0)}},
        "wind": {"gust": {"value": 15, "unit": "KILOMETERS_PER_HOUR"}},
        "visibility": {"distance": 16, "unit": "KILOMETERS"},
        "weatherCondition": {"type": kw.get("cond", "CLEAR")},
    }


class Resp:
    def __init__(self, body, status=200):
        self._b, self.status_code, self.text = body, status, ""

    def json(self):
        return self._b


class World:
    def __init__(self):
        self.tier = "pro"
        self.google_calls = []
        self.postcode_calls = []
        self.google_status = 200
        self.pages = [[forecast_hour(0), forecast_hour(1, p=90, mm=1.5, cond="RAIN"), forecast_hour(2)]]


@pytest.fixture
def world(monkeypatch):
    w = World()

    class FakeHttp:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, params=None):
            if url.endswith("/driving_schools"):
                return Resp([{"tier": w.tier}])
            if "postcodes.io" in url:
                w.postcode_calls.append(url)
                return Resp({"result": {"latitude": 51.4, "longitude": -0.17}})
            if "weather.googleapis.com" in url:
                w.google_calls.append(dict(params))
                if w.google_status != 200:
                    return Resp({}, w.google_status)
                page = int((params or {}).get("pageToken") or 0)
                body = {"forecastHours": w.pages[page]}
                if page + 1 < len(w.pages):
                    body["nextPageToken"] = str(page + 1)
                return Resp(body)
            return Resp([])

    async def instructor(_a):
        return dict(INSTRUCTOR)

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(server, "sb_get_instructor_by_auth_user", instructor)
    monkeypatch.setattr(server, "_sb_headers", lambda: {})
    monkeypatch.setattr(server, "_sb_rest_base", "https://db.example/rest/v1")
    monkeypatch.setattr(server, "GOOGLE_MAPS_API_KEY", "test-key")
    monkeypatch.setattr(server, "_weather_limiter", address_search.UserLimiter(150, 86400))
    monkeypatch.setattr(server, "_forecast_cache", collections.OrderedDict())
    monkeypatch.setattr(server, "_outcode_positions", collections.OrderedDict())
    return w


def call(outcode="CR4", windows=None):
    windows = windows if windows is not None else [{"id": "les-1", "start": iso(NOW + timedelta(hours=1)), "end": iso(NOW + timedelta(hours=2))}]
    req = server.WeatherBriefingRequest(outcode=outcode, windows=[server.WeatherWindowIn(**w) for w in windows])
    return asyncio.run(server.weather_for_lessons(req, SB_USER))


def code(fn):
    with pytest.raises(HTTPException) as e:
        fn()
    return e.value.status_code


def test_a_lesson_in_the_rain_is_flagged_and_the_others_are_clear(world):
    r = call(windows=[
        {"id": "wet", "start": iso(NOW + timedelta(hours=1)), "end": iso(NOW + timedelta(hours=2))},
        {"id": "dry", "start": iso(NOW), "end": iso(NOW + timedelta(hours=1, minutes=-1))},
    ])
    assert r.status == "ok"
    by = {x.id: x for x in r.results}
    assert [f.kind for f in by["wet"].flags] == ["rain"]
    assert by["dry"].flags == []
    assert by["wet"].summary == "11°C" and by["wet"].covered is True


def test_only_the_area_and_a_key_go_to_google_never_a_street_or_a_name(world):
    call()
    sent = world.google_calls[0]
    assert sent["key"] == "test-key" and sent["location.latitude"] == 51.4
    assert set(sent) <= {"key", "location.latitude", "location.longitude", "hours", "pageSize", "pageToken"}
    assert world.postcode_calls == ["https://api.postcodes.io/outcodes/CR4"]


def test_the_forecast_and_the_area_lookup_are_cached(world):
    call()
    call(outcode="cr4")
    assert len(world.google_calls) == 1 and len(world.postcode_calls) == 1


def test_it_follows_the_pages_of_the_forecast(world):
    world.pages = [[forecast_hour(0)], [forecast_hour(1, cond="HEAVY_RAIN", mm=4, p=95)]]
    r = call(windows=[{"id": "x", "start": iso(NOW + timedelta(hours=1)), "end": iso(NOW + timedelta(hours=2))}])
    assert [f.kind for f in r.results[0].flags] == ["heavy_rain"]
    assert len(world.google_calls) == 2 and world.google_calls[1]["pageToken"] == "1"


def test_free_plans_are_refused_and_nothing_is_fetched(world):
    world.tier = "starter"
    assert code(call) == 403
    assert world.google_calls == [] and world.postcode_calls == []


def test_a_bad_area_or_bad_times_are_refused(world):
    assert code(lambda: call(outcode="CR4 3AB")) == 400
    assert code(lambda: call(outcode="'; drop")) == 400
    assert code(lambda: call(windows=[])) == 400
    assert code(lambda: call(windows=[{"id": "x", "start": "nope", "end": "nope"}])) == 400


def test_if_google_fails_the_briefing_is_unavailable_not_an_error(world):
    world.google_status = 403   # for example the Weather API isn't switched on for the key
    r = call()
    assert r.status == "unavailable" and r.results == []


def test_without_a_google_key_it_is_unavailable(world, monkeypatch):
    monkeypatch.setattr(server, "GOOGLE_MAPS_API_KEY", "")
    assert call().status == "unavailable"
    assert world.google_calls == []


def test_a_lesson_beyond_the_forecast_says_not_covered(world):
    world.pages = [[forecast_hour(0)]]
    r = call(windows=[{"id": "far", "start": iso(NOW + timedelta(hours=30)), "end": iso(NOW + timedelta(hours=31))}])
    assert r.results[0].covered is False and r.results[0].flags == []


def test_it_is_rate_limited_per_instructor(world, monkeypatch):
    monkeypatch.setattr(server, "_weather_limiter", address_search.UserLimiter(2, 86400))
    call(); call()
    assert code(call) == 429
