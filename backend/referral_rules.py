"""Who may refer other instructors. Kept apart from server.py so it can be tested without the web app."""
from datetime import datetime, timedelta, timezone
from typing import Optional

# Grant, 14 Oct 2026: the referral banner only appears once the school has been subscribed for a month.
REFERRAL_MIN_SUBSCRIBED_DAYS = 30


def _parse(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def referral_eligible_from(school: Optional[dict]) -> Optional[datetime]:
    """The moment this school may start referring, or None if it never can (no paid plan)."""
    if not school or school.get("is_comp_account") or school.get("subscription_status") != "active":
        return None
    since = _parse(school.get("subscribed_since"))
    if since is None:
        return None
    return since + timedelta(days=REFERRAL_MIN_SUBSCRIBED_DAYS)


def referral_eligible(school: Optional[dict], now: Optional[datetime] = None) -> bool:
    start = referral_eligible_from(school)
    return start is not None and (now or datetime.now(timezone.utc)) >= start
