"""Dictated lesson summaries: pure helpers (no network), so the wording of the request, the reading of the reply
and the limits are all tested.

The instructor dictates a few sentences about how a lesson went (speech-to-text happens on their phone's keyboard,
so only text reaches us). We ask the model for a short, encouraging summary for the pupil and a suggested plan for
the next lesson. The instructor edits and approves it before anything reaches the pupil. The model only ever sees
the pupil's first name, the lesson topic and the instructor's own words.
"""
import json
import re
from typing import Any, Dict, Optional, Tuple

import address_search

MIN_DICTATION_CHARS = 15
MAX_DICTATION_CHARS = 4000
MAX_SUMMARY_CHARS = 1500
MAX_PLAN_CHARS = 1000

# Drafts are the paid part (each costs an API call): a modest daily cap per instructor, plus a short burst limit.
DRAFTS_PER_DAY = 40
DRAFTS_PER_MINUTE = 6

PAID_TIERS = ("pro", "franchise")


def is_paid_tier(tier: Any) -> bool:
    return isinstance(tier, str) and tier.lower() in PAID_TIERS


class DraftLimits:
    """The burst limit and the daily cap together. A refused call uses no allowance."""

    def __init__(self, clock=None):
        kwargs = {"clock": clock} if clock else {}
        self.burst = address_search.UserLimiter(DRAFTS_PER_MINUTE, 60, **kwargs)
        self.daily = address_search.UserLimiter(DRAFTS_PER_DAY, 86400, **kwargs)

    def allow(self, user_id: str) -> bool:
        if not (self.burst.would_allow(user_id) and self.daily.would_allow(user_id)):
            return False
        self.burst.allow(user_id)
        self.daily.allow(user_id)
        return True


SYSTEM_PROMPT = (
    "You help a UK driving instructor write a short note to a pupil after a lesson, from the instructor's own "
    "dictated remarks. Write in the instructor's voice, in the second person ('you'), warm and encouraging but "
    "honest and plain, not corporate or clinical. Reply with ONLY a JSON object with two string fields: "
    "\"summary\" (2 to 4 short sentences: what went well, then the one or two things to work on) and "
    "\"next_plan\" (1 to 3 short sentences suggesting what to focus on in the next lesson, based on what the "
    "instructor said). Use only what the instructor said: do not invent faults, skills, distances, places or "
    "dates, and do not say whether the pupil will or will not pass their test. If the remarks are thin, keep the "
    "note short rather than padding it. British spelling. No markdown, no headings, no emoji, no preamble."
)


_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(value: Any, limit: int) -> str:
    """Plain text with control characters removed, runs of blank lines tidied, trimmed and capped."""
    if not isinstance(value, str):
        return ""
    s = _CONTROL.sub("", value).replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    return s[:limit].rstrip()


def first_name(full_name: Any) -> str:
    n = clean_text(full_name, 80).split(" ")[0] if isinstance(full_name, str) else ""
    return re.sub(r"[^A-Za-z'\-]", "", n)[:30] or "the pupil"


def validate_dictation(raw: Any) -> str:
    """The dictated text, cleaned. Raises ValueError with a message the instructor can act on."""
    text = clean_text(raw, MAX_DICTATION_CHARS + 1)
    if len(text) < MIN_DICTATION_CHARS:
        raise ValueError("Say a little more about how the lesson went (a couple of sentences is plenty).")
    if len(text) > MAX_DICTATION_CHARS:
        raise ValueError(f"That is too long. Keep it under {MAX_DICTATION_CHARS} characters.")
    return text


def build_request(pupil_full_name: Any, topic: Any, dictation: str) -> Tuple[str, str]:
    topic_text = clean_text(topic, 80) or "General lesson"
    user = f"Pupil's first name: {first_name(pupil_full_name)}\nLesson topic: {topic_text}\n\nThe instructor's remarks:\n{dictation}"
    return SYSTEM_PROMPT, user


def parse_draft(model_text: Any) -> Dict[str, str]:
    """Read the model's reply into {'summary', 'next_plan'}. Tolerates a code fence or stray words around the JSON,
    and falls back to treating the whole reply as the summary. Raises ValueError if nothing usable came back."""
    raw = clean_text(model_text, 8000)
    if not raw:
        raise ValueError("The model returned nothing.")
    candidate = raw
    fenced = re.search(r"```(?:json)?\s*(\{[\s\S]+?\})\s*```", raw, re.I)
    if fenced:
        candidate = fenced.group(1)
    elif not candidate.lstrip().startswith("{"):
        m = re.search(r"\{[\s\S]+\}", candidate)
        if m:
            candidate = m.group(0)
    try:
        obj = json.loads(candidate)
        if isinstance(obj, dict):
            summary = clean_text(obj.get("summary"), MAX_SUMMARY_CHARS)
            plan = clean_text(obj.get("next_plan"), MAX_PLAN_CHARS)
            if summary:
                return {"summary": summary, "next_plan": plan}
        raise ValueError("The model's reply had no summary in it.")
    except json.JSONDecodeError:
        pass
    # Not JSON. Plain prose is used as the summary, but anything that looks like broken JSON is refused rather
    # than showing the pupil's instructor field names and braces.
    if "{" in raw or "}" in raw:
        raise ValueError("The model's reply could not be read.")
    return {"summary": clean_text(raw, MAX_SUMMARY_CHARS), "next_plan": ""}


def validate_approved(summary: Any, next_plan: Any) -> Tuple[str, Optional[str]]:
    """What the instructor approved, cleaned and checked. Raises ValueError if the summary is empty or too long."""
    s = clean_text(summary, MAX_SUMMARY_CHARS + 1)
    if not s:
        raise ValueError("The summary can't be empty.")
    if len(s) > MAX_SUMMARY_CHARS:
        raise ValueError(f"The summary is too long. Keep it under {MAX_SUMMARY_CHARS} characters.")
    p = clean_text(next_plan, MAX_PLAN_CHARS + 1)
    if len(p) > MAX_PLAN_CHARS:
        raise ValueError(f"The plan for next time is too long. Keep it under {MAX_PLAN_CHARS} characters.")
    return s, (p or None)


def push_message(instructor_name: Any) -> Dict[str, str]:
    """The notification text. It never contains the summary: a lock screen can be read by anyone nearby."""
    name = clean_text(instructor_name, 80) or "Your instructor"
    return {
        "title": "Lesson summary",
        "body": f"{name.split(' ')[0]} has written you a summary of your lesson. Open the app to read it.",
    }
