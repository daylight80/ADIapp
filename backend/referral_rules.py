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


# The referrer's free month is only given once the REFERRED school has stayed subscribed for a month,
# so someone who subscribes and cancels straight away doesn't earn it.
REFERRAL_REWARD_HOLD_DAYS = 30


def referral_reward_due_from(referred_school: Optional[dict]) -> Optional[datetime]:
    """When the referrer's reward is released, or None if the referred school isn't paying (yet)."""
    if not referred_school or referred_school.get("is_comp_account") or referred_school.get("subscription_status") != "active":
        return None
    since = _parse(referred_school.get("subscribed_since"))
    return since + timedelta(days=REFERRAL_REWARD_HOLD_DAYS) if since else None


def referral_reward_due(referred_school: Optional[dict], now: Optional[datetime] = None) -> bool:
    start = referral_reward_due_from(referred_school)
    return start is not None and (now or datetime.now(timezone.utc)) >= start


def referral_item(referred_school: dict) -> dict:
    """One line of the referrer's list: who, what stage, and the date that stage refers to.

    signed_up: created the account, not subscribed yet (date = sign-up)
    subscribed: paying, reward released on date
    rewarded / capped: settled (date = when)
    """
    status = referred_school.get("referral_reward_status")
    if status in ("rewarded", "capped"):
        stage, when = status, referred_school.get("referral_resolved_at")
    else:
        release = referral_reward_due_from(referred_school)
        if release:
            stage, when = "subscribed", release.isoformat()
        else:
            stage, when = "signed_up", referred_school.get("created_at")
    return {"name": (referred_school.get("business_name") or "A driving school").strip(), "stage": stage, "date": when}
