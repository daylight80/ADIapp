"""Payment reminders: an instructor taps "Send payment reminder" on a pupil who owes money.

The pure parts (when another reminder is allowed, what the push says, how pounds are shown) live here so
they can be tested without a network. The sending reuses the lesson-reminder plumbing: push to the pupil's
phone first, then email for a pupil who has no app. Nothing is sent automatically; each one is the
instructor's own action, and the log (migration 073) allows one per pupil every REMINDER_COOLDOWN_DAYS.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import email_service
import lesson_reminders as lr

log = logging.getLogger("payment_reminders")

REMINDER_COOLDOWN_DAYS = 3


def _parse(iso: str) -> datetime:
    dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def next_allowed_at(last_sent_iso: Optional[str]) -> Optional[datetime]:
    """When the next reminder may go, or None when none has been sent yet."""
    if not last_sent_iso:
        return None
    try:
        return _parse(last_sent_iso) + timedelta(days=REMINDER_COOLDOWN_DAYS)
    except ValueError:
        return None


def can_send(last_sent_iso: Optional[str], now: Optional[datetime] = None) -> bool:
    nxt = next_allowed_at(last_sent_iso)
    return nxt is None or (now or datetime.now(timezone.utc)) >= nxt


def format_gbp(amount: float) -> str:
    return f"£{abs(float(amount)):,.2f}"


def push_message(instructor_name: Optional[str]) -> Dict[str, str]:
    """The notification text. No amount: a lock screen can be read by anyone nearby, so the pupil
    opens the app (Wallet) to see it."""
    name = email_service.clean_display_name(instructor_name, fallback="Your instructor")
    first = name.split(" ")[0]
    return {
        "title": "Payment reminder",
        "body": f"{first} has sent you a payment reminder. Open the app to see your balance.",
    }


async def send_reminder(student: Dict[str, Any], instructor: Dict[str, Any], owes: float) -> Optional[str]:
    """Tell the pupil by push, or by email when there is no app. Returns 'push', 'email', or None when
    there was no way to reach them (no app login with a device, and no usable email address)."""
    auth_user_id = student.get("auth_user_id")
    if auth_user_id:
        tokens = await lr._push_tokens_for_user(auth_user_id)
        if tokens:
            msg = push_message(instructor.get("full_name"))
            result = await lr._send_push([
                {"to": t, "title": msg["title"], "body": msg["body"], "sound": "default",
                 "data": {"kind": "payment_reminder"}}
                for t in tokens
            ])
            if result["accepted"] > 0:
                return "push"

    to = (student.get("email") or "").strip()
    if email_service.looks_like_email(to) and email_service.is_configured():
        subject, html_body, text_body = email_service.render_payment_reminder_email(
            student_name=student.get("full_name"),
            instructor_name=instructor.get("full_name"),
            amount_text=format_gbp(owes),
            instructor_phone=instructor.get("mobile_number"),
        )
        payload = email_service.build_payload(
            to=to, subject=subject, html_body=html_body, text_body=text_body,
            from_display_name=instructor.get("full_name") or "Your instructor",
        )
        try:
            async with lr._client() as client:
                await email_service.send_email(payload, client=client)
            return "email"
        except email_service.EmailSendError as e:
            log.warning("[payment-reminders] email to pupil %s failed: %s", student.get("id"), e)
    return None


def describe_wait(last_sent_iso: str) -> Tuple[str, str]:
    """('14 Oct', '17 Oct'): when the last one went and when the next may."""
    last = _parse(last_sent_iso)
    nxt = last + timedelta(days=REMINDER_COOLDOWN_DAYS)
    fmt = lambda d: f"{d.day} {d.strftime('%b')}"  # noqa: E731 (no %-d: not portable to Windows)
    return fmt(last), fmt(nxt)
