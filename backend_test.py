"""
Backend tests for UK Driving Portal — focused on the new
POST /api/maps/travel-time endpoint plus regression smoke tests
for auth, billing, and invite flows.

Run:
    python /app/backend_test.py
"""

import os
import sys
import time
import uuid
import json
from datetime import datetime, timezone, timedelta

import requests
from dotenv import load_dotenv

# Load frontend .env to get the public backend URL (matches what the app uses)
load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    print("ERROR: EXPO_PUBLIC_BACKEND_URL not set in /app/frontend/.env")
    sys.exit(2)

API = f"{BASE_URL}/api"

INSTRUCTOR = {"email": "instructor@demo.uk", "password": "password123"}
STUDENT = {"email": "student@demo.uk", "password": "password123"}

results = []  # list of (name, ok, detail)


def record(name: str, ok: bool, detail: str = ""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}  {detail}")
    results.append((name, ok, detail))


def login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    return r


# ---------- 1. AUTH LOGIN ----------
def test_auth_login():
    for label, creds in [("instructor", INSTRUCTOR), ("student", STUDENT)]:
        try:
            r = login(creds)
            ok = r.status_code == 200 and "access_token" in r.json() and r.json().get("user", {}).get("email") == creds["email"]
            record(
                f"auth/login ({label})",
                ok,
                f"status={r.status_code} body_keys={list(r.json().keys()) if r.headers.get('content-type','').startswith('application/json') else r.text[:120]}",
            )
        except Exception as e:
            record(f"auth/login ({label})", False, f"exception: {e}")


# ---------- helpers ----------
def get_token(creds):
    r = login(creds)
    r.raise_for_status()
    return r.json()["access_token"]


def auth_header(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- 2. TRAVEL TIME HAPPY PATH + CACHE ----------
TRAVEL_PAYLOAD_BASE = {
    "origin": "42 Pickwick Avenue, NW1 2AB",
    "destination": "12 Abbey Road, NW8 9AY",
}


def assert_travel_shape(body):
    expected = {
        "duration_minutes": int,
        "duration_in_traffic_minutes": int,
        "distance_km": float,
        "status": str,
        "cached": bool,
    }
    issues = []
    for k, t in expected.items():
        if k not in body:
            issues.append(f"missing {k}")
            continue
        v = body[k]
        # JSON ints can come back as Python int; distance_km should be number (int or float)
        if k == "distance_km":
            if not isinstance(v, (int, float)):
                issues.append(f"{k} not numeric ({type(v).__name__})")
        elif k in ("duration_minutes", "duration_in_traffic_minutes"):
            if not isinstance(v, int) or isinstance(v, bool):
                issues.append(f"{k} not int ({type(v).__name__}={v})")
        elif k == "status":
            if v != "fallback":
                issues.append(f"status expected 'fallback' got {v!r}")
        elif k == "cached":
            if not isinstance(v, bool):
                issues.append(f"cached not bool")
    return issues


def test_travel_happy_path_and_cache(token):
    # Use a unique payload each test run so cache state is clean
    unique_suffix = uuid.uuid4().hex[:8]
    payload = {
        "origin": f"{TRAVEL_PAYLOAD_BASE['origin']} ({unique_suffix})",
        "destination": f"{TRAVEL_PAYLOAD_BASE['destination']} ({unique_suffix})",
    }

    # First call
    r1 = requests.post(f"{API}/maps/travel-time", json=payload, headers=auth_header(token), timeout=15)
    if r1.status_code != 200:
        record("travel-time happy path (first call)", False, f"status={r1.status_code} body={r1.text[:200]}")
        return None, None

    b1 = r1.json()
    issues = assert_travel_shape(b1)
    record(
        "travel-time happy path (first call shape + status=fallback)",
        not issues,
        f"body={b1} issues={issues}",
    )

    # cached should be False on first call (no existing cache entry)
    record(
        "travel-time first call cached=False",
        b1.get("cached") is False,
        f"cached={b1.get('cached')}",
    )

    # Second call — should be cached
    r2 = requests.post(f"{API}/maps/travel-time", json=payload, headers=auth_header(token), timeout=15)
    if r2.status_code != 200:
        record("travel-time happy path (second call)", False, f"status={r2.status_code} body={r2.text[:200]}")
        return b1, None
    b2 = r2.json()
    record(
        "travel-time second call cached=True",
        b2.get("cached") is True,
        f"cached={b2.get('cached')}",
    )

    # Determinism: numbers must match across the two calls (same origin/dest)
    same_numbers = (
        b1["duration_minutes"] == b2["duration_minutes"]
        and b1["duration_in_traffic_minutes"] == b2["duration_in_traffic_minutes"]
        and b1["distance_km"] == b2["distance_km"]
    )
    record(
        "travel-time deterministic mock (same payload → same numbers)",
        same_numbers,
        f"first=({b1['duration_minutes']},{b1['duration_in_traffic_minutes']},{b1['distance_km']}) "
        f"second=({b2['duration_minutes']},{b2['duration_in_traffic_minutes']},{b2['distance_km']})",
    )

    return b1, b2


# ---------- 3. AUTH GATING ----------
def test_travel_auth_gating():
    r = requests.post(f"{API}/maps/travel-time", json=TRAVEL_PAYLOAD_BASE, timeout=15)
    ok = r.status_code in (401, 403)
    record("travel-time without Authorization → 401/403", ok, f"status={r.status_code} body={r.text[:120]}")

    # Bad token
    r2 = requests.post(
        f"{API}/maps/travel-time",
        json=TRAVEL_PAYLOAD_BASE,
        headers={"Authorization": "Bearer not-a-real-token"},
        timeout=15,
    )
    ok2 = r2.status_code in (401, 403)
    record("travel-time with invalid token → 401/403", ok2, f"status={r2.status_code}")


# ---------- 4. DEPARTURE_AT ----------
def test_travel_with_departure_at(token):
    unique_suffix = uuid.uuid4().hex[:8]
    payload = {
        "origin": f"Origin-{unique_suffix}",
        "destination": f"Destination-{unique_suffix}",
        "departure_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    }
    r = requests.post(f"{API}/maps/travel-time", json=payload, headers=auth_header(token), timeout=15)
    if r.status_code != 200:
        record("travel-time with departure_at (ISO timestamp)", False, f"status={r.status_code} body={r.text[:200]}")
        return
    body = r.json()
    issues = assert_travel_shape(body)
    record(
        "travel-time with departure_at (ISO timestamp) shape",
        not issues,
        f"body={body} issues={issues}",
    )


# ---------- 5. DETERMINISM (separate origin/destination consistency) ----------
def test_travel_determinism_pair_consistency(token):
    """Same exact origin+destination → consistent values across multiple fresh
    cache keys is hard to verify (cache hides repeats). Instead, verify the
    *initial* (uncached) call equals the deterministic mock formula by issuing
    two distinct payloads and checking each is self-consistent on its second
    (cached) call."""
    pair_a = {"origin": "A-place", "destination": "B-place"}
    pair_b = {"origin": "X-place", "destination": "Y-place"}

    a1 = requests.post(f"{API}/maps/travel-time", json=pair_a, headers=auth_header(token), timeout=15).json()
    a2 = requests.post(f"{API}/maps/travel-time", json=pair_a, headers=auth_header(token), timeout=15).json()
    b1 = requests.post(f"{API}/maps/travel-time", json=pair_b, headers=auth_header(token), timeout=15).json()

    ok = (
        a1["duration_minutes"] == a2["duration_minutes"]
        and a1["distance_km"] == a2["distance_km"]
        and (a1["duration_minutes"], a1["distance_km"]) != (b1["duration_minutes"], b1["distance_km"])
    )
    record(
        "travel-time deterministic across calls & distinct pairs differ",
        ok,
        f"A={a1['duration_minutes']}/{a1['distance_km']} B={b1['duration_minutes']}/{b1['distance_km']}",
    )


# ---------- 6. SMOKE: /auth/me ----------
def test_auth_me(token):
    r = requests.get(f"{API}/auth/me", headers=auth_header(token), timeout=15)
    ok = r.status_code == 200 and r.json().get("email") == INSTRUCTOR["email"]
    record("auth/me (instructor)", ok, f"status={r.status_code} body={r.text[:160]}")


# ---------- 6b. SMOKE: billing checkout ----------
def test_billing_checkout(token):
    r = requests.post(
        f"{API}/billing/create-checkout-session",
        json={},
        headers=auth_header(token),
        timeout=30,
    )
    if r.status_code == 400 and "already have an active Pro" in r.text:
        record("billing/create-checkout-session (already pro – acceptable)", True, r.text[:120])
        return
    ok = r.status_code == 200 and "url" in r.json() and r.json()["url"].startswith("https://checkout.stripe.com")
    record(
        "billing/create-checkout-session returns Stripe URL",
        ok,
        f"status={r.status_code} url={r.json().get('url','')[:80] if r.headers.get('content-type','').startswith('application/json') else r.text[:200]}",
    )


# ---------- 6c. SMOKE: invite-student ----------
def test_invite_student(token):
    unique_email = f"newstudent+{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{API}/instructor/invite-student",
        json={"email": unique_email, "name": "Test Student"},
        headers=auth_header(token),
        timeout=15,
    )
    if r.status_code != 200:
        record("instructor/invite-student", False, f"status={r.status_code} body={r.text[:200]}")
        return
    body = r.json()
    ok = (
        "invite_token" in body
        and "invite_url" in body
        and body["invite_url"].startswith("http")
        and "invite=" in body["invite_url"]
    )
    record("instructor/invite-student returns token+url", ok, f"url={body.get('invite_url','')[:120]}")


# ---------- MAIN ----------
def main():
    print(f"API base: {API}\n")

    test_auth_login()

    try:
        instructor_token = get_token(INSTRUCTOR)
    except Exception as e:
        record("acquire instructor token", False, f"login failed: {e}")
        print_summary()
        sys.exit(1)
    record("acquire instructor token", True, "")

    test_travel_happy_path_and_cache(instructor_token)
    test_travel_auth_gating()
    test_travel_with_departure_at(instructor_token)
    test_travel_determinism_pair_consistency(instructor_token)

    # Regression smoke
    test_auth_me(instructor_token)
    test_billing_checkout(instructor_token)
    test_invite_student(instructor_token)

    print_summary()


def print_summary():
    print("\n========= SUMMARY =========")
    passed = sum(1 for _, ok, _ in results if ok)
    failed = [r for r in results if not r[1]]
    print(f"Passed: {passed}/{len(results)}")
    if failed:
        print("Failed:")
        for n, _, d in failed:
            print(f"  - {n}: {d}")
    print("===========================")


if __name__ == "__main__":
    main()
