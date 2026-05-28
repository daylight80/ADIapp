"""Backend test for owner-only multi-instructor dashboard endpoints.

Scenarios per review request:
  1. Auth gate (all 3 endpoints) — no Authorization → 401, garbage bearer → 401
  2. Owner happy path — GET /api/v2/school/leaderboard
  3. Owner happy path — GET /api/v2/school/today
  4. Owner happy path — POST /api/v2/instructors/invite
  5. Duplicate invite (same email)
  6. Non-owner gate (creates a throwaway Supabase user, logs in, expects 403)

Regression:
  R1. POST /api/broadcasts/gap (alex bearer, valid lesson_id) → 200
  R2. POST /api/receipts/scan auth gate (no bearer) → 401
  R3. POST /api/maps/travel-time (alex bearer) → 200
"""
import os
import random
import string
import sys
import time
import uuid

import requests

# ---------------------------------------------------------------------------
# Config — read from real env files only
# ---------------------------------------------------------------------------
FRONTEND_ENV = "/app/frontend/.env"
BACKEND_ENV = "/app/backend/.env"

SUPABASE_URL = None
SUPABASE_ANON_KEY = None
BACKEND_URL = None
SUPABASE_SERVICE_ROLE_KEY = None

with open(FRONTEND_ENV) as f:
    for line in f:
        line = line.strip()
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BACKEND_URL = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("EXPO_PUBLIC_SUPABASE_URL="):
            SUPABASE_URL = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("EXPO_PUBLIC_SUPABASE_ANON_KEY="):
            SUPABASE_ANON_KEY = line.split("=", 1)[1].strip().strip('"')

with open(BACKEND_ENV) as f:
    for line in f:
        line = line.strip()
        if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
            SUPABASE_SERVICE_ROLE_KEY = line.split("=", 1)[1].strip().strip('"')

API_BASE = f"{BACKEND_URL.rstrip('/')}/api"
print(f"Backend: {BACKEND_URL}")
print(f"Supabase: {SUPABASE_URL}")
print("=" * 80)

OWNER_EMAIL = "alex@adipro.uk"
OWNER_PASSWORD = "password123"

PASSED = []
FAILED = []


def record(name, ok, msg=""):
    if ok:
        PASSED.append(name)
        print(f"  ✅ {name}")
        if msg:
            print(f"     {msg}")
    else:
        FAILED.append((name, msg))
        print(f"  ❌ {name}")
        if msg:
            print(f"     {msg}")


def supabase_login(email, password):
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    r = requests.post(
        url,
        headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def supabase_admin_create_user(email, password):
    """Create a confirmed throwaway user via admin API (service-role)."""
    url = f"{SUPABASE_URL}/auth/v1/admin/users"
    r = requests.post(
        url,
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    return r


def supabase_admin_delete_user(user_id):
    url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}"
    return requests.delete(
        url,
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
        timeout=15,
    )


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
print("\n[setup] Login as owner alex@adipro.uk …")
try:
    OWNER_TOKEN = supabase_login(OWNER_EMAIL, OWNER_PASSWORD)
    print(f"  Token: {OWNER_TOKEN[:30]}…")
except Exception as e:
    print(f"  ❌ Owner login failed: {e}")
    sys.exit(1)

OWNER_HDR = {"Authorization": f"Bearer {OWNER_TOKEN}"}

# ---------------------------------------------------------------------------
# Scenario 1 — Auth gate on all 3 endpoints
# ---------------------------------------------------------------------------
print("\n[Scenario 1] Auth gate on all 3 endpoints")

endpoints = [
    ("POST /api/v2/instructors/invite", "POST", f"{API_BASE}/v2/instructors/invite", {"email": "x@example.co.uk"}),
    ("GET  /api/v2/school/leaderboard", "GET", f"{API_BASE}/v2/school/leaderboard", None),
    ("GET  /api/v2/school/today", "GET", f"{API_BASE}/v2/school/today", None),
]

for label, method, url, body in endpoints:
    # No Authorization header
    if method == "POST":
        r = requests.post(url, json=body, timeout=15)
    else:
        r = requests.get(url, timeout=15)
    record(f"{label} — no Authorization → 401",
           r.status_code == 401,
           f"got {r.status_code}: {r.text[:120]}")

    # Garbage bearer
    hdr_bad = {"Authorization": "Bearer garbage"}
    if method == "POST":
        r = requests.post(url, json=body, headers=hdr_bad, timeout=15)
    else:
        r = requests.get(url, headers=hdr_bad, timeout=15)
    record(f"{label} — Bearer garbage → 401",
           r.status_code == 401,
           f"got {r.status_code}: {r.text[:120]}")

# ---------------------------------------------------------------------------
# Scenario 2 — Owner happy path: leaderboard
# ---------------------------------------------------------------------------
print("\n[Scenario 2] Owner happy path — GET /api/v2/school/leaderboard")
r = requests.get(f"{API_BASE}/v2/school/leaderboard", headers=OWNER_HDR, timeout=20)
record("leaderboard returns 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")

if r.status_code == 200:
    j = r.json()
    print(f"  payload: school_id={j.get('school_id')} business='{j.get('business_name')}' month_iso={j.get('month_iso')}")
    print(f"  totals = {j.get('totals')}")
    print(f"  rows = {len(j.get('rows', []))}")
    for row in j.get("rows", []):
        print(f"    - {row.get('full_name')} (owner={row.get('is_owner')}) students={row.get('students_active')} lessons={row.get('lessons_month')} revenue=£{row.get('revenue_month')} pass={row.get('pass_rate')}%")

    record("rows has at least 1 entry", len(j.get("rows", [])) >= 1)
    totals = j.get("totals") or {}
    record("totals has all 4 keys",
           all(k in totals for k in ("students_active", "lessons_month", "revenue_month", "pass_rate")),
           f"keys: {list(totals.keys())}")
    from datetime import datetime, timezone
    expected_month = datetime.now(timezone.utc).strftime("%Y-%m")
    record(f"month_iso matches current month ({expected_month})",
           j.get("month_iso") == expected_month,
           f"got {j.get('month_iso')}")
    owner_rows = [row for row in j.get("rows", []) if row.get("is_owner")]
    record("alex's row has is_owner=true",
           len(owner_rows) >= 1 and any(
               (row.get("full_name") or "").lower().startswith("alex") or
               row.get("is_owner") for row in owner_rows
           ),
           f"owner rows: {[r.get('full_name') for r in owner_rows]}")

# ---------------------------------------------------------------------------
# Scenario 3 — Owner happy path: today
# ---------------------------------------------------------------------------
print("\n[Scenario 3] Owner happy path — GET /api/v2/school/today")
r = requests.get(f"{API_BASE}/v2/school/today", headers=OWNER_HDR, timeout=15)
record("today returns 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")

if r.status_code == 200:
    arr = r.json()
    record("today returns array (possibly empty)", isinstance(arr, list), f"type={type(arr)}")
    print(f"  rows: {len(arr)}")
    if arr:
        for row in arr[:5]:
            print(f"    - {row.get('start_time')} {row.get('instructor_name')} → {row.get('student_name')} ({row.get('status')})")
        # Each row should have non-empty instructor_name
        all_have_name = all((row.get("instructor_name") or "").strip() for row in arr)
        record("every row has non-empty instructor_name", all_have_name)
    else:
        print("  (no lessons today — array is empty; skipping per-row checks)")

# ---------------------------------------------------------------------------
# Scenario 4 — Owner happy path: invite
# ---------------------------------------------------------------------------
print("\n[Scenario 4] Owner happy path — POST /api/v2/instructors/invite")
random8 = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
INVITE_EMAIL = f"test-instructor-DELETE-ME-{random8}@example.co.uk"
print(f"  invite email: {INVITE_EMAIL}")

invite_body = {
    "email": INVITE_EMAIL,
    "full_name": "Test Sub Instructor",
    "adi_number": "999999",
}
r = requests.post(f"{API_BASE}/v2/instructors/invite", json=invite_body, headers=OWNER_HDR, timeout=30)
record("invite returns 200", r.status_code == 200, f"got {r.status_code}: {r.text[:300]}")
first_invite_body = None
if r.status_code == 200:
    j = r.json()
    first_invite_body = j
    print(f"  body: {j}")
    record("invite sent=true", j.get("sent") is True, f"sent={j.get('sent')}")
    record("invite detail mentions email",
           INVITE_EMAIL in (j.get("detail") or ""),
           f"detail='{j.get('detail')}'")

# ---------------------------------------------------------------------------
# Scenario 5 — Duplicate invite (same email)
# ---------------------------------------------------------------------------
print("\n[Scenario 5] Duplicate invite — same email again")
r = requests.post(f"{API_BASE}/v2/instructors/invite", json=invite_body, headers=OWNER_HDR, timeout=30)
record("duplicate invite returns 200", r.status_code == 200, f"got {r.status_code}: {r.text[:300]}")
if r.status_code == 200:
    j = r.json()
    print(f"  body: {j}")
    print(f"  → sent={j.get('sent')}, detail='{j.get('detail')}'")

# ---------------------------------------------------------------------------
# Scenario 6 — Non-owner gate (throwaway user via admin)
# ---------------------------------------------------------------------------
print("\n[Scenario 6] Non-owner gate — throwaway user via admin API")
throwaway_email = f"throwaway-{uuid.uuid4().hex[:8]}@example.co.uk"
throwaway_password = "Th!sIsTempPw" + uuid.uuid4().hex[:8]
throwaway_user_id = None

try:
    cr = supabase_admin_create_user(throwaway_email, throwaway_password)
    if cr.status_code >= 400:
        record("create throwaway user", False, f"admin create failed: {cr.status_code} {cr.text[:200]}")
    else:
        cu = cr.json()
        throwaway_user_id = cu.get("id") or (cu.get("user") or {}).get("id")
        print(f"  created throwaway user id={throwaway_user_id}")
        record("create throwaway user", throwaway_user_id is not None)

        throwaway_token = supabase_login(throwaway_email, throwaway_password)
        print(f"  throwaway token: {throwaway_token[:30]}…")
        throwaway_hdr = {"Authorization": f"Bearer {throwaway_token}"}

        # Try /v2/school/leaderboard — expect 403
        r = requests.get(f"{API_BASE}/v2/school/leaderboard", headers=throwaway_hdr, timeout=15)
        record("non-owner leaderboard → 403",
               r.status_code == 403,
               f"got {r.status_code}: {r.text[:200]}")
        # Also try /v2/school/today
        r = requests.get(f"{API_BASE}/v2/school/today", headers=throwaway_hdr, timeout=15)
        record("non-owner today → 403", r.status_code == 403, f"got {r.status_code}: {r.text[:200]}")
        # And /v2/instructors/invite
        r = requests.post(
            f"{API_BASE}/v2/instructors/invite",
            json={"email": "another@example.co.uk"},
            headers=throwaway_hdr,
            timeout=15,
        )
        record("non-owner invite → 403", r.status_code == 403, f"got {r.status_code}: {r.text[:200]}")
except Exception as e:
    record("non-owner gate scenario", False, f"exception: {e}")
finally:
    if throwaway_user_id:
        d = supabase_admin_delete_user(throwaway_user_id)
        print(f"  cleanup: delete throwaway user → {d.status_code}")

# ---------------------------------------------------------------------------
# Regression checks
# ---------------------------------------------------------------------------
print("\n[Regression] R1: POST /api/broadcasts/gap (alex bearer, valid lesson_id)")
lesson_id = "88e0b2ed-45a3-442a-8da0-fc89ba8184d7"
r = requests.post(
    f"{API_BASE}/broadcasts/gap",
    json={"lesson_id": lesson_id},
    headers=OWNER_HDR,
    timeout=20,
)
record("broadcasts/gap returns 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    print(f"  body: {r.json()}")

print("\n[Regression] R2: POST /api/receipts/scan auth gate (no bearer)")
r = requests.post(f"{API_BASE}/receipts/scan", json={"image_base64": "x"}, timeout=15)
record("receipts/scan no-auth → 401", r.status_code == 401, f"got {r.status_code}: {r.text[:200]}")

print("\n[Regression] R3: POST /api/maps/travel-time (alex bearer)")
r = requests.post(
    f"{API_BASE}/maps/travel-time",
    json={"origin": "12 Abbey Road, NW8 9AY", "destination": "42 Pickwick Avenue, NW1 2AB"},
    headers=OWNER_HDR,
    timeout=20,
)
record("maps/travel-time alex bearer → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    print(f"  body: {r.json()}")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print("\n" + "=" * 80)
print(f"PASSED: {len(PASSED)}")
print(f"FAILED: {len(FAILED)}")
if FAILED:
    print("\nFailures:")
    for name, msg in FAILED:
        print(f"  ❌ {name}")
        if msg:
            print(f"     {msg}")
sys.exit(0 if not FAILED else 1)
