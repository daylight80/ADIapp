"""Outbound email via Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).

Uses httpx, which the backend already depends on — no new package. Sending is
a no-op-with-a-clear-error until RESEND_API_KEY is set (on Render, never in the
repo), so this module is safe to deploy before the Resend account and DNS are
ready.

Sending domain: Resend is set up on a SUBDOMAIN (adipro.drivingschoolsolutions.co.uk),
deliberately not the root domain — the root already has live mailbox email via
Stack (MX + an SPF record ending in -all), and sending from the root through
Resend would mean editing that SPF record and risking the existing mailbox.
"""
import html
import os
import re
from typing import Optional, Tuple

import httpx

RESEND_API_URL = "https://api.resend.com/emails"

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
# The address part only; the display name is added per email (see sender_header).
EMAIL_FROM_ADDRESS = os.environ.get("EMAIL_FROM_ADDRESS", "hello@adipro.drivingschoolsolutions.co.uk")
# Shown in the footer of referral emails as the opt-out route (PECR: the
# recipient must be able to say "stop"). Must be a mailbox that is actually read.
EMAIL_SUPPORT_ADDRESS = os.environ.get("EMAIL_SUPPORT_ADDRESS", "hello@drivingschoolsolutions.co.uk")
# Shown in lesson reminder footers specifically — students don't reply to
# these (instructors have no monitored mailbox), so it's the one contact
# route offered instead.
LESSON_REMINDER_SUPPORT_ADDRESS = os.environ.get("LESSON_REMINDER_SUPPORT_ADDRESS", "adipro@drivingschoolsolutions.co.uk")


class EmailNotConfigured(Exception):
    """RESEND_API_KEY is not set."""


class EmailSendError(Exception):
    """Resend rejected the request or could not be reached."""


def is_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY", RESEND_API_KEY))


_CONTROL_AND_HEADER_CHARS = re.compile(r'[\x00-\x1f\x7f<>"\\]')


def clean_display_name(name: Optional[str], fallback: str = "A fellow instructor") -> str:
    """Make a user-supplied name safe to use in an email header and body.

    Strips control characters (blocks header injection via newlines) and the
    characters that could break out of a `"Name" <addr>` header. Truncated so a
    huge name can't be used to stuff the subject line.
    """
    cleaned = _CONTROL_AND_HEADER_CHARS.sub("", name or "").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)[:60]
    return cleaned or fallback


def sender_header(display_name: str) -> str:
    return f'"{clean_display_name(display_name)} via ADI Pro" <{EMAIL_FROM_ADDRESS}>'


def render_referral_email(referrer_name: str, code: str, share_link: str) -> Tuple[str, str, str]:
    """Return (subject, html_body, text_body) for an instructor-to-instructor referral."""
    name = clean_display_name(referrer_name)
    esc_name = html.escape(name)
    esc_code = html.escape(code)
    esc_link = html.escape(share_link, quote=True)
    esc_support = html.escape(EMAIL_SUPPORT_ADDRESS)

    subject = f"{name} thinks you'd like ADI Pro"

    text = (
        f"Hi,\n\n"
        f"{name} uses ADI Pro to run their driving lessons and asked us to send you an invite.\n\n"
        f"ADI Pro is a diary, student tracker, wallet and invoicing app built for approved "
        f"driving instructors.\n\n"
        f"Sign up here: {share_link}\n"
        f"Referral code: {code}\n\n"
        f"You're receiving this once because {name} entered your email address. We won't email "
        f"you again unless they do. If you'd rather not get emails like this, reply to "
        f"{EMAIL_SUPPORT_ADDRESS} and we'll make sure you aren't sent another.\n"
    )

    body = f"""\
<!doctype html>
<html lang="en-GB">
<body style="margin:0;padding:24px;background:#f5f2ec;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;">
    <tr><td style="padding:28px 28px 8px;">
      <div style="font-size:13px;font-weight:bold;color:#00539f;letter-spacing:.5px;">ADI PRO</div>
      <h1 style="font-size:20px;line-height:1.3;margin:10px 0 14px;">{esc_name} thinks you'd like ADI Pro</h1>
      <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">{esc_name} uses ADI Pro to run their driving lessons and asked us to send you an invite.</p>
      <p style="font-size:15px;line-height:1.55;margin:0 0 20px;">It's a diary, student tracker, wallet and invoicing app built for approved driving instructors.</p>
      <p style="margin:0 0 20px;"><a href="{esc_link}" style="display:inline-block;background:#ff6b00;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:10px;">Sign up to ADI Pro</a></p>
      <p style="font-size:13px;color:#64748b;margin:0 0 6px;">Referral code: <strong>{esc_code}</strong></p>
    </td></tr>
    <tr><td style="padding:16px 28px 24px;border-top:1px solid #e4ded2;">
      <p style="font-size:12px;line-height:1.5;color:#64748b;margin:0;">You're receiving this once because {esc_name} entered your email address. We won't email you again unless they do. If you'd rather not get emails like this, email <a href="mailto:{esc_support}" style="color:#64748b;">{esc_support}</a> and we'll make sure you aren't sent another.</p>
    </td></tr>
  </table>
</body>
</html>
"""
    return subject, body, text


def render_lesson_reminder_email(
    *,
    student_name: Optional[str],
    instructor_name: Optional[str],
    kind: str,
    weekday: str,
    date_text: str,
    time_text: str,
    pickup_address: Optional[str] = None,
    instructor_phone: Optional[str] = None,
) -> Tuple[str, str, str]:
    """Return (subject, html_body, text_body) for a student's lesson reminder.

    `kind` is 'h48' or 'h25'. Times must already be UK local time. A plain
    service message about a lesson the student has booked — no marketing
    content — so it needs no marketing consent, and the footer tells the
    student who to contact instead. Instructors don't have a monitored
    mailbox, so the change/cancel line points the student to a phone call
    rather than a reply. Every user-supplied string is escaped.
    """
    first = clean_display_name(student_name, fallback="").split(" ")[0]
    instructor = clean_display_name(instructor_name, fallback="your instructor")
    # Same cleaning as a name, but an address can legitimately be longer than
    # clean_display_name's 60-char cap.
    address = re.sub(r"\s+", " ", _CONTROL_AND_HEADER_CHARS.sub("", pickup_address or "")).strip()[:200]
    phone = re.sub(r"\s+", " ", _CONTROL_AND_HEADER_CHARS.sub("", instructor_phone or "")).strip()[:30]

    if kind == "h25":
        subject = f"Your driving lesson is tomorrow at {time_text}"
        headline = f"Lesson tomorrow at {time_text}"
        lead = f"Just a reminder that you have a driving lesson tomorrow with {instructor}."
    else:
        subject = f"Reminder: your driving lesson on {weekday} at {time_text}"
        headline = f"Lesson on {weekday} at {time_text}"
        lead = f"Just a reminder that you have a driving lesson coming up with {instructor}."

    when = f"{weekday} {date_text} at {time_text}"
    greeting = f"Hi {first}," if first else "Hi,"
    esc = html.escape
    esc_support = esc(EMAIL_SUPPORT_ADDRESS)

    if phone:
        contact_line = f"If you need to change or cancel your lesson, please call {instructor} on {phone}."
    else:
        contact_line = f"If you need to change or cancel your lesson, please contact {instructor}."

    text_lines = [greeting, "", lead, "", f"When: {when}"]
    if address:
        text_lines.append(f"Pick-up: {address}")
    text_lines += [
        "",
        contact_line,
        "",
        f"You're receiving this reminder email because {instructor} booked a driving lesson for you using "
        f"ADI Pro. Questions about these emails: {LESSON_REMINDER_SUPPORT_ADDRESS}.",
    ]
    text = "\n".join(text_lines) + "\n"

    pickup_html = (
        f'<p style="font-size:15px;line-height:1.55;margin:0 0 6px;"><strong>Pick-up:</strong> {esc(address)}</p>'
        if address else ""
    )
    contact_html = (
        f"If you need to change or cancel your lesson, please call {esc(instructor)} on {esc(phone)}."
        if phone else
        f"If you need to change or cancel your lesson, please contact {esc(instructor)}."
    )
    esc_lesson_support = esc(LESSON_REMINDER_SUPPORT_ADDRESS)
    body = f"""\
<!doctype html>
<html lang="en-GB">
<body style="margin:0;padding:24px;background:#f5f2ec;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;">
    <tr><td style="padding:28px 28px 8px;">
      <div style="font-size:13px;font-weight:bold;color:#00539f;letter-spacing:.5px;">ADI PRO</div>
      <h1 style="font-size:20px;line-height:1.3;margin:10px 0 14px;">{esc(headline)}</h1>
      <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">{esc(greeting)}</p>
      <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">{esc(lead)}</p>
      <p style="font-size:15px;line-height:1.55;margin:0 0 6px;"><strong>When:</strong> {esc(when)}</p>
      {pickup_html}
      <p style="font-size:15px;line-height:1.55;margin:14px 0 20px;">{contact_html}</p>
    </td></tr>
    <tr><td style="padding:16px 28px 24px;border-top:1px solid #e4ded2;">
      <p style="font-size:12px;line-height:1.5;color:#64748b;margin:0;">You're receiving this reminder email because {esc(instructor)} booked a driving lesson for you using ADI Pro. Questions about these emails: <a href="mailto:{esc_lesson_support}" style="color:#64748b;">{esc_lesson_support}</a>.</p>
    </td></tr>
  </table>
</body>
</html>
"""
    return subject, body, text


def looks_like_email(value: Optional[str]) -> bool:
    """Cheap sanity check on an instructor-typed address before we spend a
    send on it. Deliberately loose — Resend does the real validation."""
    v = (value or "").strip()
    return bool(re.fullmatch(r"[^@\s<>\",;]+@[^@\s<>\",;]+\.[^@\s<>\",;]+", v)) and len(v) <= 254


def system_sender_header() -> str:
    """Sender for messages ADI Pro sends about the recipient's own account
    (deadline reminders), where "<someone> via ADI Pro" would read oddly."""
    return f'"ADI Pro" <{EMAIL_FROM_ADDRESS}>'


# What a deadline reminder is for. Kept next to the template, and deliberately
# free of legal claims — just a short, safe nudge about what to do.
DEADLINE_KIND_LABELS = {
    "adi_badge": "ADI badge renewal",
    "standards_check": "DVSA standards check",
    "mot": "MOT",
    "insurance": "Car insurance",
    "road_tax": "Road tax",
    "dual_controls": "Dual-control service",
    "other": "Deadline",
}
DEADLINE_KIND_HINTS = {
    "adi_badge": "Renew your ADI registration with the DVSA in good time.",
    "standards_check": "DVSA re-checks every approved driving instructor at least once every 4 years.",
    "mot": "Book your MOT so the car stays legal for lessons.",
    "insurance": "Check your cover is renewed and suitable for driving tuition.",
    "road_tax": "Make sure the vehicle is taxed before this date.",
    "dual_controls": "Have your dual controls serviced and checked.",
    "other": "",
}


def _clean_line(value: Optional[str], limit: int = 80) -> str:
    """Single-line, header-safe version of user text (used in subjects)."""
    return re.sub(r"\s+", " ", _CONTROL_AND_HEADER_CHARS.sub("", value or "")).strip()[:limit]


def deadline_item_label(kind: str, label: Optional[str]) -> str:
    """Display name for a deadline: the user's own label for custom ones."""
    if kind == "other" or (label and label.strip()):
        return _clean_line(label) or DEADLINE_KIND_LABELS.get(kind, "Deadline")
    return DEADLINE_KIND_LABELS.get(kind, "Deadline")


def _app_link(path: str) -> Optional[str]:
    """Link into the web app, or None when APP_DOMAIN isn't set to a real
    address (the dev default is localhost, which is useless in an email)."""
    base = (os.environ.get("APP_DOMAIN") or "").strip().rstrip("/")
    if not base.startswith("https://"):
        return None
    return f"{base}/{path.lstrip('/')}"


def render_deadline_reminder_email(
    *,
    instructor_name: Optional[str],
    kind: str,
    label: Optional[str],
    stage: str,
    days_left: int,
    due_date_text: str,
) -> Tuple[str, str, str]:
    """Return (subject, html_body, text_body) for an instructor's own deadline.

    `stage` is 'd30', 'd7', 'd1' or 'overdue'; `days_left` is negative when
    overdue; `due_date_text` is already formatted (e.g. "Thursday 8 October").
    """
    name = _clean_line(instructor_name, 60)
    item = deadline_item_label(kind, label)
    hint = DEADLINE_KIND_HINTS.get(kind, "")

    if stage == "overdue":
        overdue_by = abs(days_left)
        subject = f"{item} was due on {due_date_text}"
        headline = f"{item} is overdue"
        lead = f"Your {item} was due on {due_date_text}" + (
            f" — {overdue_by} day{'s' if overdue_by != 1 else ''} ago." if overdue_by else "."
        )
    elif days_left <= 0:
        subject = f"{item} is due today"
        headline = f"{item} is due today"
        lead = f"Your {item} is due today ({due_date_text})."
    elif days_left == 1:
        subject = f"{item} is due tomorrow"
        headline = f"{item} is due tomorrow"
        lead = f"Your {item} is due tomorrow ({due_date_text})."
    else:
        subject = f"{item} due in {days_left} days ({due_date_text})"
        headline = f"{item} due in {days_left} days"
        lead = f"Your {item} is due in {days_left} days, on {due_date_text}."

    greeting = f"Hi {name.split(' ')[0]}," if name else "Hi,"
    link = _app_link("deadlines-screen")
    esc = html.escape
    support = esc(EMAIL_SUPPORT_ADDRESS)
    if kind == "standards_check":
        # This one's date is worked out from the checks the instructor has
        # logged, so there is no date to edit — logging the new check is the fix.
        renewed = "Had your check already? Log it in ADI Pro (Profile > My Standards Check) so we stop reminding you."
    else:
        renewed = "Already sorted it? Update the date in ADI Pro (Profile > Deadlines) so we stop reminding you."

    text_lines = [greeting, "", lead]
    if hint:
        text_lines += ["", hint]
    text_lines += ["", renewed]
    if link:
        text_lines += ["", f"Open your deadlines: {link}"]
    text_lines += ["", "You're getting this because you track this deadline in ADI Pro."]
    text = "\n".join(text_lines) + "\n"

    hint_html = f'<p style="font-size:15px;line-height:1.55;margin:0 0 14px;">{esc(hint)}</p>' if hint else ""
    button_html = (
        f'<p style="margin:0 0 20px;"><a href="{esc(link, quote=True)}" style="display:inline-block;background:#ff6b00;'
        f'color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:10px;">'
        f'Open my deadlines</a></p>'
    ) if link else ""
    body = f"""\
<!doctype html>
<html lang="en-GB">
<body style="margin:0;padding:24px;background:#f5f2ec;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;">
    <tr><td style="padding:28px 28px 8px;">
      <div style="font-size:13px;font-weight:bold;color:#00539f;letter-spacing:.5px;">ADI PRO</div>
      <h1 style="font-size:20px;line-height:1.3;margin:10px 0 14px;">{esc(headline)}</h1>
      <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">{esc(greeting)}</p>
      <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">{esc(lead)}</p>
      {hint_html}
      {button_html}
      <p style="font-size:13px;line-height:1.5;color:#64748b;margin:0 0 6px;">{esc(renewed)}</p>
    </td></tr>
    <tr><td style="padding:16px 28px 24px;border-top:1px solid #e4ded2;">
      <p style="font-size:12px;line-height:1.5;color:#64748b;margin:0;">You're getting this because you track this deadline in ADI Pro. Questions: <a href="mailto:{support}" style="color:#64748b;">{support}</a>.</p>
    </td></tr>
  </table>
</body>
</html>
"""
    return subject, body, text


def build_payload(
    *, to: str, subject: str, html_body: str, text_body: str,
    from_display_name: str = "", reply_to: Optional[str] = None,
    from_header: Optional[str] = None,
) -> dict:
    payload = {
        "from": from_header or sender_header(from_display_name),
        "to": [to],
        "subject": subject,
        "html": html_body,
        "text": text_body,
    }
    if reply_to:
        payload["reply_to"] = reply_to
    return payload


async def send_email(payload: dict, client: Optional[httpx.AsyncClient] = None) -> None:
    """POST a prepared payload to Resend. Raises EmailNotConfigured / EmailSendError."""
    api_key = os.environ.get("RESEND_API_KEY", RESEND_API_KEY)
    if not api_key:
        raise EmailNotConfigured("RESEND_API_KEY is not set")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=15.0)
    try:
        r = await client.post(RESEND_API_URL, json=payload, headers=headers)
    except httpx.HTTPError as e:
        raise EmailSendError(f"Could not reach Resend: {e}") from e
    finally:
        if owns_client:
            await client.aclose()
    if r.status_code >= 400:
        raise EmailSendError(f"Resend rejected the email (HTTP {r.status_code}): {r.text[:200]}")
