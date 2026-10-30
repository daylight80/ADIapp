"""The push to a pupil whose lesson was moved: only the lesson's own instructor, only a lesson still to be taught,
nothing on the lock screen. No network."""
import asyncio

import pytest
from fastapi import HTTPException

import server

ME = {"auth_user_id": "auth-me"}


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code = rows, status

    def json(self):
        return self._rows


@pytest.fixture
def env(monkeypatch):
    state = {"lesson": {"instructor_id": "i1", "student_id": "s1", "status": "Scheduled"}, "pupil": {"auth_user_id": "auth-pupil"},
             "pushed": [], "accepted": True, "instructor": {"id": "i1"}}

    class FakeHttp:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, params=None):
            table = url.rsplit("/", 1)[-1]
            row = state["lesson"] if table == "lessons" else state["pupil"]
            return Resp([row] if row is not None else [])

    async def instructor(_a):
        return state["instructor"]

    async def push(auth_user_id, message, kind):
        state["pushed"].append((auth_user_id, message, kind))
        return state["accepted"]

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(server, "_sb_headers", lambda *a, **k: {})
    monkeypatch.setattr(server, "_sb_rest_base", "https://db.example/rest/v1")
    monkeypatch.setattr(server, "sb_get_instructor_by_auth_user", instructor)
    monkeypatch.setattr(server, "_push_to_user", push)
    return state


def call():
    return asyncio.run(server.push_lesson_moved("l1", ME))


def test_pushes_to_the_pupil_with_nothing_on_the_lock_screen(env):
    assert call().notified is True
    assert env["pushed"] == [("auth-pupil", {"title": "Lesson time changed", "body": "Check DualControl for more details"}, "lesson_moved")]


def test_says_not_notified_when_the_pupil_has_no_phone_for_the_app(env):
    env["accepted"] = False
    assert call().notified is False


def test_another_instructors_lesson_is_refused_and_nothing_is_sent(env):
    env["lesson"]["instructor_id"] = "someone-else"
    with pytest.raises(HTTPException) as e:
        call()
    assert e.value.status_code == 403 and env["pushed"] == []


@pytest.mark.parametrize("status", ["Completed", "Cancelled"])
def test_a_lesson_no_longer_to_be_taught_is_refused(env, status):
    env["lesson"]["status"] = status
    with pytest.raises(HTTPException) as e:
        call()
    assert e.value.status_code == 400 and env["pushed"] == []


def test_unknown_lesson_and_no_instructor_profile(env):
    env["lesson"] = None
    with pytest.raises(HTTPException) as e:
        call()
    assert e.value.status_code == 404
    env["instructor"] = None
    with pytest.raises(HTTPException) as e:
        call()
    assert e.value.status_code == 403
