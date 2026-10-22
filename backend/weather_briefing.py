"""Weather for the road briefing: pure helpers (no network), so the rules for what counts as a hazard are tested.

The app sends the area (the outward part of a postcode, such as "CR4", not a full address) and the lesson times.
We look up the area's position, fetch Google's hourly forecast, and for each lesson say what to watch for: rain,
heavy rain, snow, ice, strong wind, fog or thunderstorms. Only the area and times leave the phone, never a name
or a street.
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

OUTCODE_RE = re.compile(r"^[A-Z]{1,2}[0-9][A-Z0-9]?$")
POSTCODE_RE = re.compile(r"\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*[0-9][A-Z]{2}\b", re.I)

MAX_WINDOWS = 12
MAX_WINDOW_HOURS = 6
FORECAST_AHEAD_DAYS = 3

# What counts as worth a warning (UK driving, so rain and cold matter more than heat).
RAIN_PROBABILITY_PERCENT = 60
RAIN_MIN_MM = 0.2
HEAVY_RAIN_MM = 2.5
ICE_TEMP_C = 2.0
FREEZING_TEMP_C = 0.0
STRONG_GUST_MPH = 35.0
FOG_VISIBILITY_KM = 1.0
THUNDER_PROBABILITY_PERCENT = 40

KMH_PER_MPH = 1.609344

# Worst first, for choosing what to show when a lesson has several.
SEVERITY_ORDER = ["thunder", "snow", "ice", "heavy_rain", "fog", "wind", "rain"]
FLAG_TEXT = {
    "thunder": "Thunderstorms possible",
    "snow": "Snow",
    "ice": "Ice possible, take care on untreated roads",
    "heavy_rain": "Heavy rain",
    "fog": "Fog, reduced visibility",
    "wind": "Strong winds",
    "rain": "Rain",
}


def outcode_from(text: Any) -> Optional[str]:
    """The outward part of a UK postcode in an address or postcode string ('12 High St, Mitcham CR4 3AB' -> 'CR4')."""
    if not isinstance(text, str):
        return None
    m = POSTCODE_RE.search(text.upper())
    if m:
        return m.group(1).upper()
    t = text.strip().upper()
    return t if OUTCODE_RE.match(t) else None


def valid_outcode(value: Any) -> Optional[str]:
    v = (value or "").strip().upper() if isinstance(value, str) else ""
    return v if OUTCODE_RE.match(v) else None


def parse_time(value: Any) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _number(obj: Any, *path: str) -> Optional[float]:
    cur = obj
    for p in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    try:
        return float(cur) if cur is not None else None
    except (TypeError, ValueError):
        return None


def _speed_mph(block: Any) -> Optional[float]:
    """A wind speed block {value, unit} in mph, whichever unit Google used."""
    if not isinstance(block, dict):
        return None
    try:
        v = float(block.get("value"))
    except (TypeError, ValueError):
        return None
    unit = str(block.get("unit") or "KILOMETERS_PER_HOUR").upper()
    if unit.startswith("MILES"):
        return v
    if unit.startswith("METERS_PER_SECOND"):
        return v * 3.6 / KMH_PER_MPH
    return v / KMH_PER_MPH


def _km(block: Any) -> Optional[float]:
    if not isinstance(block, dict):
        return None
    try:
        v = float(block.get("distance"))
    except (TypeError, ValueError):
        return None
    return v * 1.609344 if str(block.get("unit") or "KILOMETERS").upper().startswith("MILES") else v


def _celsius(block: Any) -> Optional[float]:
    if not isinstance(block, dict):
        return None
    try:
        v = float(block.get("degrees"))
    except (TypeError, ValueError):
        return None
    return (v - 32) * 5 / 9 if str(block.get("unit") or "CELSIUS").upper().startswith("FAHR") else v


def parse_forecast_hours(body: Any) -> List[Dict[str, Any]]:
    """Google's forecastHours into plain rows: start, end, temp_c, rain_percent, rain_mm, gust_mph, visibility_km,
    thunder_percent, condition. Rows without a readable time interval are dropped."""
    out: List[Dict[str, Any]] = []
    for h in (body or {}).get("forecastHours", []) if isinstance(body, dict) else []:
        if not isinstance(h, dict):
            continue
        interval = h.get("interval") or {}
        start, end = parse_time(interval.get("startTime")), parse_time(interval.get("endTime"))
        if not start or not end:
            continue
        precip = h.get("precipitation") or {}
        out.append({
            "start": start, "end": end,
            "temp_c": _celsius(h.get("temperature")),
            "rain_percent": _number(precip, "probability", "percent"),
            "rain_mm": _number(precip, "qpf", "quantity"),
            "gust_mph": _speed_mph((h.get("wind") or {}).get("gust")) or _speed_mph((h.get("wind") or {}).get("speed")),
            "visibility_km": _km(h.get("visibility")),
            "thunder_percent": _number(h, "thunderstormProbability"),
            "condition": str(((h.get("weatherCondition") or {}).get("type")) or "").upper(),
        })
    return out


def flags_for_hour(row: Dict[str, Any]) -> List[str]:
    flags: List[str] = []
    cond = row.get("condition") or ""
    temp, rain_p, rain_mm = row.get("temp_c"), row.get("rain_percent"), row.get("rain_mm")
    wet = (rain_p is not None and rain_p >= RAIN_PROBABILITY_PERCENT and (rain_mm or 0) >= RAIN_MIN_MM) or any(
        k in cond for k in ("RAIN", "SHOWERS", "DRIZZLE"))
    if "HEAVY_RAIN" in cond or (rain_mm is not None and rain_mm >= HEAVY_RAIN_MM and wet):
        flags.append("heavy_rain")
    elif wet:
        flags.append("rain")
    if "SNOW" in cond or "SLEET" in cond or "HAIL" in cond:
        flags.append("snow")
    if temp is not None and (temp <= FREEZING_TEMP_C or (temp <= ICE_TEMP_C and ((rain_p or 0) >= 30 or wet))):
        flags.append("ice")
    if row.get("gust_mph") is not None and row["gust_mph"] >= STRONG_GUST_MPH:
        flags.append("wind")
    if "FOG" in cond or (row.get("visibility_km") is not None and row["visibility_km"] < FOG_VISIBILITY_KM):
        flags.append("fog")
    if "THUNDER" in cond or (row.get("thunder_percent") or 0) >= THUNDER_PROBABILITY_PERCENT:
        flags.append("thunder")
    return flags


def flags_for_window(hours: List[Dict[str, Any]], start: datetime, end: datetime) -> Dict[str, Any]:
    """What to watch for during [start, end): every flag from any forecast hour that overlaps it, worst first,
    plus the temperature range and the condition of the first hour for a one-line summary."""
    overlapping = [h for h in hours if h["start"] < end and h["end"] > start]
    if not overlapping:
        return {"flags": [], "summary": None, "covered": False}
    seen: List[str] = []
    for h in overlapping:
        for f in flags_for_hour(h):
            if f not in seen:
                seen.append(f)
    seen.sort(key=lambda f: SEVERITY_ORDER.index(f))
    temps = [h["temp_c"] for h in overlapping if h.get("temp_c") is not None]
    summary = None
    if temps:
        lo, hi = round(min(temps)), round(max(temps))
        summary = f"{lo}°C" if lo == hi else f"{lo} to {hi}°C"
    return {"flags": [{"kind": f, "text": FLAG_TEXT[f]} for f in seen], "summary": summary, "covered": True}


def check_windows(raw: Any, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """The requested lesson windows, validated: at most MAX_WINDOWS, each a real start before its end, no longer than
    MAX_WINDOW_HOURS, starting no further ahead than FORECAST_AHEAD_DAYS. Raises ValueError if any is unusable."""
    now = now or datetime.now(timezone.utc)
    if not isinstance(raw, list) or not raw:
        raise ValueError("Send at least one lesson time.")
    if len(raw) > MAX_WINDOWS:
        raise ValueError(f"Too many lessons: the most is {MAX_WINDOWS}.")
    out = []
    for i, w in enumerate(raw):
        s, e = parse_time((w or {}).get("start")), parse_time((w or {}).get("end"))
        wid = str((w or {}).get("id") or i)[:64]
        if not s or not e or e <= s:
            raise ValueError("A lesson time was not readable.")
        if e - s > timedelta(hours=MAX_WINDOW_HOURS):
            raise ValueError("A lesson was longer than the briefing allows.")
        if s > now + timedelta(days=FORECAST_AHEAD_DAYS) or e < now - timedelta(days=1):
            raise ValueError("Lesson times must be within the next few days.")
        out.append({"id": wid, "start": s, "end": e})
    return out
