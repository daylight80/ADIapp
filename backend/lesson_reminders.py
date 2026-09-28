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
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import email_service

log = logging.getLogger("lesson_reminders")

# One shared HTTP client for every call this module makes (28 Sept 2026).
# These helpers used to each open a brand-new httpx.AsyncClient per call.
# Building a client builds a fresh SSL context and loads the CA bundle each
# time, and the scheduler does that ~3x every 5 minutes around the clock. On
# Render that showed up as memory climbing in a dead-straight line (~31 MB/h,
# ~0.9 MB per client) from ~75 MB after a restart to the 512 MB limit about
# 24 h later, then an OOM kill — three in a row on 26-28 Sept, with almost no
# real user traffic in between. Reusing one client keeps a single SSL context
# and connection pool for the life of the process.
_http_client: Optional[httpx.AsyncClient] = None


@asynccontextmanager
async def _client():
    """Yield the shared client (created on first use). Drop-in replacement
    for `async with httpx.AsyncClient(...)` — it deliberately does NOT close
    the client on exit; that happens once, in close_http_client()."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=15.0)
    yield _http_client


async def close_http_client() -> None:
    """Called from server.py's shutdown hook."""
    global _http_client
    if _http_client is not None:
        try:
            await _http_client.aclose()
        finally:
            _http_client = None

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

# Paid-tier feature per tiers.ts's isPaidTier (31 Aug 2026, tier-gating
# audit) — this dispatcher previously sent to every student regardless of
# their instructor's tier, with zero tier-checking anywhere in this file.
# Mirrors the frontend's isPaidTier() exactly, including its "unknown tier
# defaults to Starter" behaviour (tierById() falls back to TIERS[0]) — an
# instructor with a missing/unrecognised tier should not receive a paid
# feature by accident. 'growth' was removed with the Growth tier
# (23 Sept 2026, Migration 037); a stray legacy row is treated as Starter,
# same as the frontend.
PAID_TIERS = {"pro", "franchise"}


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
            "students(id,auth_user_id,full_name,email),"
            "instructors(id,full_name,email,driving_schools!instructors_school_id_fkey(tier))"
        ),
        "start_time": f"gte.{lo.isoformat()}",
        "and": f"(start_time.lte.{hi.isoformat()})",
        "status": "neq.Cancelled",
        "order": "start_time.asc",
        "limit": "500",
    }
    async with _client() as client:
        r = await client.get(f"{sb_url}/rest/v1/lessons", headers=_sb_headers(), params=params)
    if r.status_code >= 400:
        log.warning("[reminders] lesson query failed: %s %s", r.status_code, r.text[:200])
        return []
    return r.json() or []


async def _already_sent(lesson_id: str, kind: str) -> bool:
    sb_url = _sb_url()
    if not sb_url:
        return False
    async with _client() as client:
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


async def _log_sent(
    lesson_id: str,
    kind: str,
    push_count: int,
    receipt_ids: Optional[List[str]] = None,
    channel: str = "push",
) -> bool:
    """Record that a reminder was handled. Returns False if the write failed.

    The (lesson_id, kind) unique key is what stops a reminder going out twice,
    across channels too. If this write fails after an email has been sent, the
    next tick would send that email again — hence the loud error below.
    """
    sb_url = _sb_url()
    if not sb_url:
        return False
    payload: Dict[str, Any] = {"lesson_id": lesson_id, "kind": kind, "push_count": push_count}
    # receipt_ids/status are additive (migration: add_reminder_read_receipt_tracking) —
    # only sent when present so this keeps working against an older schema too.
    if receipt_ids:
        payload["receipt_ids"] = receipt_ids
    # channel is additive too (Migration 045); push rows leave it to the column
    # default so push keeps working on a schema that hasn't got it yet.
    if channel != "push":
        payload["channel"] = channel
    async with _client() as client:
        r = await client.post(
            f"{sb_url}/rest/v1/lesson_reminder_log",
            headers={**_sb_headers(), "Prefer": "resolution=ignore-duplicates"},
            json=payload,
        )
    if r.status_code >= 400:
        log.error(
            "[reminders] could not record %s reminder for lesson %s (%s) — it may be sent again next tick: %s %s",
            kind, lesson_id, channel, r.status_code, r.text[:200],
        )
        return False
    return True


async def _push_tokens_for_user(auth_user_id: str) -> List[str]:
    sb_url = _sb_url()
    if not sb_url:
        return []
    async with _client() as client:
        r = await client.get(
            f"{sb_url}/rest/v1/push_tokens",
            headers=_sb_headers(),
            params={"auth_user_id": f"eq.{auth_user_id}", "select": "expo_token"},
        )
    if r.status_code >= 400:
        return []
    return [row["expo_token"] for row in r.json() if row.get("expo_token")]


# Lesson times are stored and returned by Supabase as UTC (timestamptz, DB
# TimeZone = UTC), but every student and instructor is in the UK, so the times
# in reminder copy must be shown in UK local time — GMT in winter, BST in
# summer. Formatting the raw value made a 09:00 BST lesson read "08:00", and
# could even show the wrong weekday for lessons near midnight (28 Sept 2026).
try:
    UK_TZ = ZoneInfo("Europe/London")
except ZoneInfoNotFoundError:  # pragma: no cover — tzdata is in requirements.txt
    log.error("[reminders] Europe/London tz data missing — reminder times will show UTC. Install tzdata.")
    UK_TZ = timezone.utc


def _to_uk_time(start_iso: str) -> datetime:
    """Parse a Supabase timestamp and convert it to UK local time. A value
    with no offset is assumed to already be UTC, which is what Supabase sends."""
    dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(UK_TZ)


def _format_lesson_time(start_iso: str) -> str:
    """e.g. 'Wed 5 Jun, 09:00' (UK local time)."""
    try:
        dt = _to_uk_time(start_iso)
        # Render in UK locale-friendly format. We avoid `locale.setlocale` for
        # portability; the abbreviated forms below are good across both web
        # and standalone builds.
        return dt.strftime("%a %-d %b, %H:%M")
    except Exception:
        return start_iso


def _format_day_and_time(start_iso: str) -> tuple[str, str]:
    """Return ('Thursday', '14:00') style components for richer copy (UK local time)."""
    try:
        dt = _to_uk_time(start_iso)
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
        async with _client() as client:
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

    async with _client() as client:
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
        async with _client() as client:
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

    async with _client() as client:
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


# Which channels each reminder tries, in order of preference. The first one
# that actually delivers wins, so a student never gets the same reminder twice,
# and each channel falls back to the other:
#   48h  email first — the earliest heads-up, and it reaches students who never
#        installed the app — then push.
#   25h  push first (the "tomorrow" nudge, best on a phone), then email for
#        students without the app.
#   1h   push only — nobody reads an email an hour before a lesson.
CHANNEL_ORDER = {
    "h48": ("email", "push"),
    "h25": ("push", "email"),
    "h1": ("push",),
}

_warned_email_unconfigured = False


def _instructor_reply_to(instructor: Dict[str, Any]) -> Optional[str]:
    """Replies go to the instructor, so a student answering "can we move it?"
    reaches a person. Omitted if the instructor has no usable address."""
    addr = (instructor.get("email") or "").strip()
    return addr if email_service.looks_like_email(addr) else None


async def _send_email_reminder(lesson: Dict[str, Any], kind: str) -> bool:
    """Email the reminder to the student. True only if Resend accepted it."""
    student = lesson.get("students") or {}
    instructor = lesson.get("instructors") or {}
    to = (student.get("email") or "").strip()
    try:
        dt = _to_uk_time(lesson.get("start_time") or "")
    except Exception:
        # Without a valid start time we can't state one — better no email than a wrong one.
        log.warning("[reminders] lesson %s has an unreadable start_time; not emailing", lesson.get("id"))
        return False
    subject, html_body, text_body = email_service.render_lesson_reminder_email(
        student_name=student.get("full_name"),
        instructor_name=instructor.get("full_name"),
        kind=kind,
        weekday=dt.strftime("%A"),
        date_text=f"{dt.day} {dt.strftime('%B')}",
        time_text=dt.strftime("%H:%M"),
        pickup_address=lesson.get("pickup_address"),
    )
    payload = email_service.build_payload(
        to=to,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
        from_display_name=instructor.get("full_name") or "Your instructor",
        reply_to=_instructor_reply_to(instructor),
    )
    try:
        async with _client() as client:
            await email_service.send_email(payload, client=client)
    except email_service.EmailSendError as e:
        log.warning("[reminders] email reminder for lesson %s failed: %s", lesson.get("id"), e)
        return False
    return True


async def _send_push_reminder(
    lesson: Dict[str, Any], kind: str, label: str, tokens: List[str]
) -> Optional[Dict[str, Any]]:
    """Push the reminder to every device token. Returns Expo's result, or None if nothing was accepted."""
    msg = _build_message(lesson, kind, label)
    messages = [
        {"to": t, "title": msg["title"], "body": msg["body"], "sound": "default",
         "data": {"lessonId": lesson["id"], "kind": kind}}
        for t in tokens
    ]
    result = await _send_push(messages)
    return result if result["accepted"] > 0 else None


async def _deliver_reminder(lesson: Dict[str, Any], kind: str, label: str) -> str:
    """Try each channel for this reminder in preference order; log the first
    that delivers. Returns what happened:

      'email' / 'push'  delivered on that channel (and logged)
      'no_link'         no email and no app login — nobody to tell; NOT logged,
                        so linking the app or adding an email later still works
      'no_token'        has the app but no device token, no email — logged as
                        "tried, no audience" so we stop re-checking every tick
      'retry'           there was someone to tell but every attempt failed (e.g.
                        Resend down); NOT logged, so the next tick tries again
    """
    global _warned_email_unconfigured
    student = lesson.get("students") or {}
    auth_user_id = student.get("auth_user_id")
    # email_service.is_configured() gates it here so a missing RESEND_API_KEY
    # quietly falls back to push instead of counting as a failed attempt.
    has_address = email_service.looks_like_email(student.get("email"))
    has_email = has_address and email_service.is_configured()
    if has_address and not has_email and not _warned_email_unconfigured:
        _warned_email_unconfigured = True
        log.warning("[reminders] RESEND_API_KEY not set — email reminders are disabled, falling back to push")

    tokens: Optional[List[str]] = None  # fetched lazily, only if push is actually tried
    attempted = False
    for channel in CHANNEL_ORDER.get(kind, ("push",)):
        if channel == "email":
            if not has_email:
                continue
            attempted = True
            if await _send_email_reminder(lesson, kind):
                await _log_sent(lesson["id"], kind, 0, channel="email")
                return "email"
        else:
            if not auth_user_id:
                continue
            if tokens is None:
                tokens = await _push_tokens_for_user(auth_user_id)
            if not tokens:
                continue
            attempted = True
            result = await _send_push_reminder(lesson, kind, label, tokens)
            if result is not None:
                await _log_sent(lesson["id"], kind, result["accepted"], result["receipt_ids"])
                return "push"
    if attempted:
        return "retry"
    if not auth_user_id:
        return "no_link"
    await _log_sent(lesson["id"], kind, 0)
    return "no_token"


async def _process_kind(kind: str, minutes: int, label: str) -> Dict[str, int]:
    """Find due lessons for a given kind and send reminders. Returns metrics."""
    lessons = await _find_due_lessons(minutes, REMINDER_WINDOW_MIN)
    counts = {"email": 0, "push": 0, "no_link": 0, "no_token": 0, "retry": 0}
    skipped_dup = 0
    skipped_tier = 0
    for lesson in lessons:
        instructor = lesson.get("instructors") or {}
        tier = ((instructor.get("driving_schools") or {}).get("tier"))
        if not _is_paid_tier(tier):
            skipped_tier += 1
            continue
        if await _already_sent(lesson["id"], kind):
            skipped_dup += 1
            continue
        outcome = await _deliver_reminder(lesson, kind, label)
        counts[outcome] += 1
    return {
        "kind": kind,
        "candidates": len(lessons),
        "sent": counts["email"] + counts["push"],
        "sent_email": counts["email"],
        "sent_push": counts["push"],
        "skipped_no_link": counts["no_link"],
        "skipped_no_token": counts["no_token"],
        "retry": counts["retry"],
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
    # Instructor deadline reminders share this scheduler. Imported here, not at
    # the top of the file, because admin_reminders imports this module.
    import admin_reminders
    admin_reminders.register_jobs(_scheduler)
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
