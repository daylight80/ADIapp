"""UK address suggestions through Google Places (New). Kept apart from server.py so the parsing and the
per-user limit can be tested without the web app or a network."""
import time
from typing import Optional

AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"

MIN_QUERY_CHARS = 3
MAX_QUERY_CHARS = 120
MAX_SUGGESTIONS = 5

# Each signed-in user may make this many address lookups in a window. Typing triggers several, so it is
# generous for normal use but stops one account running up the Google bill.
LIMIT_PER_WINDOW = 120
WINDOW_SECONDS = 600


def clean_query(raw: Optional[str]) -> Optional[str]:
    """The text to search for, or None when it is too short to be worth a Google call."""
    q = " ".join((raw or "").split())[:MAX_QUERY_CHARS]
    return q if len(q) >= MIN_QUERY_CHARS else None


def autocomplete_body(query: str) -> dict:
    return {
        "input": query,
        "includedRegionCodes": ["gb"],
        "languageCode": "en-GB",
    }


def parse_suggestions(body: dict) -> list:
    """[{place_id, text}] from a Places autocomplete response; drops anything without an id and text."""
    out = []
    for s in (body or {}).get("suggestions", []) or []:
        p = s.get("placePrediction") or {}
        pid = p.get("placeId")
        text = ((p.get("text") or {}).get("text") or "").strip()
        if pid and text:
            out.append({"place_id": pid, "text": text})
        if len(out) >= MAX_SUGGESTIONS:
            break
    return out


def parse_place(body: dict) -> Optional[dict]:
    """{address, postcode} from a Places details response. The address is without the postcode or country,
    because the app keeps the postcode in its own field."""
    if not body:
        return None
    full = (body.get("formattedAddress") or "").strip()
    postcode = ""
    for c in body.get("addressComponents", []) or []:
        if "postal_code" in (c.get("types") or []):
            postcode = (c.get("longText") or c.get("shortText") or "").strip().upper()
            break
    if not full:
        return None
    parts = [p.strip() for p in full.split(",") if p.strip()]
    if parts and parts[-1].lower() in ("uk", "united kingdom"):
        parts = parts[:-1]
    if postcode and parts and parts[-1].upper() == postcode:
        parts = parts[:-1]
    elif postcode and parts and parts[-1].upper().endswith(postcode):
        parts[-1] = parts[-1][: -len(postcode)].strip()
        if not parts[-1]:
            parts = parts[:-1]
    address = ", ".join(parts)
    return {"address": address, "postcode": postcode} if address else None


class UserLimiter:
    """Counts calls per user in a sliding window. In memory, which is enough for a single web process."""

    def __init__(self, limit: int = LIMIT_PER_WINDOW, window: int = WINDOW_SECONDS, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self._hits: dict = {}

    def allow(self, user_id: str) -> bool:
        now = self.clock()
        hits = [t for t in self._hits.get(user_id, []) if now - t < self.window]
        if len(hits) >= self.limit:
            self._hits[user_id] = hits
            return False
        hits.append(now)
        self._hits[user_id] = hits
        return True
