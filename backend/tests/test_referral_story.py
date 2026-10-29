"""The whole referral story in one place, against an in-memory database and a fake Stripe. No network.
Referrer (DC Pro) -> referred schools sign up -> subscribe -> held 30 days -> one free month each, 2 a year, none if the
referrer is no longer on DC Pro. The pieces are tested alone elsewhere; this checks they work together in order."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import server
from referral_rules import referral_eligible, referral_item

NOW = datetime.now(timezone.utc)


def days_ago(n):
    return (NOW - timedelta(days=n)).isoformat()


class Resp:
    def __init__(self, rows):
        self._rows, self.status_code, self.text = rows, 200, ""

    def json(self):
        return self._rows


class Db:
    """schools keyed by id; instructors keyed by id. Understands the few eq./gte. filters the reward code uses."""

    def __init__(self):
        self.schools = {}
        self.instructors = {"ref-1": {"id": "ref-1", "school_id": "referrer-school"}}
        self.credits = []

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def _match(self, row, params):
        for k, v in params.items():
            if k in ("select", "order"):
                continue
            if v.startswith("eq.") and str(row.get(k)) != v[3:]:
                return False
            if v.startswith("gte.") and not (row.get(k) or "") >= v[4:]:
                return False
        return True

    async def get(self, url, params=None, headers=None):
        table = self.instructors if url.endswith("/instructors") else self.schools
        return Resp([r for r in table.values() if self._match(r, params or {})])

    async def patch(self, url, params=None, headers=None, json=None):
        rows = [r for r in self.schools.values() if self._match(r, params)]
        for r in rows:
            r.update(json)
        return Resp(rows)


@pytest.fixture
def world(monkeypatch):
    db = Db()
    db.schools["referrer-school"] = {"id": "referrer-school", "tier": "pro", "stripe_customer_id": "cus_ref",
                                     "business_name": "Referrer", "subscription_status": "active", "owner_auth_id": "u-ref",
                                     "subscribed_since": days_ago(200)}

    async def get_school(sid):
        return db.schools.get(sid)

    async def update(sid, patch):
        db.schools[sid].update(patch)
        return {}

    monkeypatch.setattr(server.httpx, "AsyncClient", db)
    monkeypatch.setattr(server, "SUPABASE_SERVICE_ROLE_KEY", "service-test")
    monkeypatch.setattr(server, "sb_get_school_by_id", get_school)
    monkeypatch.setattr(server, "sb_update_school", update)
    monkeypatch.setattr(server, "tier_to_line_items", lambda tier: [{"price": "price_pro"}])
    monkeypatch.setattr(server.stripe.Price, "retrieve", staticmethod(lambda pid: {"unit_amount": 1199}))
    monkeypatch.setattr(server.stripe.Customer, "create_balance_transaction",
                        staticmethod(lambda cust, **kw: db.credits.append((cust, kw["amount"], kw["idempotency_key"]))))
    return db


def refer(db, sid, subscribed_days=None):
    """A school signs up with the referrer's code, and optionally subscribed N days ago."""
    school = {"id": sid, "business_name": sid, "referred_by_instructor_id": "ref-1", "referral_reward_status": "pending",
              "subscription_status": "free", "created_at": days_ago(40)}
    if subscribed_days is not None:
        school.update(subscription_status="active", subscribed_since=days_ago(subscribed_days))
    db.schools[sid] = school
    return school


def renewal(sid):
    """What the webhook does after a subscription update or renewal."""
    school = server.httpx.AsyncClient.schools[sid]
    asyncio.run(server._apply_referral_reward_if_due(dict(school)))


def test_referrer_is_eligible_only_as_a_dc_pro_owner_after_a_month(world):
    ref = world.schools["referrer-school"]
    assert referral_eligible(ref, auth_user_id="u-ref")
    assert not referral_eligible(ref, auth_user_id="someone-else")
    assert not referral_eligible({**ref, "subscribed_since": days_ago(10)}, auth_user_id="u-ref")
    assert not referral_eligible({**ref, "tier": "franchise"}, auth_user_id="u-ref")


def test_signed_up_then_held_then_rewarded_once(world):
    refer(world, "new-1")
    assert referral_item(world.schools["new-1"])["stage"] == "signed_up"

    renewal("new-1")  # not subscribed yet
    assert world.credits == []

    world.schools["new-1"].update(subscription_status="active", subscribed_since=days_ago(10))
    assert referral_item(world.schools["new-1"])["stage"] == "subscribed"
    renewal("new-1")  # day 10: held
    assert world.credits == [] and world.schools["new-1"]["referral_reward_status"] == "pending"

    world.schools["new-1"]["subscribed_since"] = days_ago(31)
    renewal("new-1")  # day 31: released
    assert world.credits == [("cus_ref", -1199, "referral-reward-new-1")]
    assert world.schools["new-1"]["referral_reward_status"] == "rewarded"
    assert referral_item(world.schools["new-1"])["stage"] == "rewarded"

    renewal("new-1")  # the next renewal must not pay again
    assert len(world.credits) == 1


def test_a_school_that_cancels_inside_the_month_earns_nothing(world):
    refer(world, "new-1", subscribed_days=10)
    world.schools["new-1"]["subscription_status"] = "cancelled"
    renewal("new-1")
    assert world.credits == [] and world.schools["new-1"]["referral_reward_status"] == "pending"


def test_the_third_referral_in_a_year_is_capped(world):
    for sid in ("a", "b", "c"):
        refer(world, sid, subscribed_days=31)
        renewal(sid)
    assert [c[2] for c in world.credits] == ["referral-reward-a", "referral-reward-b"]
    assert [world.schools[s]["referral_reward_status"] for s in "abc"] == ["rewarded", "rewarded", "capped"]


def test_a_referrer_who_dropped_to_starter_earns_nothing(world):
    world.schools["referrer-school"]["tier"] = "starter"
    refer(world, "new-1", subscribed_days=31)
    renewal("new-1")
    assert world.credits == [] and world.schools["new-1"]["referral_reward_status"] == "capped"
