"""The public .ics endpoint, run against a fake database: the token is the only key, travel is opt-in, blocked time
is included, and a failure reading blocked time never takes the lessons down with it."""
import asyncio

import pytest
from fastapi import HTTPException

import server

LESSON = {
    "id": "l1", "start_time": "2026-10-22T09:00:00+00:00", "end_time": "2026-10-22T10:00:00+00:00", "topic": "Roundabouts",
    "notes": "", "pickup_address": "10 Waterloo Road", "status": "Scheduled", "duration_hours": 1, "lesson_type": "Standard",
    "travel_minutes": 15, "students": {"full_name": "Sam Smith"},
}
BLOCK = {"id": "b1", "starts_at": "2026-10-23T09:00:00+00:00", "ends_at": "2026-10-23T12:00:00+00:00", "all_day": False, "category": "holiday"}


class Resp:
    def __init__(self, rows, status=200):
        self._r, self.status_code, self.text = rows, status, ""

    def json(self):
        return self._r


class World:
    def __init__(self):
        self.known_token = "good-token"
        self.blocks_status = 200
        self.requested = []


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
            table = url.rsplit("/", 1)[-1]
            w.requested.append((table, dict(params or {})))
            if table == "instructors":
                ok = params.get("calendar_feed_token") == f"eq.{w.known_token}"
                return Resp([{"id": "instr-1", "full_name": "Jon Kenny", "school_id": "s1"}] if ok else [])
            if table == "lessons":
                return Resp([LESSON])
            if table == "availability_blocks":
                return Resp([BLOCK] if w.blocks_status == 200 else [], w.blocks_status)
            return Resp([])

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(server, "_sb_headers", lambda **k: {})
    monkeypatch.setattr(server, "_sb_rest_base", "https://db.example/rest/v1")
    return w


def get(token_with_ext, travel=0):
    return asyncio.run(server.calendar_feed_endpoint(token_with_ext, travel))


def test_the_right_token_gets_the_diary_as_a_calendar(world):
    r = get("good-token.ics")
    body = r.body.decode()
    assert r.media_type.startswith("text/calendar")
    assert "SUMMARY:Driving lesson — Sam Smith" in body
    assert "SUMMARY:Not available — Holiday" in body          # blocked time is in the feed
    assert "Travel to" not in body                            # travel is opt-in


def test_travel_time_is_added_only_when_asked_for(world):
    assert "SUMMARY:Travel to Sam Smith" in get("good-token.ics", travel=1).body.decode()


def test_a_wrong_token_or_a_missing_extension_finds_nothing(world):
    for t in ("wrong.ics", "good-token", ".ics", ""):
        with pytest.raises(HTTPException) as e:
            get(t)
        assert e.value.status_code == 404


def test_cancelled_lessons_are_never_requested_and_the_window_is_bounded(world):
    get("good-token.ics")
    lessons_params = next(p for t, p in world.requested if t == "lessons")
    assert lessons_params["status"] == "in.(Scheduled,Completed)"
    assert lessons_params["instructor_id"] == "eq.instr-1"
    assert "start_time" in lessons_params and "and" in lessons_params
    assert "test_start" in lessons_params["select"] and "travel_minutes" in lessons_params["select"]


def test_if_blocked_time_cannot_be_read_the_lessons_still_go_out(world):
    world.blocks_status = 500
    body = get("good-token.ics").body.decode()
    assert "SUMMARY:Driving lesson — Sam Smith" in body and "Not available" not in body
