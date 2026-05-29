"""Backend test for Franchise-tier seat enforcement (6 scenarios).

1. Leaderboard new fields present (tier/seat_count/seat_limit/can_add_instructor)
2. Invite blocked on non-franchise tier (HTTP 402, no upstream invite call)
3. Tier flip → invite allowed (try/finally restore original tier)
4. Leaderboard reflects franchise upgrade (seat_limit=null, can_add=true)
5. Reassign regression — empty body → 200 {moved:0, skipped:0, errors:[]}
6. Regression smoke — /today, /broadcasts/gap, /maps/travel-time, /receipts/scan
"""
import os
import sys
import time
import uuid

import requests

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

PASSED = []
FAILED = []


def record(name, ok, msg=""):
    if ok:
        PASSED.append(name)
        print(f"  ✅ {name}")
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


def rest_get(path, params=None):
    return requests.get(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=sb_service_headers(),
        params=params,
        timeout=15,
    )


def rest_patch(path, payload, params=None):
    headers = sb_service_headers()
    headers["Prefer"] = "return=representation"
    return requests.patch(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=headers,
        params=params,
        json=payload,
        timeout=15,
    )


# Login
print("\n[Login] alex@adipro.uk")
try:
    OWNER_TOKEN = supabase_login(OWNER_EMAIL, OWNER_PASSWORD)
    print(f"  OK token={OWNER_TOKEN[:30]}...")
except Exception as e:
    print(f"  FATAL login failed: {e}")
    sys.exit(2)

ALEX_HDR = {"Authorization": f"Bearer {OWNER_TOKEN}"}

# Fetch alex school id + original tier
print("\n[Setup] Resolve alex's school + original tier")
sr = rest_get(
    "driving_schools",
    params={"owner_auth_id": f"eq.{ALEX_AUTH_UID}", "select": "id,tier,business_name"},
)
sr.raise_for_status()
rows = sr.json()
if not rows:
    print("  FATAL: no school found for alex")
    sys.exit(2)
ALEX_SCHOOL_ID = rows[0]["id"]
ORIGINAL_TIER = rows[0].get("tier") or "starter"
print(f"  school_id={ALEX_SCHOOL_ID} business={rows[0].get('business_name')!r} original_tier={ORIGINAL_TIER!r}")


# ============================================================================
# Scenario 1 — Leaderboard new fields
# ============================================================================
print("\n[1] Leaderboard new fields")
r = requests.get(f"{API_BASE}/v2/school/leaderboard", headers=ALEX_HDR, timeout=20)
if r.status_code != 200:
    record("1. GET /v2/school/leaderboard → 200", False, f"got {r.status_code} body={r.text[:200]}")
else:
    body = r.json()
    required = ["tier", "seat_count", "seat_limit", "can_add_instructor"]
    missing = [k for k in required if k not in body]
    if missing:
        record("1. Leaderboard fields present", False, f"missing: {missing}")
    else:
        record(
            "1. Leaderboard fields present",
            True,
            f"tier={body['tier']!r} seat_count={body['seat_count']} seat_limit={body['seat_limit']} can_add_instructor={body['can_add_instructor']}",
        )
        # Expected on starter seed: seat_count=1, seat_limit=1, can_add=false
        if ORIGINAL_TIER != "franchise":
            ok = (
                body["seat_count"] == 1
                and body["seat_limit"] == 1
                and body["can_add_instructor"] is False
            )
            record(
                "1b. Values match expected seed (non-franchise)",
                ok,
                f"observed: seat_count={body['seat_count']} seat_limit={body['seat_limit']} can_add={body['can_add_instructor']}",
            )


# ============================================================================
# Scenario 2 — Invite blocked on non-franchise tier (HTTP 402)
# ============================================================================
print("\n[2] Invite blocked on non-franchise tier (expect HTTP 402)")
# Ensure we're on a non-franchise tier first
if ORIGINAL_TIER == "franchise":
    print("  (original tier is franchise — temporarily setting to starter for this scenario)")
    rest_patch(
        "driving_schools",
        {"tier": "starter"},
        params={"id": f"eq.{ALEX_SCHOOL_ID}"},
    )

unique = uuid.uuid4().hex[:8]
blocked_email = f"blocked-test-{unique}@example.co.uk"

# Snapshot backend log size so we can check for upstream invite calls
LOG_PATH = "/var/log/supervisor/backend.out.log"
ERR_PATH = "/var/log/supervisor/backend.err.log"
log_before_size = 0
err_before_size = 0
try:
    log_before_size = os.path.getsize(LOG_PATH)
except Exception:
    pass
try:
    err_before_size = os.path.getsize(ERR_PATH)
except Exception:
    pass

r2 = requests.post(
    f"{API_BASE}/v2/instructors/invite",
    headers=ALEX_HDR,
    json={"email": blocked_email},
    timeout=20,
)
print(f"  HTTP {r2.status_code} body={r2.text[:300]}")
if r2.status_code == 402:
    try:
        detail = r2.json().get("detail", "")
    except Exception:
        detail = r2.text
    ok = "Upgrade to the Franchise tier" in detail
    record(
        "2. POST /v2/instructors/invite → 402",
        ok,
        f"detail={detail!r}",
    )
else:
    record(
        "2. POST /v2/instructors/invite → 402",
        False,
        f"expected 402, got {r2.status_code} body={r2.text[:200]}",
    )

# Check backend logs for short-circuit (no /auth/v1/invite call should appear after our snapshot)
time.sleep(0.5)
log_after = ""
err_after = ""
try:
    with open(LOG_PATH, "rb") as f:
        f.seek(log_before_size)
        log_after = f.read().decode("utf-8", errors="replace")
except Exception:
    pass
try:
    with open(ERR_PATH, "rb") as f:
        f.seek(err_before_size)
        err_after = f.read().decode("utf-8", errors="replace")
except Exception:
    pass
combined = log_after + err_after
invite_calls = [ln for ln in combined.splitlines() if "/auth/v1/invite" in ln]
record(
    "2b. No upstream /auth/v1/invite call during 402 short-circuit",
    len(invite_calls) == 0,
    f"upstream invite log lines = {len(invite_calls)}" + (f" — {invite_calls[:2]}" if invite_calls else ""),
)


# ============================================================================
# Scenario 3 — Tier flip → invite allowed (try/finally restore)
# ============================================================================
print("\n[3] Tier flip → invite allowed (with try/finally restore)")
patched_tier = None
try:
    pr = rest_patch(
        "driving_schools",
        {"tier": "franchise"},
        params={"id": f"eq.{ALEX_SCHOOL_ID}"},
    )
    if pr.status_code >= 400:
        record("3a. PATCH tier=franchise via service-role", False, f"{pr.status_code} {pr.text[:200]}")
    else:
        patched_tier = "franchise"
        record("3a. PATCH tier=franchise via service-role", True, f"{pr.status_code}")

    # Small delay to let the change propagate (service-role writes are immediate but be safe)
    time.sleep(0.5)

    allowed_email = f"allowed-test-{uuid.uuid4().hex[:8]}@example.co.uk"
    r3 = requests.post(
        f"{API_BASE}/v2/instructors/invite",
        headers=ALEX_HDR,
        json={"email": allowed_email, "full_name": "Test Sub Instructor"},
        timeout=20,
    )
    print(f"  HTTP {r3.status_code} body={r3.text[:300]}")
    if r3.status_code == 200:
        body = r3.json()
        ok = body.get("sent") is True
        record(
            "3b. POST /v2/instructors/invite (franchise tier) → 200 sent=true",
            ok,
            f"body={body}",
        )
    else:
        # Supabase already-exists path is acceptable (sent=false)
        record(
            "3b. POST /v2/instructors/invite (franchise tier) → 200",
            False,
            f"expected 200, got {r3.status_code} body={r3.text[:300]}",
        )

    # ============================================================================
    # Scenario 4 — Leaderboard reflects upgrade
    # ============================================================================
    print("\n[4] Leaderboard reflects franchise upgrade")
    r4 = requests.get(f"{API_BASE}/v2/school/leaderboard", headers=ALEX_HDR, timeout=20)
    if r4.status_code != 200:
        record("4. Leaderboard reflects franchise tier", False, f"{r4.status_code} {r4.text[:200]}")
    else:
        b4 = r4.json()
        tier_ok = b4.get("tier") == "franchise"
        sl_ok = b4.get("seat_limit") is None
        can_ok = b4.get("can_add_instructor") is True
        record(
            "4. Leaderboard tier=franchise, seat_limit=null, can_add_instructor=true",
            tier_ok and sl_ok and can_ok,
            f"tier={b4.get('tier')!r} seat_count={b4.get('seat_count')} seat_limit={b4.get('seat_limit')} can_add={b4.get('can_add_instructor')}",
        )

finally:
    # Always restore original tier
    print(f"\n[CLEANUP] Restoring tier → {ORIGINAL_TIER!r}")
    try:
        rr = rest_patch(
            "driving_schools",
            {"tier": ORIGINAL_TIER},
            params={"id": f"eq.{ALEX_SCHOOL_ID}"},
        )
        if rr.status_code < 400:
            # Verify
            vr = rest_get(
                "driving_schools",
                params={"id": f"eq.{ALEX_SCHOOL_ID}", "select": "tier"},
            )
            final_tier = (vr.json() or [{}])[0].get("tier")
            print(f"  Final tier in DB: {final_tier!r}")
            if final_tier != ORIGINAL_TIER:
                print(f"  ⚠️  WARNING: tier in DB is {final_tier!r}, expected {ORIGINAL_TIER!r}")
        else:
            print(f"  ⚠️  PATCH restore failed: {rr.status_code} {rr.text[:200]}")
    except Exception as e:
        print(f"  ⚠️  Exception during cleanup: {e}")


# ============================================================================
# Scenario 5 — Reassign regression
# ============================================================================
print("\n[5] Reassign regression — POST /v2/students/reassign assignments=[]")
r5 = requests.post(
    f"{API_BASE}/v2/students/reassign",
    headers=ALEX_HDR,
    json={"assignments": []},
    timeout=20,
)
if r5.status_code == 200:
    b5 = r5.json()
    ok = (
        b5.get("moved") == 0
        and b5.get("skipped") == 0
        and b5.get("errors") == []
    )
    record(
        "5. Reassign empty → 200 {moved:0, skipped:0, errors:[]}",
        ok,
        f"body={b5}",
    )
else:
    record(
        "5. Reassign empty → 200",
        False,
        f"got {r5.status_code} body={r5.text[:200]}",
    )


# ============================================================================
# Scenario 6 — Regression smoke
# ============================================================================
print("\n[6] Regression smoke")

# 6a — /v2/school/today
r6a = requests.get(f"{API_BASE}/v2/school/today", headers=ALEX_HDR, timeout=20)
record(
    "6a. GET /v2/school/today → 200",
    r6a.status_code == 200,
    f"{r6a.status_code} body[:200]={r6a.text[:200]}",
)

# 6b — /broadcasts/gap
r6b = requests.post(
    f"{API_BASE}/broadcasts/gap",
    headers=ALEX_HDR,
    json={"lesson_id": "88e0b2ed-45a3-442a-8da0-fc89ba8184d7"},
    timeout=20,
)
record(
    "6b. POST /broadcasts/gap (alex) → 200",
    r6b.status_code == 200,
    f"{r6b.status_code} body={r6b.text[:200]}",
)

# 6c — /maps/travel-time
r6c = requests.post(
    f"{API_BASE}/maps/travel-time",
    headers=ALEX_HDR,
    json={"origin": "NW8 9AY", "destination": "NW1 2AB"},
    timeout=20,
)
record(
    "6c. POST /maps/travel-time (alex) → 200",
    r6c.status_code == 200,
    f"{r6c.status_code} body={r6c.text[:200]}",
)

# 6d — /receipts/scan no bearer → 401
r6d = requests.post(
    f"{API_BASE}/receipts/scan",
    json={"image_base64": "x", "mime_type": "image/png"},
    timeout=20,
)
record(
    "6d. POST /receipts/scan (no bearer) → 401",
    r6d.status_code == 401,
    f"{r6d.status_code} body={r6d.text[:200]}",
)


# ============================================================================
# Summary
# ============================================================================
print("\n" + "=" * 80)
print(f"PASSED: {len(PASSED)}")
print(f"FAILED: {len(FAILED)}")
if FAILED:
    print("\nFailures:")
    for name, msg in FAILED:
        print(f"  ❌ {name}: {msg}")

sys.exit(0 if not FAILED else 1)
