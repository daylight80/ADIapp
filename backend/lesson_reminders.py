"""
ADI Pro — Lesson Reminder Dispatcher
====================================

Sends Expo push notifications to STUDENTS at three fixed intervals before a
lesson starts: 48 hours, 25 hours, and 1 hour.

Design notes
------------
* Runs as an in-process APScheduler background job inside the FastAPI app.
  The job ticks every REMINDER_TICK_MIN minutes (default 5) and looks for
  lessons falling inside (target_offset ± REMINDER_WINDOW_MIN minutes).
* The window MUST be at least as large as the tick, otherwise a lesson can
  slip through between two ticks. We use ±5 minutes by default to stay
  resilient to small clock skew and brief outages.
* Anti-duplicate: every (lesson_id, kind) sent is logged to
  `public.lesson_reminder_log` (migration 017). We refuse to send a
  reminder if the row already exists.
* Cancelled lessons are skipped.
* Lessons whose student has no `auth_user_id` (i.e. student account not
  linked / not invited yet) are skipped silently.
* Lessons whose student has no `push_tokens` row are skipped silently —
  the student hasn't installed the app or hasn't granted notification
  permission. Per product spec, no SMS/email fallback in MVP.
* Pushes are fanned out in a single batched POST to the Expo Push API.

This module is intentionally self-contained — it does NOT depend on the
rest of the FastAPI app's request-scoped helpers. It uses the
SUPABASE_SERVICE_ROLE_KEY directly to bypass RLS, since the scheduler is
a system actor.
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

log = logging.getLogger("lesson_reminders")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REMINDER_TICK_MIN = 5          # how often we poll for due reminders
REMINDER_WINDOW_MIN = 5        # ± window around the target offset in minutes
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"

# How long to wait after sending before checking whether it was delivered.
# Expo's own guidance is to wait at least 15 minutes before checking
# receipts, since delivery to APNs/FCM isn't instant and checking too
# early just wastes the call. We wait a little past that for headroom.
RECEIPT_CHECK_TICK_MIN = 20
RECEIPT_MIN_AGE_MIN = 15
# Stop checking receipts for anything older than this — Expo discards
# ticket receipts after roughly a day, and by then the "amber" state has
# lost most of its usefulness anyway (the lesson itself is long past for
# the 1h/25h kinds, and close to it for 48h).
RECEIPT_MAX_AGE_HOURS = 24

# Three target offsets (in minutes before lesson start) and their "kind" tags
# stored in lesson_reminder_log to prevent duplicates. The title is the
# user-facing notification heading; the body is composed in _build_message().
REMINDER_OFFSETS = [
    {"kind": "h48", "minutes": 48 * 60, "label": "Lesson reminder"},
    {"kind": "h25", "minutes": 25 * 60, "label": "Lesson tomorrow"},
    {"kind": "h1",  "minutes":      60, "label": "Lesson in 1 hour"},
]

# Growth+ feature per tiers.ts's isPaidTier (31 Aug 2026, tier-gating
# audit) — this dispatcher previously sent to every student regardless of
# their instructor's tier, with zero tier-checking anywhere in this file.
# Mirrors the frontend's isPaidTier() exactly, including its "unknown tier
# defaults to Starter" behaviour (tierById() falls back to TIERS[0]) — an
# instructor with a missing/unrecognised tier should not receive a paid
# feature by accident.
PAID_TIERS = {"growth", "pro", "franchise"}


def _is_paid_tier(tier: Optional[str]) -> bool:
    return tier in PAID_TIERS

_scheduler: Optional[AsyncIOScheduler] = None


def _sb_url() -> Optional[str]:
    return os.getenv("SUPABASE_URL") or None


def _sb_key() -> Optional[str]:
    return os.getenv("SUPABASE_SERVICE_ROLE_KEY") or None


def _sb_headers() -> Dict[str, str]:
    return {
        "apikey": _sb_key() or "",
        "Authorization": f"Bearer {_sb_key() or ''}",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# Core dispatcher
# ---------------------------------------------------------------------------

async def _find_due_lessons(
    target_offset_min: int,
    window_min: int,
) -> List[Dict[str, Any]]:
    """Return lessons whose start_time falls in (now + target ± window).

    We select the columns the message body needs and pull the linked
    student + instructor names in a single PostgREST round-trip.
    """
    sb_url = _sb_url()
    if not sb_url:
        return []
    now = datetime.now(timezone.utc)
    lo = now + timedelta(minutes=target_offset_min - window_min)
    hi = now + timedelta(minutes=target_offset_min + window_min)

    params = {
        "select": (
            "id,start_time,end_time,status,pickup_address,topic,student_id,"
            "students(id,auth_user_id,full_name),"
            "instructors(id,full_name,driving_schools(tier))"
        ),
        "start_time": f"gte.{lo.isoformat()}",
        "and": f"(start_time.lte.{hi.isoformat()})",
        "status": "neq.Cancelled",
        "order": "start_time.asc",
        "limit": "500",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{sb_url}/rest/v1/lessons", headers=_sb_headers(), params=params)
    if r.status_code >= 400:
        log.warning("[reminders] lesson query failed: %s %s", r.status_code, r.text[:200])
        return []
    return r.json() or []


async def _already_sent(lesson_id: str, kind: str) -> bool:
    sb_url = _sb_url()
    if not sb_url:
        return False
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            f"{sb_url}/rest/v1/lesson_reminder_log",
            headers=_sb_headers(),
            params={
                "select": "id",
                "lesson_id": f"eq.{lesson_id}",
                "kind": f"eq.{kind}",
                "limit": "1",
            },
        )
    if r.status_code >= 400:
        # Table may not yet exist (pre-migration-017). Allow sending — once
        # the migration is applied subsequent ticks will dedupe correctly.
        return False
    return bool(r.json())


async def _log_sent(lesson_id: str, kind: str, push_count: int, receipt_ids: Optional[List[str]] = None) -> None:
    sb_url = _sb_url()
    if not sb_url:
        return
    payload: Dict[str, Any] = {"lesson_id": lesson_id, "kind": kind, "push_count": push_count}
    # receipt_ids/status are additive (migration: add_reminder_read_receipt_tracking) —
    # only sent when present so this keeps working against an older schema too.
    if receipt_ids:
        payload["receipt_ids"] = receipt_ids
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(
            f"{sb_url}/rest/v1/lesson_reminder_log",
            headers={**_sb_headers(), "Prefer": "resolution=ignore-duplicates"},
            json=payload,
        )


async def _push_tokens_for_user(auth_user_id: str) -> List[str]:
    sb_url = _sb_url()
    if not sb_url:
        return []
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            f"{sb_url}/rest/v1/push_tokens",
            headers=_sb_headers(),
            params={"auth_user_id": f"eq.{auth_user_id}", "select": "expo_token"},
        )
    if r.status_code >= 400:
        return []
    return [row["expo_token"] for row in r.json() if row.get("expo_token")]


def _format_lesson_time(start_iso: str) -> str:
    """e.g. 'Wed 5 Jun, 09:00'."""
    try:
        dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        # Render in UK locale-friendly format. We avoid `locale.setlocale` for
        # portability; the abbreviated forms below are good across both web
        # and standalone builds.
        return dt.strftime("%a %-d %b, %H:%M")
    except Exception:
        return start_iso


def _format_day_and_time(start_iso: str) -> tuple[str, str]:
    """Return ('Thursday', '14:00') style components for richer copy."""
    try:
        dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        return dt.strftime("%A"), dt.strftime("%H:%M")
    except Exception:
        return "your scheduled day", start_iso


def _build_message(lesson: Dict[str, Any], kind: str, label: str) -> Dict[str, str]:
    """Compose the title + body for a given lesson and reminder kind.

    Copy approved by the product owner (British English):
      48h: "Reminder: You have a driving lesson on {Weekday} at {HH:MM}."
      25h: "Lesson tomorrow at {HH:MM} with {Instructor}."
      1h:  "Your lesson starts in 1 hour. See you soon!"
    """
    instructor_name = (lesson.get("instructors") or {}).get("full_name") or "your instructor"
    day_name, hhmm = _format_day_and_time(lesson.get("start_time") or "")
    if kind == "h1":
        body = "Your lesson starts in 1 hour. See you soon!"
    elif kind == "h25":
        body = f"Lesson tomorrow at {hhmm} with {instructor_name}."
    else:
        body = f"Reminder: You have a driving lesson on {day_name} at {hhmm}."
    return {"title": label, "body": body}


async def _send_push(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Fan out messages to the Expo Push API.

    Returns {"accepted": int, "receipt_ids": [...]} — the ticket IDs are
    what let a later, separate job check delivery receipts (see
    check_reminder_receipts below). Expo returns one ticket per message,
    in the same order the messages were sent, each either
    {"status": "ok", "id": "<ticket-id>"} or {"status": "error", ...}
    with no id — only "ok" tickets are worth polling later.
    """
    if not messages:
        return {"accepted": 0, "receipt_ids": []}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        if r.status_code >= 400:
            log.warning("[reminders] expo push HTTP %s: %s", r.status_code, r.text[:200])
            return {"accepted": 0, "receipt_ids": []}
        tickets = (r.json() or {}).get("data", [])
        receipt_ids = [t["id"] for t in tickets if t.get("status") == "ok" and t.get("id")]
        # "accepted" stays the message count for existing callers/metrics —
        # a ticket with status != "ok" still means Expo accepted the HTTP
        # request, just rejected that specific message (e.g. bad token).
        return {"accepted": len(messages), "receipt_ids": receipt_ids}
    except Exception as e:  # pragma: no cover
        log.warning("[reminders] expo push error: %s", e)
        return {"accepted": 0, "receipt_ids": []}


async def check_reminder_receipts() -> Dict[str, Any]:
    """Separate, delayed tick — polls Expo's receipt endpoint for reminders
    sent recently enough that a receipt might exist, but not so recently
    that Expo hasn't had time to try delivering it yet (see
    RECEIPT_MIN_AGE_MIN). Advances status 'sent' -> 'delivered' or
    'failed'; anything still pending on Expo's side is left as 'sent' and
    re-checked on a later tick, up until RECEIPT_MAX_AGE_HOURS.

    Amber ("delivered") reflects Expo's own receipt semantics, not a true
    device-confirmed delivery — a receipt of "ok" only means APNs/FCM
    accepted the notification, not that the device was on and received
    it. That's an inherent platform limitation, not something this
    function can improve on.
    """
    sb_url = _sb_url()
    if not sb_url or not _sb_key():
        return {"ok": False, "reason": "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing"}

    now = datetime.now(timezone.utc)
    oldest = (now - timedelta(hours=RECEIPT_MAX_AGE_HOURS)).isoformat()
    newest = (now - timedelta(minutes=RECEIPT_MIN_AGE_MIN)).isoformat()

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            f"{sb_url}/rest/v1/lesson_reminder_log",
            headers=_sb_headers(),
            params={
                "status": "eq.sent",
                "sent_at": [f"gte.{oldest}", f"lte.{newest}"],
                "receipt_ids": "not.is.null",
                "select": "id,receipt_ids",
                "limit": "500",
            },
        )
    if r.status_code >= 400:
        # Table/columns may not exist yet (pre-migration). Nothing to do.
        return {"ok": False, "reason": f"lesson_reminder_log read failed: {r.text[:200]}"}
    rows = r.json()
    if not rows:
        return {"ok": True, "checked": 0, "delivered": 0, "failed": 0}

    # Map every ticket id back to the log row(s) it belongs to, then ask
    # Expo about all of them in one batched call.
    id_to_rows: Dict[str, List[str]] = {}
    for row in rows:
        for rid in (row.get("receipt_ids") or []):
            id_to_rows.setdefault(rid, []).append(row["id"])
    all_ids = list(id_to_rows.keys())
    if not all_ids:
        return {"ok": True, "checked": 0, "delivered": 0, "failed": 0}

    receipts: Dict[str, Any] = {}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                EXPO_RECEIPTS_URL,
                json={"ids": all_ids},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        if resp.status_code < 400:
            receipts = (resp.json() or {}).get("data", {})
        else:
            log.warning("[reminders] expo receipts HTTP %s: %s", resp.status_code, resp.text[:200])
    except Exception as e:  # pragma: no cover
        log.warning("[reminders] expo receipts error: %s", e)
        return {"ok": False, "reason": str(e)}

    # A log row can have multiple tickets (one per device token); "any ok"
    # is enough to call it delivered, "all errored, none pending" is a
    # failure, otherwise leave it for the next tick.
    delivered_ids: List[str] = []
    failed_ids: List[str] = []
    for row in rows:
        row_receipt_ids = row.get("receipt_ids") or []
        statuses = [receipts[rid]["status"] for rid in row_receipt_ids if rid in receipts]
        if not statuses:
            continue  # none of this row's tickets have a receipt yet
        if "ok" in statuses:
            delivered_ids.append(row["id"])
        elif all(s == "error" for s in statuses):
            failed_ids.append(row["id"])
        # else: mixed pending/error with no "ok" yet — wait for next tick

    async with httpx.AsyncClient(timeout=10.0) as client:
        if delivered_ids:
            await client.patch(
                f"{sb_url}/rest/v1/lesson_reminder_log",
                headers=_sb_headers(),
                params={"id": f"in.({','.join(delivered_ids)})"},
                json={"status": "delivered", "delivered_at": now.isoformat()},
            )
        if failed_ids:
            await client.patch(
                f"{sb_url}/rest/v1/lesson_reminder_log",
                headers=_sb_headers(),
                params={"id": f"in.({','.join(failed_ids)})"},
                json={"status": "failed"},
            )

    result = {"ok": True, "checked": len(rows), "delivered": len(delivered_ids), "failed": len(failed_ids)}
    if delivered_ids or failed_ids:
        log.info("[reminders] receipt check: %s", result)
    return result


async def _process_kind(kind: str, minutes: int, label: str) -> Dict[str, int]:
    """Find due lessons for a given kind and dispatch pushes. Returns metrics."""
    lessons = await _find_due_lessons(minutes, REMINDER_WINDOW_MIN)
    sent = 0
    skipped_no_token = 0
    skipped_no_link = 0
    skipped_dup = 0
    skipped_tier = 0
    for lesson in lessons:
        instructor = lesson.get("instructors") or {}
        tier = ((instructor.get("driving_schools") or {}).get("tier"))
        if not _is_paid_tier(tier):
            skipped_tier += 1
            continue
        student = lesson.get("students") or {}
        auth_user_id = student.get("auth_user_id")
        if not auth_user_id:
            skipped_no_link += 1
            continue
        if await _already_sent(lesson["id"], kind):
            skipped_dup += 1
            continue
        tokens = await _push_tokens_for_user(auth_user_id)
        if not tokens:
            skipped_no_token += 1
            # Still log so we don't keep re-checking the same lesson every tick
            # — although the row will mean "we tried, no audience"; this is
            # acceptable because adding the app later won't backfill old
            # reminders anyway.
            await _log_sent(lesson["id"], kind, 0)
            continue
        msg = _build_message(lesson, kind, label)
        messages = [
            {"to": t, "title": msg["title"], "body": msg["body"], "sound": "default",
             "data": {"lessonId": lesson["id"], "kind": kind}}
            for t in tokens
        ]
        result = await _send_push(messages)
        accepted, receipt_ids = result["accepted"], result["receipt_ids"]
        if accepted > 0:
            await _log_sent(lesson["id"], kind, accepted, receipt_ids)
            sent += 1
    return {
        "kind": kind,
        "candidates": len(lessons),
        "sent": sent,
        "skipped_no_link": skipped_no_link,
        "skipped_no_token": skipped_no_token,
        "skipped_dup": skipped_dup,
        "skipped_tier": skipped_tier,
    }


async def dispatch_lesson_reminders() -> Dict[str, Any]:
    """Top-level tick — checks all three reminder kinds in sequence."""
    if not _sb_url() or not _sb_key():
        return {"ok": False, "reason": "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing"}
    results = []
    for offset in REMINDER_OFFSETS:
        r = await _process_kind(offset["kind"], offset["minutes"], offset["label"])
        results.append(r)
    summary = {
        "ok": True,
        "at": datetime.now(timezone.utc).isoformat(),
        "results": results,
    }
    total_sent = sum(r["sent"] for r in results)
    if total_sent > 0:
        log.info("[reminders] dispatched %s reminder(s): %s", total_sent, results)
    return summary


# ---------------------------------------------------------------------------
# APScheduler wiring (entry-points called by server.py startup/shutdown)
# ---------------------------------------------------------------------------

def start_lesson_reminder_scheduler() -> None:
    """Start the background scheduler (idempotent)."""
    global _scheduler
    if _scheduler is not None:
        return
    if not _sb_url() or not _sb_key():
        log.warning("[reminders] scheduler NOT started — Supabase env vars missing")
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        dispatch_lesson_reminders,
        "interval",
        minutes=REMINDER_TICK_MIN,
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=10),
        id="lesson_reminders_tick",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
    _scheduler.add_job(
        check_reminder_receipts,
        "interval",
        minutes=RECEIPT_CHECK_TICK_MIN,
        next_run_time=datetime.now(timezone.utc) + timedelta(minutes=RECEIPT_MIN_AGE_MIN),
        id="lesson_reminder_receipts_tick",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
    _scheduler.start()
    log.info(
        "[reminders] scheduler started — ticks every %s min (offsets: 48h, 25h, 1h, window ±%s min); "
        "receipt checks every %s min (min age %s min)",
        REMINDER_TICK_MIN, REMINDER_WINDOW_MIN, RECEIPT_CHECK_TICK_MIN, RECEIPT_MIN_AGE_MIN,
    )


def stop_lesson_reminder_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
