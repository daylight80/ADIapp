"""The full school backup must hold every row (Supabase caps a response at 1000) and must fail, not shrink, when a
table cannot be read. Runs against a fake database. No network."""
import asyncio

import pytest
from fastapi import HTTPException

import server

USER = {"auth_user_id": "a1", "school": {"id": "school-1"}}


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, "boom"

    def json(self):
        return self._rows


class FakeDb:
    """Serves tables like PostgREST: honours offset and limit, but never returns more than 1000 rows."""

    def __init__(self, tables, broken=()):
        self.tables, self.broken, self.calls = tables, set(broken), []

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, headers=None):
        table = url.rsplit("/", 1)[1]
        self.calls.append((table, dict(params)))
        if table in self.broken:
            return Resp([], 500)
        rows = self.tables[table]
        for col, cond in params.items():  # only the in.(...) filter matters here
            if isinstance(cond, str) and cond.startswith("in.("):
                keep = set(cond[4:-1].split(","))
                rows = [r for r in rows if r[col] in keep]
        start = int(params["offset"])
        return Resp(rows[start:start + min(int(params["limit"]), 1000)])


@pytest.fixture
def db(monkeypatch):
    async def owner(_u):
        return True

    monkeypatch.setattr(server, "_is_school_owner", owner)

    def install(tables, broken=()):
        fake = FakeDb(tables, broken)
        monkeypatch.setattr(server.httpx, "AsyncClient", fake)
        monkeypatch.setattr(server, "SUPABASE_SERVICE_ROLE_KEY", "service-test")
        return fake

    return install


def tables(lessons=0, students=3):
    return {
        "instructors": [{"id": "i1"}],
        "students": [{"id": f"s{n:05d}"} for n in range(students)],
        "lessons": [{"id": f"l{n:05d}", "instructor_id": "i1"} for n in range(lessons)],
        "expense_receipts": [], "vehicles": [],
        "block_bookings": [{"id": f"b{n}", "student_id": f"s{n:05d}"} for n in range(students)],
        "instructor_lesson_notes": [],
    }


def test_more_than_a_thousand_lessons_are_all_backed_up(db):
    db(tables(lessons=2503))
    out = asyncio.run(server.v2_school_backup(USER))
    assert len(out["lessons"]) == 2503


def test_a_table_that_cannot_be_read_fails_the_backup(db):
    db(tables(), broken=["vehicles"])
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.v2_school_backup(USER))
    assert e.value.status_code == 502
    assert "vehicles" in e.value.detail


def test_many_pupils_do_not_make_one_giant_request(db):
    fake = db(tables(students=450))
    out = asyncio.run(server.v2_school_backup(USER))
    assert len(out["block_bookings"]) == 450
    sizes = [len(p["student_id"].split(",")) for t, p in fake.calls if t == "block_bookings"]
    assert max(sizes) <= 100
