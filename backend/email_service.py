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


def build_payload(
    *, to: str, subject: str, html_body: str, text_body: str,
    from_display_name: str, reply_to: Optional[str] = None,
) -> dict:
    payload = {
        "from": sender_header(from_display_name),
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
