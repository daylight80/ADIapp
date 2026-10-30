"""Turning what a school's website form sends into an enquiry. Pure functions, so they can be tested without the web app.

The form can be an Elementor form with a Webhook action, or the DualControl form page. Elementor posts the fields
named after each field's ID, form-encoded (or nested, with "advanced data" on), so field names are matched loosely:
"Mobile telephone", "mobile_telephone" and "mobile" all mean the phone number. Anything else the form asked is kept
in the notes, so a custom question is never lost."""
import json
import re
import unicodedata
from typing import Dict, Optional
from urllib.parse import parse_qs

import email_service

MAX_BODY_BYTES = 20_000
# Column limits on public.enquiries (migration 087).
NAME_MAX, PHONE_MAX, EMAIL_MAX, POSTCODE_MAX, NOTES_MAX = 100, 30, 200, 10, 1000
MESSAGE_MAX, EXTRA_MAX = 500, 100


class FormError(ValueError):
    """Something the person filling in the form can fix. The text is shown to them."""


class UnsupportedType(FormError):
    pass


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


_NAME = {"name", "fullname", "yourname", "studentname", "pupilname"}
_FIRST = {"firstname", "fname", "first"}
_LAST = {"lastname", "surname", "lname", "last"}
_PHONE = {"phone", "mobile", "mobilenumber", "mobiletelephone", "telephone", "tel", "phonenumber", "yourphone", "contactnumber"}
_EMAIL = {"email", "emailaddress", "youremail"}
_POSTCODE = {"postcode", "postalcode", "zip", "zipcode"}
_MESSAGE = {"message", "notes", "comments", "comment", "yourmessage", "enquiry", "details", "studentrequests"}
# Shown in the notes in this order, under the label.
_EXTRAS = (
    ("Availability", {"availability", "availabilty", "whenareyoufree"}),
    ("Start date", {"startdate", "start"}),
    ("Theory test", {"theory", "theorytest", "theorypassed"}),
    ("Practical test", {"practical", "practicaltest", "testbooked"}),
    ("Transmission", {"transmission", "gearbox"}),
    ("Instructor gender", {"instructorgender", "gender", "genderpreference"}),
    ("Address", {"address", "homeaddress", "pickupaddress"}),
)
# Fields a form or a plugin adds that are not the visitor's answers.
_IGNORED = {"formid", "formname", "postid", "queriedid", "nonce", "action", "referer", "submit", "gcaptcharesponse",
            "recaptchatoken", "recaptcha"}  # a consent tick is kept: it is the record that they agreed to be contacted
_KNOWN = _NAME | _FIRST | _LAST | _PHONE | _EMAIL | _POSTCODE | _MESSAGE | {a for _, s in _EXTRAS for a in s}


def _walk(obj, key: Optional[str], out: Dict[str, str]) -> None:
    if isinstance(obj, dict):
        if "value" in obj and key and not isinstance(obj["value"], (dict, list)):
            out[key] = "" if obj["value"] is None else str(obj["value"])  # Elementor advanced data: {"id", "value", ...}
            return
        for k, v in obj.items():
            if key is None and str(k).lower() in ("form", "meta"):
                continue  # Elementor's own details about the form and the visit
            _walk(v, str(k), out)
    elif isinstance(obj, list):
        if key:
            out[key] = ", ".join(str(x) for x in obj if not isinstance(x, (dict, list)))
    elif obj is not None and key:
        out[key] = str(obj)


def parse_body(content_type: Optional[str], raw: bytes) -> Dict[str, str]:
    """The fields as a flat {field name: text}. JSON or form-encoded; anything else is refused."""
    kind = (content_type or "").split(";")[0].strip().lower()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise FormError("That did not look like a form.")
    out: Dict[str, str] = {}
    if kind == "application/json":
        try:
            data = json.loads(text)
        except ValueError:
            raise FormError("That did not look like a form.")
        if not isinstance(data, dict):
            raise FormError("That did not look like a form.")
        _walk(data, None, out)
        return out
    if kind == "application/x-www-form-urlencoded":
        for k, v in parse_qs(text, keep_blank_values=True).items():
            m = re.fullmatch(r"fields\[([^\]]+)\](?:\[value\])?", k)
            if m:
                out[m.group(1)] = v[0]
            elif not re.match(r"(form|meta|fields)\[", k):
                out[k] = v[0]
        return out
    raise UnsupportedType("Send the form as JSON or as a normal form post.")


def _clean(value: Optional[str], limit: int, multiline: bool = False) -> str:
    text = unicodedata.normalize("NFC", value or "")
    text = "".join(c for c in text if c == "\n" or (c >= " " and c != "\x7f" and unicodedata.category(c) != "Cc"))
    text = re.sub(r"[ \t]+", " ", text)
    if not multiline:
        text = text.replace("\n", " ")
    else:
        text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:limit]


def is_honeypot_filled(fields: Dict[str, str]) -> bool:
    """A hidden field a person never sees. Anything in it means a bot filled in every box."""
    return any(("honeypot" in _key(k) or _key(k) in ("hp", "hpwebsite", "companywebsite")) and v.strip() for k, v in fields.items())


def build_enquiry(fields: Dict[str, str]) -> dict:
    """name, phone, email, postcode and notes for the enquiries table, or a FormError for the visitor."""
    by_key: Dict[str, str] = {}
    original: Dict[str, str] = {}
    for k, v in fields.items():
        nk = _key(k)
        if nk and v.strip() and nk not in by_key:
            by_key[nk], original[nk] = v, k

    def first_of(aliases) -> str:
        return next((by_key[a] for a in aliases if a in by_key), "")

    name = _clean(first_of(_NAME), NAME_MAX) or _clean(f"{first_of(_FIRST)} {first_of(_LAST)}", NAME_MAX)
    if not name:
        raise FormError("Please enter your name.")

    email = _clean(first_of(_EMAIL), EMAIL_MAX).lower()
    if email and not email_service.looks_like_email(email):
        raise FormError("That email address does not look right.")
    phone = re.sub(r"[^0-9+]", "", _clean(first_of(_PHONE), PHONE_MAX * 2))[:PHONE_MAX]
    if phone and len(re.sub(r"\D", "", phone)) < 7:
        raise FormError("That phone number does not look right.")
    if not email and not phone:
        raise FormError("Please give a mobile number or an email address so we can reply.")

    postcode = _clean(first_of(_POSTCODE), POSTCODE_MAX).upper()

    lines = []
    message = _clean(first_of(_MESSAGE), MESSAGE_MAX, multiline=True)
    if message:
        lines.append(f"Message: {message}")
    for label, aliases in _EXTRAS:
        value = _clean(first_of(aliases), EXTRA_MAX)
        if value:
            lines.append(f"{label}: {value}")
    for nk, value in by_key.items():
        if nk not in _KNOWN and nk not in _IGNORED and not nk.startswith("hp") and "honeypot" not in nk and len(lines) < 14:
            value = _clean(value, EXTRA_MAX)
            if value:
                lines.append(f"{_clean(original[nk].replace('_', ' ').replace('-', ' '), 40).capitalize()}: {value}")
    notes = "\n".join(lines)[:NOTES_MAX]

    return {"name": name, "phone": phone or None, "email": email or None, "postcode": postcode or None, "notes": notes or None}
