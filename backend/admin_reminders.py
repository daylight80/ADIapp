"""Daily deadline reminders for instructors (28 Sept 2026).

Every instructor has renewal dates they can't afford to miss — ADI badge, MOT,
insurance, road tax, dual-control service, and the DVSA standards check. This
module emails and pushes the instructor about them, once a day at 08:00 UK time:

    30 days before   ->  stage 'd30'   (8-30 days left)
     7 days before   ->  stage 'd7'    (2-7 days left)
     1 day before    ->  stage 'd1'    (0-1 days left)
     just missed it  ->  stage 'overdue' (1-30 days past), once

Each (instructor, deadline, due date, stage) is recorded in
deadline_reminder_log the first time it goes out, so a restart, a redeploy or a
second run never repeats it, and renewing a deadline (a new due date) starts a
fresh set. The stage is worked out from "days left today" rather than from
exact day counts, so if the job misses a morning (a deploy, an outage) the next
run still sends the right one.

Paid plans only (ADI Pro and Franchise), the same rule as lesson reminders.
Instructors only for now: no fleet vehicles, and school owners aren't told
about their instructors' deadlines.

The list of deadlines comes from the instructor_deadline_items view (Migration
046), which includes the standards check worked out from the instructor's own
logged checks. This job reads that view with the service role.

It reuses lesson_reminders' shared HTTP client, Supabase helpers and Expo push
sender, and registers itself on that module's scheduler (see register_jobs).
"""
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from apscheduler.triggers.cron import CronTrigger

import email_service
import lesson_reminders as lr

log = logging.getLogger("admin_reminders")

REMIND_HOUR_UK = 8          # the daily run, UK local time
LOOKAHEAD_DAYS = 30         # nothing is sent for a deadline further out than this
OVERDUE_GRACE_DAYS = 30     # one overdue nudge, only if it's this recent — not for last year's date
CATCHUP_HOURS_UK = (8, 20)  # a startup catch-up run only fires inside these UK hours
QUERY_CHUNK = 40            # instructor ids per PostgREST "in.(...)" filter, to keep URLs short

STAGES = ("d30", "d7", "d1", "overdue")


# ---------------------------------------------------------------------------
# Pure logic — no I/O, unit tested
# ---------------------------------------------------------------------------

def stage_for(days_left: int) -> Optional[str]:
    """Which reminder stage a deadline is in, given whole days until it is due
    (negative once it has passed). None means "too far off / too long ago"."""
    if days_left < -OVERDUE_GRACE_DAYS:
        return None
    if days_left < 0:
        return "overdue"
    if days_left <= 1:
        return "d1"
    if days_left <= 7:
        return "d7"
    if days_left <= LOOKAHEAD_DAYS:
        return "d30"
    return None


def uk_today(now: Optional[datetime] = None) -> date:
    """Today's date in the UK — the day an instructor thinks of it as."""
    return (now or datetime.now(timezone.utc)).astimezone(lr.UK_TZ).date()


def parse_due_date(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def format_due_date(d: date) -> str:
    """e.g. 'Thursday 8 October 2026' (no zero-padded day, so no %-d)."""
    return f"{d.strftime('%A')} {d.day} {d.strftime('%B')} {d.year}"


def plan_reminders(
    items: List[Dict[str, Any]],
    instructors: Dict[str, Dict[str, Any]],
    already_sent: Set[Tuple[str, str, str, str]],
    today: date,
) -> List[Dict[str, Any]]:
    """Work out which reminders should go out now. Pure.

    already_sent holds (instructor_id, item_key, due_date_iso, stage) tuples.
    Skips instructors we don't know, anyone not on a paid plan, deadlines not in
    a stage today, and stages already sent for that exact due date.
    """
    plan: List[Dict[str, Any]] = []
    for item in items:
        instructor = instructors.get(str(item.get("instructor_id")))
        if not instructor:
            continue
        tier = ((instructor.get("driving_schools") or {}).get("tier"))
        if not lr._is_paid_tier(tier):
            continue
        due = parse_due_date(item.get("due_date"))
        if due is None:
            continue
        left = (due - today).days
        stage = stage_for(left)
        if stage is None:
            continue
        key = (str(item["instructor_id"]), str(item["item_key"]), due.isoformat(), stage)
        if key in already_sent:
            continue
        plan.append({"instructor": instructor, "item": item, "due": due, "days_left": left, "stage": stage})
    return plan


# ---------------------------------------------------------------------------
# Supabase reads / writes
# ---------------------------------------------------------------------------

def _chunks(seq: List[str], n: int) -> List[List[str]]:
    return [seq[i:i + n] for i in range(0, len(seq), n)]


async def _fetch_items(today: date) -> List[Dict[str, Any]]:
    sb = lr._sb_url()
    lo, hi = today - timedelta(days=OVERDUE_GRACE_DAYS), today + timedelta(days=LOOKAHEAD_DAYS)
    async with lr._client() as client:
        r = await client.get(
            f"{sb}/rest/v1/instructor_deadline_items",
            headers=lr._sb_headers(),
            params={
                "select": "item_key,instructor_id,kind,label,due_date",
                "due_date": [f"gte.{lo.isoformat()}", f"lte.{hi.isoformat()}"],
                "order": "due_date.asc",
                "limit": "2000",
            },
        )
    if r.status_code >= 400:
        # View missing (Migration 046 not applied yet): nothing to do, not an error.
        log.warning("[deadlines] item query failed: %s %s", r.status_code, r.text[:200])
        return []
    return r.json() or []


async def _fetch_instructors(ids: List[str]) -> Dict[str, Dict[str, Any]]:
    sb = lr._sb_url()
    out: Dict[str, Dict[str, Any]] = {}
    for chunk in _chunks(ids, QUERY_CHUNK):
        async with lr._client() as client:
            r = await client.get(
                f"{sb}/rest/v1/instructors",
                headers=lr._sb_headers(),
                params={
                    "id": f"in.({','.join(chunk)})",
                    "select": "id,full_name,email,auth_user_id,driving_schools!instructors_school_id_fkey(tier)",
                },
            )
        if r.status_code >= 400:
            log.warning("[deadlines] instructor query failed: %s %s", r.status_code, r.text[:200])
            continue
        for row in r.json() or []:
            out[str(row["id"])] = row
    return out


async def _fetch_sent(ids: List[str], today: date) -> Set[Tuple[str, str, str, str]]:
    sb = lr._sb_url()
    since = (today - timedelta(days=OVERDUE_GRACE_DAYS + 2)).isoformat()
    sent: Set[Tuple[str, str, str, str]] = set()
    for chunk in _chunks(ids, QUERY_CHUNK):
        async with lr._client() as client:
            r = await client.get(
                f"{sb}/rest/v1/deadline_reminder_log",
                headers=lr._sb_headers(),
                params={
                    "instructor_id": f"in.({','.join(chunk)})",
                    "due_date": f"gte.{since}",
                    "select": "instructor_id,item_key,due_date,stage",
                    "limit": "5000",
                },
            )
        if r.status_code >= 400:
            # Without the log we could double-send, so treat a failed read as
            # "don't send anything this run" rather than "nothing was sent".
            raise RuntimeError(f"deadline_reminder_log read failed: {r.status_code} {r.text[:200]}")
        for row in r.json() or []:
            sent.add((str(row["instructor_id"]), str(row["item_key"]), str(row["due_date"])[:10], str(row["stage"])))
    return sent


async def _log_sent(rem: Dict[str, Any], channels: str) -> bool:
    """Record that this stage was handled. False if the write failed — in which
    case the next run may send it again, so it is logged loudly."""
    sb = lr._sb_url()
    item = rem["item"]
    async with lr._client() as client:
        r = await client.post(
            f"{sb}/rest/v1/deadline_reminder_log",
            headers={**lr._sb_headers(), "Prefer": "resolution=ignore-duplicates"},
            json={
                "instructor_id": item["instructor_id"],
                "item_key": item["item_key"],
                "due_date": rem["due"].isoformat(),
                "stage": rem["stage"],
                "channels": channels,
            },
        )
    if r.status_code >= 400:
        log.error(
            "[deadlines] could not record %s reminder for %s (%s) — it may be sent again: %s %s",
            rem["stage"], item.get("item_key"), item.get("instructor_id"), r.status_code, r.text[:200],
        )
        return False
    return True


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------

async def _send_email(rem: Dict[str, Any]) -> bool:
    instructor, item = rem["instructor"], rem["item"]
    to = (instructor.get("email") or "").strip()
    subject, html_body, text_body = email_service.render_deadline_reminder_email(
        instructor_name=instructor.get("full_name"),
        kind=item.get("kind") or "other",
        label=item.get("label"),
        stage=rem["stage"],
        days_left=rem["days_left"],
        due_date_text=format_due_date(rem["due"]),
    )
    payload = email_service.build_payload(
        to=to, subject=subject, html_body=html_body, text_body=text_body,
        from_header=email_service.system_sender_header(),
    )
    try:
        async with lr._client() as client:
            await email_service.send_email(payload, client=client)
    except email_service.EmailSendError as e:
        log.warning("[deadlines] email to instructor %s failed: %s", instructor.get("id"), e)
        return False
    return True


async def _send_push(rem: Dict[str, Any], tokens: List[str]) -> bool:
    item = rem["item"]
    label = email_service.deadline_item_label(item.get("kind") or "other", item.get("label"))
    left, stage = rem["days_left"], rem["stage"]
    if stage == "overdue":
        title = f"{label} is overdue"
    elif left <= 0:
        title = f"{label} is due today"
    elif left == 1:
        title = f"{label} is due tomorrow"
    else:
        title = f"{label} due in {left} days"
    messages = [
        {"to": t, "title": title, "body": "Open ADI Pro to review your deadlines.", "sound": "default",
         "data": {"type": "deadline", "kind": item.get("kind")}}
        for t in tokens
    ]
    result = await lr._send_push(messages)
    return result["accepted"] > 0


async def _deliver(rem: Dict[str, Any]) -> str:
    """Tell the instructor by email and push (both, when both are possible).

    Returns the channels used ('email', 'push' or 'email+push'), or:
      'none'   nobody reachable — logged so we stop re-checking every morning
      'retry'  someone was reachable but every attempt failed — NOT logged, so
               tomorrow's run tries again (the stage window is days wide)
    """
    instructor = rem["instructor"]
    address = (instructor.get("email") or "").strip()
    can_email = email_service.looks_like_email(address) and email_service.is_configured()
    auth_id = instructor.get("auth_user_id")
    tokens = await lr._push_tokens_for_user(auth_id) if auth_id else []

    attempted, used = False, []
    if can_email:
        attempted = True
        if await _send_email(rem):
            used.append("email")
    if tokens:
        attempted = True
        if await _send_push(rem, tokens):
            used.append("push")
    if used:
        return "+".join(used)
    return "retry" if attempted else "none"


# ---------------------------------------------------------------------------
# The job
# ---------------------------------------------------------------------------

async def dispatch_deadline_reminders() -> Dict[str, Any]:
    """One run: find every reminder due today and send it. Safe to run any
    number of times a day — already-sent stages are skipped."""
    if not lr._sb_url() or not lr._sb_key():
        return {"ok": False, "reason": "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing"}
    today = uk_today()
    items = await _fetch_items(today)
    if not items:
        return {"ok": True, "candidates": 0, "sent": 0}
    ids = sorted({str(i["instructor_id"]) for i in items})
    instructors = await _fetch_instructors(ids)
    try:
        already = await _fetch_sent(ids, today)
    except RuntimeError as e:
        log.error("[deadlines] %s — skipping this run to avoid double-sending", e)
        return {"ok": False, "reason": str(e)}

    plan = plan_reminders(items, instructors, already, today)
    counts = {"email": 0, "push": 0, "email+push": 0, "none": 0, "retry": 0}
    for rem in plan:
        channels = await _deliver(rem)
        counts[channels] += 1
        if channels != "retry":
            await _log_sent(rem, channels)
    summary = {"ok": True, "candidates": len(items), "due_now": len(plan), **counts}
    if plan:
        log.info("[deadlines] %s", summary)
    return summary


async def catchup_deadline_reminders() -> Dict[str, Any]:
    """Runs shortly after every startup, because a deploy at 07:59 would
    otherwise skip that morning entirely. Only fires in daytime UK hours so a
    late-night redeploy doesn't send anyone an email at 23:00; dedupe means it
    can never repeat the 08:00 run."""
    hour = datetime.now(timezone.utc).astimezone(lr.UK_TZ).hour
    if not (CATCHUP_HOURS_UK[0] <= hour < CATCHUP_HOURS_UK[1]):
        return {"ok": True, "skipped": "outside daytime hours"}
    return await dispatch_deadline_reminders()


def register_jobs(scheduler) -> None:
    """Add this module's jobs to lesson_reminders' scheduler (called from
    start_lesson_reminder_scheduler, before it starts)."""
    scheduler.add_job(
        dispatch_deadline_reminders,
        CronTrigger(hour=REMIND_HOUR_UK, minute=0, timezone=lr.UK_TZ),
        id="deadline_reminders_daily",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        catchup_deadline_reminders,
        "date",
        run_date=datetime.now(timezone.utc) + timedelta(seconds=90),
        id="deadline_reminders_catchup",
        max_instances=1,
    )
    log.info("[deadlines] scheduled daily at %02d:00 UK time, plus a startup catch-up", REMIND_HOUR_UK)
