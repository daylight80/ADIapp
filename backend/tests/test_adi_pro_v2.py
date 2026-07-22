"""End-to-end backend regression for ADI Pro v2 SaaS endpoints.

Covers:
  * Supabase auth sign-in for owner (alex@adipro.uk) and student (student@demo.uk)
  * /api/v2/school/leaderboard  (owner-only aggregate)
  * /api/v2/school/today        (today's lessons across the school)
  * PATCH /api/v2/students/{id}/status  (lifecycle transitions + Undo/reactivate)
  * /api/v2/billing/checkout    (structure only — LIVE Stripe, do not complete)

APScheduler dispatch_lesson_reminders is verified out-of-band by log inspection.
"""
import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "backend" / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
SUPABASE_URL = os.environ["EXPO_PUBLIC_SUPABASE_URL"].rstrip("/")
SUPABASE_ANON = os.environ["EXPO_PUBLIC_SUPABASE_ANON_KEY"]


def _sb_password_login(email: str, password: str) -> dict:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"Supabase login failed for {email}: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert "access_token" in body, body
    return body


@pytest.fixture(scope="session")
def owner_token() -> str:
    return _sb_password_login("alex@adipro.uk", "password123")["access_token"]


@pytest.fixture(scope="session")
def student_token() -> str:
    return _sb_password_login("student@demo.uk", "password123")["access_token"]


@pytest.fixture
def owner_hdrs(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture
def student_hdrs(student_token):
    return {"Authorization": f"Bearer {student_token}"}


# ---------- Auth sanity ----------------------------------------------------
class TestSupabaseAuth:
    def test_owner_login(self, owner_token):
        assert len(owner_token) > 40

    def test_student_login(self, student_token):
        assert len(student_token) > 40

    def test_invalid_login_rejected(self):
        r = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
            json={"email": "alex@adipro.uk", "password": "wrongpw"},
            timeout=10,
        )
        assert r.status_code in (400, 401)


# ---------- v2/school/leaderboard -----------------------------------------
class TestLeaderboard:
    def test_leaderboard_owner_200(self, owner_hdrs):
        r = requests.get(f"{BASE_URL}/api/v2/school/leaderboard", headers=owner_hdrs, timeout=20)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        # Structural assertions
        for k in ("school_id", "month_iso", "tier", "seat_count", "totals", "rows"):
            assert k in body, f"Missing key {k}"
        totals = body["totals"]
        for k in ("students_active", "lessons_month", "revenue_month", "pass_rate"):
            assert k in totals
            assert isinstance(totals[k], (int, float))
        assert isinstance(body["rows"], list)
        # Alex should be listed as owner
        alex = next((row for row in body["rows"] if row.get("is_owner")), None)
        assert alex is not None, "Owner row not found in leaderboard"

    def test_leaderboard_student_forbidden(self, student_hdrs):
        r = requests.get(f"{BASE_URL}/api/v2/school/leaderboard", headers=student_hdrs, timeout=15)
        # Student has no school → 403 or 400 acceptable, but must not be 200
        assert r.status_code in (400, 403), f"Unexpected {r.status_code}: {r.text[:200]}"

    def test_leaderboard_no_token_401(self):
        r = requests.get(f"{BASE_URL}/api/v2/school/leaderboard", timeout=10)
        assert r.status_code == 401


# ---------- v2/school/today ------------------------------------------------
class TestToday:
    def test_today_owner_200(self, owner_hdrs):
        r = requests.get(f"{BASE_URL}/api/v2/school/today", headers=owner_hdrs, timeout=15)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert isinstance(body, list)
        # If any lesson today, verify schema
        if body:
            row = body[0]
            for k in ("lesson_id", "instructor_id", "instructor_name", "start_time", "end_time", "status"):
                assert k in row, f"Missing key {k}"

    def test_today_no_token_401(self):
        r = requests.get(f"{BASE_URL}/api/v2/school/today", timeout=10)
        assert r.status_code == 401


# ---------- v2/students/{id}/status ---------------------------------------
def _pick_a_student_id(headers):
    """Fetch a student id belonging to Alex's school via the leaderboard-linked
    Supabase view. We use the raw Supabase REST because there's no owner-side
    list endpoint at /api/. Falls back to skipping the test if none exists."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/students?select=id,status,instructor_id&limit=5",
        headers={
            "apikey": SUPABASE_ANON,
            "Authorization": headers["Authorization"],
        },
        timeout=10,
    )
    if r.status_code != 200:
        return None
    rows = r.json() or []
    return rows[0] if rows else None


class TestStudentStatus:
    def test_patch_status_and_revert(self, owner_hdrs):
        stu = _pick_a_student_id(owner_hdrs)
        if not stu:
            pytest.skip("No students visible to owner via anon RLS – cannot exercise PATCH")
        sid = stu["id"]
        original = stu.get("status") or "Active"

        # 1. Move to Waitlist
        r1 = requests.patch(
            f"{BASE_URL}/api/v2/students/{sid}/status",
            headers={**owner_hdrs, "Content-Type": "application/json"},
            json={"status": "Waitlist"},
            timeout=15,
        )
        assert r1.status_code == 200, r1.text[:300]
        body = r1.json()
        assert body.get("ok") is True
        assert body.get("status") == "Waitlist"

        # 2. Revert
        r2 = requests.patch(
            f"{BASE_URL}/api/v2/students/{sid}/status",
            headers={**owner_hdrs, "Content-Type": "application/json"},
            json={"status": original},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text[:300]
        assert r2.json().get("status") == original

    def test_patch_status_invalid_value_400(self, owner_hdrs):
        stu = _pick_a_student_id(owner_hdrs)
        if not stu:
            pytest.skip("No students visible")
        r = requests.patch(
            f"{BASE_URL}/api/v2/students/{stu['id']}/status",
            headers={**owner_hdrs, "Content-Type": "application/json"},
            json={"status": "Zombie"},
            timeout=10,
        )
        assert r.status_code == 400

    def test_patch_status_no_token_401(self):
        r = requests.patch(
            f"{BASE_URL}/api/v2/students/00000000-0000-0000-0000-000000000000/status",
            json={"status": "Active"},
            timeout=10,
        )
        assert r.status_code == 401


# ---------- v2/billing/checkout (structure only, do NOT complete) ---------
class TestBillingCheckoutStructure:
    def test_checkout_returns_stripe_url(self, owner_hdrs):
        """We intentionally hit Stripe LIVE mode but only inspect the returned URL —
        no card details, no completion. If the school is already on the requested
        tier the endpoint returns 400 which is also acceptable."""
        r = requests.post(
            f"{BASE_URL}/api/v2/billing/checkout",
            headers={**owner_hdrs, "Content-Type": "application/json"},
            json={"tier": "growth", "seat_count": 1},
            timeout=20,
        )
        if r.status_code == 400 and "already have" in r.text.lower():
            pytest.skip(f"School already on this tier: {r.text[:100]}")
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert "url" in body
        assert body["url"].startswith("https://checkout.stripe.com/"), body["url"]

    def test_checkout_invalid_tier_422(self, owner_hdrs):
        r = requests.post(
            f"{BASE_URL}/api/v2/billing/checkout",
            headers={**owner_hdrs, "Content-Type": "application/json"},
            json={"tier": "diamond"},
            timeout=10,
        )
        assert r.status_code == 422

    def test_checkout_no_token_401(self):
        r = requests.post(
            f"{BASE_URL}/api/v2/billing/checkout",
            json={"tier": "growth"},
            timeout=10,
        )
        assert r.status_code == 401


# ---------- Health ---------------------------------------------------------
class TestHealth:
    def test_api_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "healthy"
