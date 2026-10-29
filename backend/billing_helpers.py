"""Small pure helpers for reading Stripe subscriptions. Kept apart from server.py so they can be tested offline.

Stripe's newer API versions (from 2025-03-31, "basil") moved the billing period from the subscription to each
subscription item, so `sub["current_period_end"]` is missing on a subscription fetched with a current
stripe-python. Older API versions, which a webhook endpoint may still use, keep it on the subscription. Read both."""
from datetime import datetime, timezone
from typing import Any, Optional


def plain(obj: Any) -> Any:
    """A Stripe object as plain dicts and lists. stripe-python 15 objects are no longer dicts (no .get() or .items()),
    while 13 ones are, so reading them through this works the same on both. Anything already plain comes back as is."""
    for name in ("to_dict", "to_dict_recursive"):
        fn = getattr(obj, name, None)
        if callable(fn):
            return fn()
    return obj


def _get(obj: Any, key: str) -> Any:
    try:
        return obj.get(key)
    except AttributeError:
        try:
            return obj[key]
        except (KeyError, TypeError):
            return None


def period_end_timestamp(sub: Any) -> Optional[int]:
    """Unix time the current billing period ends, or None when Stripe gave no usable value."""
    top = _get(sub, "current_period_end")
    if isinstance(top, (int, float)) and top > 0:
        return int(top)
    items = _get(_get(sub, "items") or {}, "data") or []
    ends = []
    for item in items:
        v = _get(item, "current_period_end")
        if isinstance(v, (int, float)) and v > 0:
            ends.append(int(v))
    # Items normally share one cycle; if they differ, the subscription renews at the earliest end.
    return min(ends) if ends else None


def period_end_iso(sub: Any) -> Optional[str]:
    ts = period_end_timestamp(sub)
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None
