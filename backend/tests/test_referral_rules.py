from datetime import datetime, timedelta, timezone

from referral_rules import (
    REFERRAL_MIN_SUBSCRIBED_DAYS, REFERRAL_REWARD_HOLD_DAYS, REFERRER_TIERS, referral_eligible, referral_eligible_from,
    referral_item, referral_reward_due, referral_reward_due_from, tier_may_refer,
)

NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def school(days_ago, **over):
    base = {"subscription_status": "active", "is_comp_account": False, "tier": "pro", "owner_auth_id": "owner-1",
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


def test_only_dc_pro_can_refer():
    """Grant, 29 Oct 2026: for now Franchise schools (and their instructors) and Starter cannot refer."""
    assert REFERRER_TIERS == {"pro"}
    assert tier_may_refer(school(200)) and tier_may_refer(school(200, tier="PRO"))
    for tier in ("franchise", "starter", "growth", None, ""):
        assert not referral_eligible(school(200, tier=tier), NOW), tier
        assert referral_eligible_from(school(200, tier=tier)) is None, tier
    assert not tier_may_refer(None)


def test_an_instructor_linked_to_someone_elses_school_cannot_refer():
    pro = school(200)
    assert referral_eligible(pro, NOW, auth_user_id="owner-1")
    assert not referral_eligible(pro, NOW, auth_user_id="sub-instructor-9")
    assert referral_eligible_from(pro, "sub-instructor-9") is None
    # a Franchise owner is still not allowed: the plan decides first
    assert not referral_eligible(school(200, tier="franchise"), NOW, auth_user_id="owner-1")


def test_says_when_it_opens():
    start = referral_eligible_from(school(10))
    assert start == NOW - timedelta(days=10) + timedelta(days=30)
    assert referral_eligible_from(school(10, subscribed_since=None)) is None


def test_reward_is_held_until_the_referred_school_has_paid_for_a_month():
    assert REFERRAL_REWARD_HOLD_DAYS == 30
    assert not referral_reward_due(school(1), NOW)
    assert not referral_reward_due(school(29), NOW)
    assert referral_reward_due(school(30), NOW)
    # Cancelled (or never paid) before the month is up: nothing to release.
    assert not referral_reward_due(school(45, subscription_status="cancelled"), NOW)
    assert not referral_reward_due(school(45, subscribed_since=None), NOW)
    assert not referral_reward_due(school(45, is_comp_account=True), NOW)
    assert referral_reward_due_from(school(10)) == NOW - timedelta(days=10) + timedelta(days=30)


def test_referral_list_stages():
    base = {"business_name": "  Pat's Driving  ", "created_at": "2026-10-01T09:00:00+00:00"}
    signed_up = referral_item({**base, "referral_reward_status": "pending", "subscription_status": "free"})
    assert signed_up == {"name": "Pat's Driving", "stage": "signed_up", "date": "2026-10-01T09:00:00+00:00"}

    paying = referral_item({**base, "referral_reward_status": "pending", **school(5)})
    assert paying["stage"] == "subscribed"
    assert paying["date"] == (NOW - timedelta(days=5) + timedelta(days=30)).isoformat()

    done = referral_item({**base, "referral_reward_status": "rewarded", "referral_resolved_at": "2026-11-05T00:00:00+00:00"})
    assert (done["stage"], done["date"]) == ("rewarded", "2026-11-05T00:00:00+00:00")
    assert referral_item({**base, "referral_reward_status": "capped"})["stage"] == "capped"
    assert referral_item({"referral_reward_status": "pending"})["name"] == "A driving school"


def test_reads_z_suffix_and_naive_timestamps():
    assert referral_eligible(school(40, subscribed_since="2026-08-01T00:00:00Z"), NOW)
    assert referral_eligible(school(40, subscribed_since="2026-08-01T00:00:00"), NOW)
    assert not referral_eligible(school(40, subscribed_since="not a date"), NOW)
