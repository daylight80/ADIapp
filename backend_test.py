"""Backend tests for Smart Gap broadcast + regression smoke.

Targets the public preview URL via EXPO_PUBLIC_BACKEND_URL.
"""
import os
import sys
import json
import time
from pathlib import Path
import requests

# ---- Load frontend/.env to get the public preview URL + Supabase config ----
ENV = {}
for line in Path("/app/frontend/.env").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    ENV[k.strip()] = v.strip().strip('"').strip("'")

BACKEND_URL = ENV.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
SUPABASE_URL = ENV.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON = ENV.get("EXPO_PUBLIC_SUPABASE_ANON_KEY", "")

API = f"{BACKEND_URL}/api"

# Backend service role key for direct Supabase queries (to discover a lesson id)
BACKEND_ENV = {}
for line in Path("/app/backend/.env").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    BACKEND_ENV[k.strip()] = v.strip().strip('"').strip("'")

SERVICE_ROLE_KEY = BACKEND_ENV.get("SUPABASE_SERVICE_ROLE_KEY", "")

EMAIL = "alex@adipro.uk"
PASSWORD = "password123"

PASS = []
FAIL = []


def ok(name, detail=""):
    PASS.append(name)
    print(f"  PASS  {name}  {detail}")


def bad(name, detail=""):
    FAIL.append(f"{name}: {detail}")
    print(f"  FAIL  {name}  {detail}")


def section(title):
    print(f"\n=== {title} ===")


section("0. Environment")
print(f"BACKEND_URL = {BACKEND_URL}")
print(f"SUPABASE_URL = {SUPABASE_URL}")

if not BACKEND_URL or not SUPABASE_URL or not SUPABASE_ANON:
    print("Missing required env. Aborting.")
    sys.exit(1)

# 1. Login
section("1. Supabase login (alex@adipro.uk)")
SB_ACCESS_TOKEN = ""
try:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
        json={"email": EMAIL, "password": PASSWORD},
        timeout=15,
    )
    if r.status_code == 200:
        SB_ACCESS_TOKEN = r.json().get("access_token", "")
        ok("supabase_login", f"token len={len(SB_ACCESS_TOKEN)}")
    else:
        bad("supabase_login", f"HTTP {r.status_code} {r.text[:200]}")
except Exception as e:
    bad("supabase_login", repr(e))

# 2. Smoke GET /api/
section("2. Regression GET /api/")
try:
    r = requests.get(f"{API}/", timeout=15)
    if r.status_code == 200 and r.json().get("status") == "ok":
        ok("GET /api/", f"-> {r.json()}")
    else:
        bad("GET /api/", f"HTTP {r.status_code} {r.text[:200]}")
except Exception as e:
    bad("GET /api/", repr(e))

# 3. Auth gates for /api/broadcasts/gap
section("3. /api/broadcasts/gap auth gates")
try:
    r = requests.post(f"{API}/broadcasts/gap", json={"lesson_id": "00000000-0000-0000-0000-000000000000"}, timeout=15)
    if r.status_code == 401:
        ok("no-auth -> 401", f"detail={r.json().get('detail')}")
    else:
        bad("no-auth -> 401", f"got {r.status_code} {r.text[:200]}")
except Exception as e:
    bad("no-auth -> 401", repr(e))

try:
    r = requests.post(
        f"{API}/broadcasts/gap",
        json={"lesson_id": "00000000-0000-0000-0000-000000000000"},
        headers={"Authorization": "Bearer not-a-valid-token"},
        timeout=15,
    )
    if r.status_code == 401:
        ok("bad-bearer -> 401", f"detail={r.json().get('detail')}")
    else:
        bad("bad-bearer -> 401", f"got {r.status_code} {r.text[:200]}")
except Exception as e:
    bad("bad-bearer -> 401", repr(e))

if not SB_ACCESS_TOKEN:
    print("\nCannot continue without Supabase token.")
    sys.exit(1)

AUTH = {"Authorization": f"Bearer {SB_ACCESS_TOKEN}"}

# 4. Missing lesson -> 404
section("4. /api/broadcasts/gap missing lesson (zero UUID)")
try:
    r = requests.post(
        f"{API}/broadcasts/gap",
        json={"lesson_id": "00000000-0000-0000-0000-000000000000"},
        headers=AUTH,
        timeout=20,
    )
    print(f"  HTTP {r.status_code} body={r.text[:400]}")
    if r.status_code == 404 and "not found" in r.json().get("detail", "").lower():
        ok("missing-lesson -> 404", f"detail={r.json().get('detail')}")
    elif r.status_code == 500 and ("waiting_list" in r.text.lower() or "relation" in r.text.lower()):
        bad("missing-lesson", f"500 — Migration 007 (waiting_list) NOT applied: {r.text[:300]}")
    else:
        bad("missing-lesson -> 404", f"got {r.status_code} {r.text[:300]}")
except Exception as e:
    bad("missing-lesson -> 404", repr(e))

# 5. Discover lesson_ids
section("5. Discover lesson ids via Supabase service-role REST")
real_lesson_id = ""
foreign_lesson_id = ""
school_id = ""
try:
    ru = requests.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={"apikey": SUPABASE_ANON, "Authorization": f"Bearer {SB_ACCESS_TOKEN}"},
        timeout=10,
    )
    alex_uid = ru.json().get("id") if ru.status_code == 200 else ""
    print(f"  alex uid = {alex_uid}")

    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/driving_schools",
        params={"select": "id,owner_auth_id,business_name"},
        headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
        timeout=15,
    )
    schools = r.json() if r.status_code == 200 else []
    print(f"  total schools: {len(schools)}")

    for s in schools:
        if s.get("owner_auth_id") == alex_uid:
            school_id = s["id"]
            print(f"  alex school_id = {school_id} ({s.get('business_name')})")
            break

    # Find alex's instructor.id (alex.auth_user_id = e6e9091a-cd7d-4819-87bc-2bf03f436a65 per task)
    alex_instructor_id = ""
    if alex_uid:
        ri = requests.get(
            f"{SUPABASE_URL}/rest/v1/instructors",
            params={"auth_user_id": f"eq.{alex_uid}", "select": "id,school_id"},
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
            timeout=15,
        )
        irows = ri.json() if ri.status_code == 200 else []
        if irows:
            alex_instructor_id = irows[0]["id"]
            if not school_id:
                school_id = irows[0].get("school_id", "")
            print(f"  alex instructor_id = {alex_instructor_id} school_id={school_id}")
        else:
            print(f"  instructors lookup -> HTTP {ri.status_code} {ri.text[:200]}")

    if alex_instructor_id:
        rl = requests.get(
            f"{SUPABASE_URL}/rest/v1/lessons",
            params={
                "instructor_id": f"eq.{alex_instructor_id}",
                "select": "id,instructor_id,start_time,end_time,topic",
                "limit": "1",
            },
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
            timeout=15,
        )
        rows = rl.json() if rl.status_code == 200 else []
        if rows:
            real_lesson_id = rows[0]["id"]
            ok("discover-own-lesson", f"id={real_lesson_id} start={rows[0].get('start_time')} end={rows[0].get('end_time')}")
        else:
            bad("discover-own-lesson", f"no lessons for instructor {alex_instructor_id} HTTP {rl.status_code} {rl.text[:200]}")

    # Foreign lesson — find a lesson whose instructor is NOT alex's
    if alex_instructor_id:
        rf = requests.get(
            f"{SUPABASE_URL}/rest/v1/lessons",
            params={
                "instructor_id": f"neq.{alex_instructor_id}",
                "select": "id,instructor_id",
                "limit": "1",
            },
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
            timeout=15,
        )
        rrows = rf.json() if rf.status_code == 200 else []
        if rrows:
            foreign_lesson_id = rrows[0]["id"]
            print(f"  foreign_lesson_id = {foreign_lesson_id} (instructor {rrows[0]['instructor_id']})")
        else:
            print("  no foreign lessons available")
except Exception as e:
    bad("discover-lessons", repr(e))

# 6. Happy path
section("6. /api/broadcasts/gap happy path (own lesson)")
if real_lesson_id:
    try:
        r = requests.post(
            f"{API}/broadcasts/gap",
            json={"lesson_id": real_lesson_id},
            headers=AUTH,
            timeout=30,
        )
        print(f"  HTTP {r.status_code} body={r.text[:500]}")
        if r.status_code == 200:
            body = r.json()
            keys_ok = {"sent", "skipped", "detail"}.issubset(body.keys())
            types_ok = isinstance(body.get("sent"), int) and isinstance(body.get("skipped"), int) and isinstance(body.get("detail"), str)
            if keys_ok and types_ok:
                ok("happy-path 200 shape", f"sent={body['sent']} skipped={body['skipped']} detail={body['detail']!r}")
            else:
                bad("happy-path shape", f"body={body}")
        elif r.status_code == 500 and ("waiting_list" in r.text.lower() or "relation" in r.text.lower()):
            bad("happy-path", f"500 — Migration 007 NOT applied: {r.text[:300]}")
        else:
            bad("happy-path", f"HTTP {r.status_code} {r.text[:300]}")
    except Exception as e:
        bad("happy-path", repr(e))
else:
    print("  SKIPPED — no real lesson available")

# 7. Foreign lesson 403
section("7. /api/broadcasts/gap foreign lesson -> 403")
if foreign_lesson_id and foreign_lesson_id != real_lesson_id:
    try:
        r = requests.post(
            f"{API}/broadcasts/gap",
            json={"lesson_id": foreign_lesson_id},
            headers=AUTH,
            timeout=30,
        )
        print(f"  HTTP {r.status_code} body={r.text[:400]}")
        if r.status_code == 403:
            ok("foreign-lesson -> 403", f"detail={r.json().get('detail')}")
        else:
            bad("foreign-lesson -> 403", f"HTTP {r.status_code} {r.text[:300]}")
    except Exception as e:
        bad("foreign-lesson -> 403", repr(e))
else:
    print("  SKIPPED — no foreign lesson available (single-school db)")

# 8. v2 billing checkout
section("8. Regression /api/v2/billing/checkout (tier=pro)")
try:
    r = requests.post(
        f"{API}/v2/billing/checkout",
        json={"tier": "pro", "seat_count": 1},
        headers=AUTH,
        timeout=30,
    )
    print(f"  HTTP {r.status_code} body={r.text[:300]}")
    if r.status_code == 200:
        body = r.json()
        url = body.get("url", "")
        if url.startswith("https://checkout.stripe.com"):
            ok("billing-v2 checkout 200", f"url={url[:80]}...")
        else:
            bad("billing-v2 checkout url", f"body={body}")
    elif r.status_code == 400:
        # acceptable e.g. already on tier
        ok("billing-v2 checkout 400 (acceptable)", f"detail={r.json().get('detail')}")
    else:
        bad("billing-v2 checkout", f"HTTP {r.status_code} {r.text[:300]}")
except Exception as e:
    bad("billing-v2 checkout", repr(e))

# 9. /api/maps/travel-time
section("9. Regression /api/maps/travel-time")
try:
    payload = {"origin": "12 Abbey Road, NW8 9AY", "destination": "42 Pickwick Avenue, NW1 2AB"}
    # First try supabase bearer (will likely 401 since endpoint uses legacy JWT)
    r = requests.post(f"{API}/maps/travel-time", json=payload, headers=AUTH, timeout=20)
    print(f"  with supabase bearer -> HTTP {r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        ok("travel-time (supabase bearer)", f"{r.json()}")
    elif r.status_code == 401:
        # Try legacy login
        rl = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
        print(f"  /api/auth/login -> HTTP {rl.status_code} {rl.text[:200]}")
        if rl.status_code == 200:
            legacy = rl.json().get("access_token") or rl.json().get("token") or ""
            r2 = requests.post(
                f"{API}/maps/travel-time",
                json=payload,
                headers={"Authorization": f"Bearer {legacy}"},
                timeout=20,
            )
            print(f"  with legacy bearer -> HTTP {r2.status_code} {r2.text[:200]}")
            if r2.status_code == 200:
                ok("travel-time (legacy bearer)", f"{r2.json()}")
            else:
                bad("travel-time (legacy bearer)", f"HTTP {r2.status_code}")
        else:
            bad("travel-time", "supabase bearer 401 + legacy /api/auth/login not usable for alex (Supabase-only account). Endpoint still requires legacy JWT — note for main agent.")
    else:
        bad("travel-time", f"HTTP {r.status_code} {r.text[:300]}")
except Exception as e:
    bad("travel-time", repr(e))

# Summary
section("SUMMARY")
print(f"PASSED: {len(PASS)}")
for p in PASS:
    print(f"  PASS  {p}")
print(f"FAILED: {len(FAIL)}")
for f in FAIL:
    print(f"  FAIL  {f}")

sys.exit(0 if not FAIL else 1)
