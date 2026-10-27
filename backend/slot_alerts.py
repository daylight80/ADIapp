"""Slot alerts (14 Oct 2026).

When an instructor's lesson is cancelled, the pupils of that instructor who have "Slot alerts"
switched on get a push notification that the slot is free:

    "A lesson slot has opened: Thu 16 Oct, 14:00-15:00 with Grant. Contact your instructor to book it."

The pupil does not book it in the app (pupils cannot book themselves); they contact their
instructor, who decides. That is also why nobody is told about a slot that is already taken.

How it works
------------
* Runs every 5 minutes on lesson_reminders' scheduler (see register_jobs), reusing its HTTP client,
  Supabase helpers and Expo push sender.
* A cancellation is announced once: the job "claims" the lesson by setting
  lessons.slot_alert_sent_at before sending, so two ticks (or two servers) cannot both announce it.
* Only recent cancellations (changed in the last RECENT_MIN minutes), for slots at least
  MIN_NOTICE_MIN minutes away and no more than LOOKAHEAD_DAYS ahead.
* Told by push notification; a pupil whose push cannot be delivered (no device registered, or the
  push service refused it) gets an email instead if they have an address and email is configured.
  Email only goes to pupils with an app login: they are the ones who have seen the Slot alerts
  switch and can turn it off.
* Not told: the pupil whose lesson it was, pupils who switched alerts off, pupils with no app login,
  Passed or Inactive pupils, pupils who have a lesson at that time, and pupils who have already had
  MAX_PER_PUPIL_PER_WEEK alerts in the last 7 days.
* At most MAX_PUPILS_PER_SLOT pupils are told, the ones waiting for a slot first.
* Paid plans only (DC Pro and Franchise), the same rule as lesson reminders.
* slot_alert_log records who was told about which lesson (migration 063).
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import email_service
import lesson_reminders as lr

log = logging.getLogger("slot_alerts")

TICK_MIN = 5
RECENT_MIN = 30
MIN_NOTICE_MIN = 120
LOOKAHEAD_DAYS = 14
MAX_PER_PUPIL_PER_WEEK = 3
MAX_PUPILS_PER_SLOT = 10
QUERY_CHUNK = 40

# Pupils waiting for a slot first, then those closest to their test, then everyone else.
STATUS_PRIORITY = {"Waitlist": 0, "Test Ready": 1, "Active": 2, "New": 3}


# ---------------------------------------------------------------------------
# Pure logic (tested without a database)
# ---------------------------------------------------------------------------

def _parse(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    """True when two time ranges share any time. Touching ends do not overlap."""
    return _parse(a_start) < _parse(b_end) and _parse(b_start) < _parse(a_end)


def slot_message(start_iso: str, end_iso: str, instructor_name: Optional[str]) -> Dict[str, str]:
    """The notification text, with the time shown in UK local time."""
    first = (instructor_name or "").strip().split(" ")[0] or "your instructor"
    try:
        start = lr._to_uk_time(start_iso)
        # Built by hand: strftime's "%-d" (day without a leading zero) is not available on Windows.
        when = f"{start.strftime('%a')} {start.day} {start.strftime('%b')}, {start:%H:%M}"
        when = f"{when}-{lr._to_uk_time(end_iso):%H:%M}"
    except Exception:
        when = start_iso
    who = f"with {first}" if first != "your instructor" else "with your instructor"
    return {
        "title": "A lesson slot has opened",
        "body": f"{when} {who}. Contact your instructor to book it.",
    }


def choose_recipients(
    pupils: List[Dict[str, Any]],
    lesson: Dict[str, Any],
    busy: Dict[str, List[Tuple[str, str]]],
    recent_counts: Dict[str, int],
    limit: int = MAX_PUPILS_PER_SLOT,
) -> List[Dict[str, Any]]:
    """Which pupils to tell about a freed slot, in the order to tell them."""
    chosen = []
    for p in pupils:
        if p.get("id") == lesson.get("student_id"):
            continue  # it was their own lesson
        if p.get("slot_alerts") is False:
            continue
        if not p.get("auth_user_id"):
            continue  # no app login, nothing to push to
        if p.get("status") not in STATUS_PRIORITY:
            continue  # Passed, Inactive, anything else
        if recent_counts.get(p["id"], 0) >= MAX_PER_PUPIL_PER_WEEK:
            continue
        if any(overlaps(lesson["start_time"], lesson["end_time"], s, e) for s, e in busy.get(p["id"], [])):
            continue
        chosen.append(p)
    chosen.sort(key=lambda p: (STATUS_PRIORITY[p["status"]], p.get("full_name") or "", p["id"]))
    return chosen[:limit]


# ---------------------------------------------------------------------------
# Database and push (reuses lesson_reminders' client and helpers)
# ---------------------------------------------------------------------------

def _chunks(items: List[str], n: int = QUERY_CHUNK):
    for i in range(0, len(items), n):
        yield items[i:i + n]


async def _get(path: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
    sb_url = lr._sb_url()
    if not sb_url:
        return []
    async with lr._client() as client:
        r = await client.get(f"{sb_url}/rest/v1/{path}", headers=lr._sb_headers(), params=params)
    if r.status_code >= 400:
        log.warning("[slot-alerts] %s query failed: %s %s", path, r.status_code, r.text[:200])
        return []
    return r.json() or []


async def _find_cancelled(now: datetime) -> List[Dict[str, Any]]:
    lo = now + timedelta(minutes=MIN_NOTICE_MIN)
    hi = now + timedelta(days=LOOKAHEAD_DAYS)
    return await _get("lessons", {
        "select": (
            "id,start_time,end_time,instructor_id,student_id,"
            "instructors(id,full_name,mobile_number,driving_schools!instructors_school_id_fkey(tier))"
        ),
        "status": "eq.Cancelled",
        "slot_alert_sent_at": "is.null",
        "updated_at": f"gte.{(now - timedelta(minutes=RECENT_MIN)).isoformat()}",
        "start_time": f"gte.{lo.isoformat()}",
        "and": f"(start_time.lte.{hi.isoformat()})",
        "order": "start_time.asc",
        "limit": "100",
    })


async def _claim(lesson_id: str, now: datetime) -> bool:
    """Mark a cancelled lesson as handled. True only for the caller that got there first."""
    sb_url = lr._sb_url()
    if not sb_url:
        return False
    async with lr._client() as client:
        r = await client.patch(
            f"{sb_url}/rest/v1/lessons",
            headers={**lr._sb_headers(), "Prefer": "return=representation"},
            params={"id": f"eq.{lesson_id}", "slot_alert_sent_at": "is.null"},
            json={"slot_alert_sent_at": now.isoformat()},
        )
    if r.status_code >= 400:
        log.warning("[slot-alerts] could not claim lesson %s: %s %s", lesson_id, r.status_code, r.text[:200])
        return False
    return bool(r.json())


async def _slot_taken(lesson: Dict[str, Any]) -> bool:
    """True if the instructor already has another lesson in that time."""
    rows = await _get("lessons", {
        "select": "id",
        "instructor_id": f"eq.{lesson['instructor_id']}",
        "status": "neq.Cancelled",
        "start_time": f"lt.{lesson['end_time']}",
        "end_time": f"gt.{lesson['start_time']}",
        "limit": "1",
    })
    return bool(rows)


async def _pupils_of(instructor_id: str) -> List[Dict[str, Any]]:
    return await _get("students", {
        "select": "id,auth_user_id,full_name,email,status,slot_alerts",
        "instructor_id": f"eq.{instructor_id}",
        "slot_alerts": "eq.true",
        "auth_user_id": "not.is.null",
        "limit": "500",
    })


async def _busy_map(student_ids: List[str], lesson: Dict[str, Any]) -> Dict[str, List[Tuple[str, str]]]:
    busy: Dict[str, List[Tuple[str, str]]] = {}
    for chunk in _chunks(student_ids):
        rows = await _get("lessons", {
            "select": "student_id,start_time,end_time",
            "student_id": f"in.({','.join(chunk)})",
            "status": "neq.Cancelled",
            "start_time": f"lt.{lesson['end_time']}",
            "end_time": f"gt.{lesson['start_time']}",
            "limit": "500",
        })
        for row in rows:
            busy.setdefault(row["student_id"], []).append((row["start_time"], row["end_time"]))
    return busy


async def _recent_counts(student_ids: List[str], now: datetime) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    since = (now - timedelta(days=7)).isoformat()
    for chunk in _chunks(student_ids):
        rows = await _get("slot_alert_log", {
            "select": "student_id",
            "student_id": f"in.({','.join(chunk)})",
            "sent_at": f"gte.{since}",
            "limit": "2000",
        })
        for row in rows:
            counts[row["student_id"]] = counts.get(row["student_id"], 0) + 1
    return counts


async def _log_sent(student_id: str, lesson_id: str, push_count: int) -> None:
    sb_url = lr._sb_url()
    if not sb_url:
        return
    async with lr._client() as client:
        r = await client.post(
            f"{sb_url}/rest/v1/slot_alert_log",
            headers={**lr._sb_headers(), "Prefer": "resolution=ignore-duplicates"},
            json={"student_id": student_id, "lesson_id": lesson_id, "push_count": push_count},
        )
    if r.status_code >= 400:
        log.error("[slot-alerts] could not record alert for pupil %s lesson %s: %s %s",
                  student_id, lesson_id, r.status_code, r.text[:200])


async def _send_email(pupil: Dict[str, Any], lesson: Dict[str, Any], instructor: Dict[str, Any]) -> bool:
    """Email the slot alert to a pupil. True only if Resend accepted it."""
    to = (pupil.get("email") or "").strip()
    if not email_service.looks_like_email(to) or not email_service.is_configured():
        return False
    try:
        start = lr._to_uk_time(lesson["start_time"])
        end = lr._to_uk_time(lesson["end_time"])
    except Exception:
        return False
    subject, html_body, text_body = email_service.render_slot_alert_email(
        student_name=pupil.get("full_name"),
        instructor_name=instructor.get("full_name"),
        weekday=start.strftime("%A"),
        date_text=f"{start.day} {start.strftime('%B')}",
        start_text=f"{start:%H:%M}",
        end_text=f"{end:%H:%M}",
        instructor_phone=instructor.get("mobile_number"),
    )
    payload = email_service.build_payload(
        to=to, subject=subject, html_body=html_body, text_body=text_body,
        from_display_name=instructor.get("full_name") or "Your instructor",
    )
    try:
        async with lr._client() as client:
            await email_service.send_email(payload, client=client)
    except email_service.EmailSendError as e:
        log.warning("[slot-alerts] email to pupil %s failed: %s", pupil.get("id"), e)
        return False
    return True


async def _announce(lesson: Dict[str, Any], now: datetime) -> Dict[str, int]:
    """Tell the right pupils about one freed slot. Returns what happened."""
    instructor = lesson.get("instructors") or {}
    pupils = await _pupils_of(lesson["instructor_id"])
    ids = [p["id"] for p in pupils]
    busy = await _busy_map(ids, lesson) if ids else {}
    recent = await _recent_counts(ids, now) if ids else {}
    chosen = choose_recipients(pupils, lesson, busy, recent)

    msg = slot_message(lesson["start_time"], lesson["end_time"], instructor.get("full_name"))
    by_push = by_email = 0
    for p in chosen:
        tokens = await lr._push_tokens_for_user(p["auth_user_id"])
        if tokens:
            result = await lr._send_push([
                {"to": t, "title": msg["title"], "body": msg["body"], "sound": "default",
                 "data": {"kind": "slot_alert", "lessonId": lesson["id"]}}
                for t in tokens
            ])
            if result["accepted"] > 0:
                await _log_sent(p["id"], lesson["id"], result["accepted"])
                by_push += 1
                continue
        # No device, or the push was refused: email instead.
        if await _send_email(p, lesson, instructor):
            await _log_sent(p["id"], lesson["id"], 0)
            by_email += 1
    told = by_push + by_email
    return {"candidates": len(pupils), "chosen": len(chosen), "told": told, "by_push": by_push, "by_email": by_email}


async def dispatch_slot_alerts() -> Dict[str, Any]:
    """One tick: announce each recently cancelled, still-free slot once."""
    if not lr._sb_url() or not lr._sb_key():
        return {"ok": False, "reason": "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing"}
    now = datetime.now(timezone.utc)
    lessons = await _find_cancelled(now)
    summary = {"ok": True, "cancelled": len(lessons), "announced": 0, "pupils_told": 0, "by_push": 0, "by_email": 0,
               "skipped_tier": 0, "skipped_taken": 0, "skipped_claimed": 0}
    for lesson in lessons:
        tier = ((lesson.get("instructors") or {}).get("driving_schools") or {}).get("tier")
        if not lr._is_paid_tier(tier):
            summary["skipped_tier"] += 1
            continue
        # Claim first, so a second tick or server cannot announce the same cancellation.
        if not await _claim(lesson["id"], now):
            summary["skipped_claimed"] += 1
            continue
        if await _slot_taken(lesson):
            summary["skipped_taken"] += 1
            continue
        result = await _announce(lesson, now)
        summary["announced"] += 1
        summary["pupils_told"] += result["told"]
        summary["by_push"] += result["by_push"]
        summary["by_email"] += result["by_email"]
    if summary["pupils_told"] > 0:
        log.info("[slot-alerts] %s", summary)
    return summary


def register_jobs(scheduler) -> None:
    """Called by lesson_reminders when it starts its scheduler."""
    scheduler.add_job(
        dispatch_slot_alerts,
        "interval",
        minutes=TICK_MIN,
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=45),
        id="slot_alerts_tick",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
