"""Backend test for POST /api/v2/students/reassign (owner-only reassignment).

Scenarios per review request:
  1. Auth gate - no Authorization → 401, garbage bearer → 401
  2. Non-owner gate - throwaway Supabase user → 403
  3. Empty assignments → 200 {moved:0, skipped:0, errors:[]}
  4. Foreign instructor id (random UUID) → 200 {moved:0, skipped:1, errors:[…"not part of your school"]}
  5. Foreign student id (random UUID) with real instructor → 200 {moved:0, skipped:1, errors:[…"not in your school"]}
  6. No-op (already assigned) → 200 {moved:0, skipped:1, errors:[]}
  7. Round-trip happy path - temporarily unassign Jamie, reassign via endpoint → moved:1, restore

Regression smoke:
  R1. GET /api/v2/school/leaderboard with alex bearer → 200
  R2. GET /api/v2/school/today with alex bearer → 200
"""
import os
import sys
import time
import uuid

import requests

# ---------------------------------------------------------------------------
# Config
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
ALEX_AUTH_UID = "e6e9091a-cd7d-4819-87bc-2bf03f436a65"
JAMIE_STUDENT_ID = "a26d8e54-2822-46e6-9325-e3ab4882b3ab"

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


def sb_service_headers():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def supabase_admin_create_user(email, password):
    url = f"{SUPABASE_URL}/auth/v1/admin/users"
    return requests.post(
        url,
        headers=sb_service_headers(),
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )


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


def sb_rest_get(path, params=None):
    return requests.get(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=sb_service_headers(),
        params=params or {},
        timeout=15,
    )


def sb_rest_patch(path, params, json_body):
    headers = {**sb_service_headers(), "Prefer": "return=representation"}
    return requests.patch(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=headers,
        params=params,
        json=json_body,
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

print("\n[setup] Discover alex's instructor.id via service-role REST …")
try:
    r = sb_rest_get(
        "instructors",
        params={"auth_user_id": f"eq.{ALEX_AUTH_UID}", "select": "id,school_id,full_name"},
    )
    if r.status_code >= 400 or not r.json():
        print(f"  ❌ failed to load alex's instructor row: {r.status_code} {r.text[:200]}")
        sys.exit(1)
    ALEX_INSTRUCTOR_ID = r.json()[0]["id"]
    ALEX_SCHOOL_ID = r.json()[0]["school_id"]
    print(f"  alex instructor_id = {ALEX_INSTRUCTOR_ID}")
    print(f"  alex school_id     = {ALEX_SCHOOL_ID}")
except Exception as e:
    print(f"  ❌ exception: {e}")
    sys.exit(1)

# Capture Jamie's current state for restore
print("\n[setup] Inspect Jamie Williams (student baseline) …")
jr = sb_rest_get(
    "students",
    params={"id": f"eq.{JAMIE_STUDENT_ID}", "select": "id,full_name,instructor_id,school_id"},
)
if jr.status_code >= 400 or not jr.json():
    print(f"  ❌ couldn't load Jamie: {jr.status_code} {jr.text[:200]}")
    sys.exit(1)
JAMIE_ORIGINAL_INSTRUCTOR = jr.json()[0].get("instructor_id")
JAMIE_SCHOOL = jr.json()[0].get("school_id")
print(f"  Jamie original instructor_id={JAMIE_ORIGINAL_INSTRUCTOR} school={JAMIE_SCHOOL}")
record(
    "Jamie belongs to alex's school",
    JAMIE_SCHOOL == ALEX_SCHOOL_ID,
    f"jamie.school={JAMIE_SCHOOL} alex.school={ALEX_SCHOOL_ID}",
)

REASSIGN_URL = f"{API_BASE}/v2/students/reassign"

# ---------------------------------------------------------------------------
# Scenario 1 — Auth gate
# ---------------------------------------------------------------------------
print("\n[Scenario 1] Auth gate")
r = requests.post(REASSIGN_URL, json={"assignments": []}, timeout=15)
record(
    "no Authorization → 401",
    r.status_code == 401,
    f"got {r.status_code}: {r.text[:200]}",
)

r = requests.post(
    REASSIGN_URL,
    json={"assignments": []},
    headers={"Authorization": "Bearer garbage"},
    timeout=15,
)
record(
    "Bearer garbage → 401",
    r.status_code == 401,
    f"got {r.status_code}: {r.text[:200]}",
)

# ---------------------------------------------------------------------------
# Scenario 2 — Non-owner gate
# ---------------------------------------------------------------------------
print("\n[Scenario 2] Non-owner gate (throwaway Supabase user)")
throwaway_email = f"throwaway-reassign-{uuid.uuid4().hex[:8]}@example.co.uk"
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
        throwaway_hdr = {"Authorization": f"Bearer {throwaway_token}"}

        r = requests.post(
            REASSIGN_URL,
            json={"assignments": []},
            headers=throwaway_hdr,
            timeout=15,
        )
        record(
            "non-owner reassign → 403",
            r.status_code == 403,
            f"got {r.status_code}: {r.text[:200]}",
        )
        if r.status_code == 403:
            detail = (r.json() or {}).get("detail") or ""
            record(
                "403 detail mentions 'Only the school owner can reassign students'",
                "Only the school owner can reassign students" in detail,
                f"detail='{detail}'",
            )
except Exception as e:
    record("non-owner gate scenario", False, f"exception: {e}")
finally:
    if throwaway_user_id:
        d = supabase_admin_delete_user(throwaway_user_id)
        print(f"  cleanup: delete throwaway user → {d.status_code}")

# ---------------------------------------------------------------------------
# Scenario 3 — Empty assignments
# ---------------------------------------------------------------------------
print("\n[Scenario 3] Empty assignments")
r = requests.post(REASSIGN_URL, json={"assignments": []}, headers=OWNER_HDR, timeout=15)
record("empty assignments → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    j = r.json()
    print(f"  body: {j}")
    record(
        "empty → moved=0 skipped=0 errors=[]",
        j == {"moved": 0, "skipped": 0, "errors": []},
        f"body={j}",
    )

# ---------------------------------------------------------------------------
# Scenario 4 — Foreign instructor id
# ---------------------------------------------------------------------------
print("\n[Scenario 4] Foreign instructor id (random UUID)")
fake_instructor = str(uuid.uuid4())
body = {
    "assignments": [
        {"student_id": JAMIE_STUDENT_ID, "new_instructor_id": fake_instructor}
    ]
}
r = requests.post(REASSIGN_URL, json=body, headers=OWNER_HDR, timeout=15)
record("foreign instructor → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    j = r.json()
    print(f"  body: {j}")
    record("foreign instructor → moved=0", j.get("moved") == 0, f"moved={j.get('moved')}")
    record("foreign instructor → skipped=1", j.get("skipped") == 1, f"skipped={j.get('skipped')}")
    errors = j.get("errors") or []
    record(
        "errors mention 'not part of your school'",
        any("not part of your school" in e for e in errors),
        f"errors={errors}",
    )

# ---------------------------------------------------------------------------
# Scenario 5 — Foreign student id
# ---------------------------------------------------------------------------
print("\n[Scenario 5] Foreign student id (random UUID) + real instructor")
fake_student = str(uuid.uuid4())
body = {
    "assignments": [
        {"student_id": fake_student, "new_instructor_id": ALEX_INSTRUCTOR_ID}
    ]
}
r = requests.post(REASSIGN_URL, json=body, headers=OWNER_HDR, timeout=15)
record("foreign student → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    j = r.json()
    print(f"  body: {j}")
    record("foreign student → moved=0", j.get("moved") == 0, f"moved={j.get('moved')}")
    record("foreign student → skipped=1", j.get("skipped") == 1, f"skipped={j.get('skipped')}")
    errors = j.get("errors") or []
    record(
        "errors mention 'not in your school'",
        any("not in your school" in e for e in errors),
        f"errors={errors}",
    )

# ---------------------------------------------------------------------------
# Scenario 6 — No-op (already assigned)
# ---------------------------------------------------------------------------
print("\n[Scenario 6] No-op — Jamie already assigned to alex")
# Ensure Jamie IS assigned to alex's instructor (he should be per seed; if not, restore now).
if JAMIE_ORIGINAL_INSTRUCTOR != ALEX_INSTRUCTOR_ID:
    print(f"  pre-step: PATCH Jamie back to alex's instructor (was {JAMIE_ORIGINAL_INSTRUCTOR})")
    sb_rest_patch(
        "students",
        params={"id": f"eq.{JAMIE_STUDENT_ID}"},
        json_body={"instructor_id": ALEX_INSTRUCTOR_ID},
    )

body = {
    "assignments": [
        {"student_id": JAMIE_STUDENT_ID, "new_instructor_id": ALEX_INSTRUCTOR_ID}
    ]
}
r = requests.post(REASSIGN_URL, json=body, headers=OWNER_HDR, timeout=15)
record("no-op → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
if r.status_code == 200:
    j = r.json()
    print(f"  body: {j}")
    record("no-op → moved=0", j.get("moved") == 0, f"moved={j.get('moved')}")
    record("no-op → skipped=1", j.get("skipped") == 1, f"skipped={j.get('skipped')}")
    record(
        "no-op → errors=[] (no error, just skipped)",
        (j.get("errors") or []) == [],
        f"errors={j.get('errors')}",
    )

# ---------------------------------------------------------------------------
# Scenario 7 — Round-trip happy path (true move via temporary 2nd instructor)
# Seed only has one instructor in alex's school, and `students.instructor_id`
# is NOT NULL, so we create a throwaway 2nd instructor row in the same school
# via service-role REST, move Jamie alex→temp, then move Jamie temp→alex
# through the endpoint to exercise the real `moved` code path.
# ---------------------------------------------------------------------------
print("\n[Scenario 7] Round-trip happy path — create temp instructor, move Jamie temp→alex via endpoint")
temp_instructor_id = None
try:
    # Insert temp instructor in alex's school (service-role REST)
    new_row = {
        "school_id": ALEX_SCHOOL_ID,
        "full_name": f"TEMP DELETE-ME {uuid.uuid4().hex[:6]}",
        "adi_number": f"T{uuid.uuid4().hex[:6].upper()}",
    }
    ir = requests.post(
        f"{SUPABASE_URL}/rest/v1/instructors",
        headers={**sb_service_headers(), "Prefer": "return=representation"},
        json=new_row,
        timeout=15,
    )
    if ir.status_code >= 400 or not ir.json():
        # Expected in single-instructor (Solo) tier - DB trigger raises
        # INSTRUCTOR_LIMIT_REACHED. Review request explicitly allowed skipping
        # this scenario when ≥2 instructors aren't available.
        print(
            f"  ⚠ SKIP true-move scenario: cannot add 2nd instructor in alex's school "
            f"(DB trigger blocks insert: {ir.status_code} {ir.text[:200]})"
        )
        print(
            "  Note: review request anticipated this — true move requires ≥2 instructors "
            "which don't exist in seed data (INSTRUCTOR_LIMIT_REACHED / Franchise-tier gate). "
            "Validation-logic scenarios 1-6 still exercise auth, ownership, school-membership "
            "of instructor & student, and the no-op path. Only the final `moved += 1` branch "
            "is not directly hit by this test."
        )
    else:
        temp_instructor_id = ir.json()[0]["id"]
        record("pre-step: create temp instructor in alex's school", True,
               f"temp instructor id={temp_instructor_id}")

        # Step A: move Jamie alex→temp via service-role PATCH (set up the state)
        pr = sb_rest_patch(
            "students",
            params={"id": f"eq.{JAMIE_STUDENT_ID}"},
            json_body={"instructor_id": temp_instructor_id},
        )
        record(
            "pre-step: move Jamie to temp instructor (service-role PATCH)",
            pr.status_code < 400,
            f"PATCH returned {pr.status_code}: {pr.text[:200]}",
        )

        # Step B: use the endpoint to move Jamie temp→alex (the REAL move)
        body = {
            "assignments": [
                {"student_id": JAMIE_STUDENT_ID, "new_instructor_id": ALEX_INSTRUCTOR_ID}
            ]
        }
        r = requests.post(REASSIGN_URL, json=body, headers=OWNER_HDR, timeout=20)
        record("reassign endpoint call → 200", r.status_code == 200,
               f"got {r.status_code}: {r.text[:200]}")
        if r.status_code == 200:
            j = r.json()
            print(f"  body: {j}")
            record("round-trip → moved=1", j.get("moved") == 1, f"moved={j.get('moved')}")
            record("round-trip → skipped=0", j.get("skipped") == 0, f"skipped={j.get('skipped')}")
            record("round-trip → errors=[]",
                   (j.get("errors") or []) == [], f"errors={j.get('errors')}")

        # Step C: verify Jamie is now back to alex's instructor
        v = sb_rest_get(
            "students",
            params={"id": f"eq.{JAMIE_STUDENT_ID}", "select": "id,instructor_id"},
        )
        cur = (v.json() or [{}])[0].get("instructor_id")
        record(
            "post-step: Jamie.instructor_id == alex's instructor",
            cur == ALEX_INSTRUCTOR_ID,
            f"got {cur} (expected {ALEX_INSTRUCTOR_ID})",
        )
except Exception as e:
    record("round-trip scenario", False, f"exception: {e}")
finally:
    # Safety net: ensure Jamie is back on alex
    sb_rest_patch(
        "students",
        params={"id": f"eq.{JAMIE_STUDENT_ID}"},
        json_body={"instructor_id": ALEX_INSTRUCTOR_ID},
    )
    # Clean up temp instructor
    if temp_instructor_id:
        d = requests.delete(
            f"{SUPABASE_URL}/rest/v1/instructors",
            headers=sb_service_headers(),
            params={"id": f"eq.{temp_instructor_id}"},
            timeout=15,
        )
        print(f"  cleanup: delete temp instructor {temp_instructor_id} → {d.status_code}")
    v = sb_rest_get(
        "students",
        params={"id": f"eq.{JAMIE_STUDENT_ID}", "select": "id,instructor_id,full_name"},
    )
    print(f"  final Jamie state: {v.json()}")

# ---------------------------------------------------------------------------
# Regression smoke
# ---------------------------------------------------------------------------
print("\n[Regression R1] GET /api/v2/school/leaderboard with alex bearer")
r = requests.get(f"{API_BASE}/v2/school/leaderboard", headers=OWNER_HDR, timeout=20)
record("leaderboard → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")

print("\n[Regression R2] GET /api/v2/school/today with alex bearer")
r = requests.get(f"{API_BASE}/v2/school/today", headers=OWNER_HDR, timeout=15)
record("today → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")

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
