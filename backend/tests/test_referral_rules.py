from datetime import datetime, timedelta, timezone

from referral_rules import REFERRAL_MIN_SUBSCRIBED_DAYS, referral_eligible, referral_eligible_from

NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def school(days_ago, **over):
    base = {"subscription_status": "active", "is_comp_account": False,
            "subscribed_since": (NOW - timedelta(days=days_ago)).isoformat()}
    base.update(over)
    return base


def test_needs_a_month_of_subscription():
    assert REFERRAL_MIN_SUBSCRIBED_DAYS == 30
    assert not referral_eligible(school(0), NOW)
    assert not referral_eligible(school(29), NOW)
    assert referral_eligible(school(30), NOW)
    assert referral_eligible(school(200), NOW)


def test_never_for_schools_without_a_paid_plan():
    assert not referral_eligible(school(200, subscription_status="cancelled"), NOW)
    assert not referral_eligible(school(200, subscription_status="free"), NOW)
    assert not referral_eligible(school(200, is_comp_account=True), NOW)
    assert not referral_eligible(school(200, subscribed_since=None), NOW)
    assert not referral_eligible(None, NOW)


def test_says_when_it_opens():
    start = referral_eligible_from(school(10))
    assert start == NOW - timedelta(days=10) + timedelta(days=30)
    assert referral_eligible_from(school(10, subscribed_since=None)) is None


def test_reads_z_suffix_and_naive_timestamps():
    assert referral_eligible(school(40, subscribed_since="2026-08-01T00:00:00Z"), NOW)
    assert referral_eligible(school(40, subscribed_since="2026-08-01T00:00:00"), NOW)
    assert not referral_eligible(school(40, subscribed_since="not a date"), NOW)
