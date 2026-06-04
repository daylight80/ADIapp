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

# Three target offsets (in minutes before lesson start) and their "kind" tags
# stored in lesson_reminder_log to prevent duplicates. The title is the
# user-facing notification heading; the body is composed in _build_message().
REMINDER_OFFSETS = [
    {"kind": "h48", "minutes": 48 * 60, "label": "Lesson reminder"},
    {"kind": "h25", "minutes": 25 * 60, "label": "Lesson tomorrow"},
    {"kind": "h1",  "minutes":      60, "label": "Lesson in 1 hour"},
]

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
            "instructors(id,full_name)"
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


async def _log_sent(lesson_id: str, kind: str, push_count: int) -> None:
    sb_url = _sb_url()
    if not sb_url:
        return
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(
            f"{sb_url}/rest/v1/lesson_reminder_log",
            headers={**_sb_headers(), "Prefer": "resolution=ignore-duplicates"},
            json={"lesson_id": lesson_id, "kind": kind, "push_count": push_count},
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


async def _send_push(messages: List[Dict[str, Any]]) -> int:
    """Fan out messages to the Expo Push API. Returns count actually accepted."""
    if not messages:
        return 0
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        # The Expo Push API returns a per-message status list, but for
        # logging purposes here we just count what we sent.
        if r.status_code >= 400:
            log.warning("[reminders] expo push HTTP %s: %s", r.status_code, r.text[:200])
            return 0
        return len(messages)
    except Exception as e:  # pragma: no cover
        log.warning("[reminders] expo push error: %s", e)
        return 0


async def _process_kind(kind: str, minutes: int, label: str) -> Dict[str, int]:
    """Find due lessons for a given kind and dispatch pushes. Returns metrics."""
    lessons = await _find_due_lessons(minutes, REMINDER_WINDOW_MIN)
    sent = 0
    skipped_no_token = 0
    skipped_no_link = 0
    skipped_dup = 0
    for lesson in lessons:
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
        accepted = await _send_push(messages)
        if accepted > 0:
            await _log_sent(lesson["id"], kind, accepted)
            sent += 1
    return {
        "kind": kind,
        "candidates": len(lessons),
        "sent": sent,
        "skipped_no_link": skipped_no_link,
        "skipped_no_token": skipped_no_token,
        "skipped_dup": skipped_dup,
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
    _scheduler.start()
    log.info(
        "[reminders] scheduler started — ticks every %s min (offsets: 48h, 25h, 1h, window ±%s min)",
        REMINDER_TICK_MIN, REMINDER_WINDOW_MIN,
    )


def stop_lesson_reminder_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
