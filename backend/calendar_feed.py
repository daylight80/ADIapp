"""The instructor's subscribable calendar feed (.ics): pure text generation, so every rule is tested.

Google, Apple and Outlook subscribe to the feed by URL. Google refreshes such calendars only every 12 to 24 hours
and ignores any hint to refresh sooner, so the feed is accurate but never instant. A lesson that is no longer in the
feed (cancelled or deleted) is removed by the subscriber at its next refresh.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

PRODID = "-//DualControl//Lesson Diary//EN"


# ---- text helpers ------------------------------------------------------------------------------------------------

def ics_escape(text: Any) -> str:
    """Escape special characters per RFC 5545 section 3.3.11 for TEXT properties."""
    if text is None:
        return ""
    return (str(text)
            .replace("\\", "\\\\")
            .replace(";", "\\;")
            .replace(",", "\\,")
            .replace("\r\n", "\\n")
            .replace("\n", "\\n")
            .replace("\r", "\\n"))


def ics_fold(line: str) -> str:
    """Fold a long line at 75 octets (RFC 5545 section 3.1) without ever splitting a multi-byte character."""
    if len(line.encode("utf-8")) <= 75:
        return line
    parts: List[str] = []
    current = ""
    limit = 75
    for ch in line:
        if len((current + ch).encode("utf-8")) > limit:
            parts.append(current)
            current, limit = ch, 74  # continuation lines start with a space, which counts
        else:
            current += ch
    parts.append(current)
    return "\r\n ".join(parts)


def parse_utc(value: Any) -> Optional[datetime]:
    try:
        s = str(value)
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def fmt_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


# ---- UK time -----------------------------------------------------------------------------------------------------

def _last_sunday(year: int, month: int) -> date:
    d = date(year, month, 31)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def is_bst(dt_utc: datetime) -> bool:
    """British Summer Time runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October."""
    y = dt_utc.year
    start = datetime(y, 3, _last_sunday(y, 3).day, 1, tzinfo=timezone.utc)
    end = datetime(y, 10, _last_sunday(y, 10).day, 1, tzinfo=timezone.utc)
    return start <= dt_utc < end


def london(dt_utc: datetime) -> datetime:
    return dt_utc + timedelta(hours=1) if is_bst(dt_utc) else dt_utc


def london_hhmm(dt_utc: datetime) -> str:
    return london(dt_utc).strftime("%H:%M")


# ---- events ------------------------------------------------------------------------------------------------------

def _pupil(lesson: Dict[str, Any]) -> Dict[str, Any]:
    s = lesson.get("students")
    return s if isinstance(s, dict) else {}


def _location(lesson: Dict[str, Any]) -> str:
    loc = (lesson.get("pickup_address") or "").strip()
    if loc:
        return loc
    s = _pupil(lesson)
    return ", ".join(b for b in [s.get("address") or "", s.get("postcode") or ""] if b)


def lesson_events(lesson: Dict[str, Any], dtstamp: str, include_travel: bool) -> List[List[str]]:
    start = parse_utc(lesson.get("start_time"))
    if not start:
        return []
    end = parse_utc(lesson.get("end_time")) or start
    name = (_pupil(lesson).get("full_name") or "Student").strip()
    topic = (lesson.get("topic") or "Driving lesson").strip()
    notes = (lesson.get("notes") or "").strip()
    location = _location(lesson)
    is_test = (lesson.get("lesson_type") == "Practical Test")

    bits: List[str] = []
    if is_test:
        centre = (lesson.get("test_centre") or "").strip()
        test_at = parse_utc(lesson.get("test_start"))
        head = "Practical test"
        if test_at:
            head += f" at {london_hhmm(test_at)}"
        if centre:
            head += f", {centre}"
        bits.append(head)
        if location:
            bits.append(f"Pick-up: {location}")
    else:
        bits.append(topic)
    try:
        hours = float(lesson["duration_hours"]) if lesson.get("duration_hours") is not None else None
    except (TypeError, ValueError):
        hours = None
    if hours:
        bits.append(f"{int(hours) if hours.is_integer() else hours}h")
    if notes:
        bits.append(notes)

    summary = f"{'Practical test' if is_test else 'Driving lesson'} — {name}"
    lid = lesson.get("id")
    events = [[
        "BEGIN:VEVENT",
        f"UID:lesson-{lid}@adipro.app",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART:{fmt_utc(start)}",
        f"DTEND:{fmt_utc(end)}",
        f"SUMMARY:{ics_escape(summary)}",
        f"DESCRIPTION:{ics_escape(' · '.join(bits))}",
        f"LOCATION:{ics_escape(location)}",
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "END:VEVENT",
    ]]

    try:
        travel = int(lesson.get("travel_minutes") or 0)
    except (TypeError, ValueError):
        travel = 0
    if include_travel and 0 < travel <= 240:
        events.append([
            "BEGIN:VEVENT",
            f"UID:travel-{lid}@adipro.app",
            f"DTSTAMP:{dtstamp}",
            f"DTSTART:{fmt_utc(start - timedelta(minutes=travel))}",
            f"DTEND:{fmt_utc(start)}",
            f"SUMMARY:{ics_escape('Travel to ' + name)}",
            f"DESCRIPTION:{ics_escape(f'About {travel} min')}",
            f"LOCATION:{ics_escape(location)}",
            "STATUS:CONFIRMED",
            "TRANSP:TRANSPARENT",  # shown, but doesn't count as busy
            "END:VEVENT",
        ])
    return events


def block_label(category: Any) -> str:
    """'annual_leave' -> 'Annual leave'. Only the category is shown, never the free-text reason."""
    c = " ".join(str(category or "").replace("_", " ").replace("-", " ").split())
    return c[:1].upper() + c[1:].lower() if c else "Unavailable"


def block_event(block: Dict[str, Any], dtstamp: str) -> Optional[List[str]]:
    start, end = parse_utc(block.get("starts_at")), parse_utc(block.get("ends_at"))
    if not start or not end or end <= start:
        return None
    summary = f"Not available — {block_label(block.get('category'))}"
    lines = ["BEGIN:VEVENT", f"UID:block-{block.get('id')}@adipro.app", f"DTSTAMP:{dtstamp}"]
    if block.get("all_day"):
        first = london(start).date()
        last = london(end - timedelta(seconds=1)).date() + timedelta(days=1)  # DTEND is exclusive for all-day events
        lines += [f"DTSTART;VALUE=DATE:{first.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{last.strftime('%Y%m%d')}"]
    else:
        lines += [f"DTSTART:{fmt_utc(start)}", f"DTEND:{fmt_utc(end)}"]
    lines += [f"SUMMARY:{ics_escape(summary)}", "STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT"]
    return lines


def build_ics(
    lessons: Iterable[Dict[str, Any]],
    blocks: Iterable[Dict[str, Any]],
    instructor_name: Optional[str],
    now: Optional[datetime] = None,
    include_travel: bool = False,
) -> str:
    now = now or datetime.now(timezone.utc)
    dtstamp = fmt_utc(now)
    name = instructor_name or "DualControl Instructor"
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "METHOD:PUBLISH",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{ics_escape('DualControl — ' + name)}",
        "X-WR-TIMEZONE:Europe/London",
        f"X-WR-CALDESC:{ics_escape('Driving lessons from DualControl')}",
        # Hints for calendar apps that honour them (Apple does). Google ignores them and refreshes every 12 to 24 hours.
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for lesson in lessons:
        for ev in lesson_events(lesson, dtstamp, include_travel):
            lines.extend(ev)
    for block in blocks:
        ev = block_event(block, dtstamp)
        if ev:
            lines.extend(ev)
    lines.append("END:VCALENDAR")
    return "\r\n".join(ics_fold(ln) for ln in lines) + "\r\n"
