"""A referral reward is one free month, paid once. Two webhook deliveries arriving together, or a retry after a failed
write, must not credit the referrer twice. Runs against a fake database and a fake Stripe. No network."""
import asyncio

import pytest

import server


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, ""

    def json(self):
        return self._rows


class FakeDb:
    """One referred school whose reward is pending. The conditional PATCH is atomic, like Postgres."""

    def __init__(self):
        self.status = "pending"
        self.resolved_at = None
        self.credits = []
        self.fail_stripe_once = False

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, headers=None):
        if url.endswith("/instructors"):
            return Resp([{"id": "ref-1", "school_id": "referrer-school"}])
        return Resp([])  # cap check: nobody rewarded yet

    async def patch(self, url, params=None, headers=None, json=None):
        if params.get("referral_reward_status") == "eq.pending" and self.status != "pending":
            return Resp([])
        self.status = json["referral_reward_status"]
        self.resolved_at = json["referral_resolved_at"]
        return Resp([{"id": "new-school"}])


@pytest.fixture
def world(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(server.httpx, "AsyncClient", db)
    monkeypatch.setattr(server, "SUPABASE_SERVICE_ROLE_KEY", "service-test")
    monkeypatch.setattr(server, "referral_reward_due", lambda s: True)
    monkeypatch.setattr(server, "tier_to_line_items", lambda tier: [{"price": "price_pro"}])

    async def referrer(_id):
        return {"id": "referrer-school", "tier": "pro", "stripe_customer_id": "cus_ref", "business_name": "Ref"}

    async def update(school_id, patch):
        db.status = patch.get("referral_reward_status", db.status)
        db.resolved_at = patch.get("referral_resolved_at", db.resolved_at)
        return {}

    def credit(customer, **kw):
        if db.fail_stripe_once:
            db.fail_stripe_once = False
            raise RuntimeError("stripe down")
        db.credits.append((customer, kw))

    monkeypatch.setattr(server, "sb_get_school_by_id", referrer)
    monkeypatch.setattr(server, "sb_update_school", update)
    monkeypatch.setattr(server.stripe.Price, "retrieve", staticmethod(lambda pid: {"unit_amount": 3000}))
    monkeypatch.setattr(server.stripe.Customer, "create_balance_transaction", staticmethod(credit))
    return db


def stale_school():
    # Both deliveries were handed the same row, read while the reward was still pending.
    return {"id": "new-school", "referred_by_instructor_id": "ref-1", "referral_reward_status": "pending"}


def test_two_deliveries_at_once_credit_the_referrer_once(world):
    async def both():
        await asyncio.gather(server._apply_referral_reward_if_due(stale_school()),
                             server._apply_referral_reward_if_due(stale_school()))

    asyncio.run(both())
    assert len(world.credits) == 1
    assert world.status == "rewarded"


def test_a_failed_credit_gives_the_claim_back_and_the_retry_pays_once(world):
    world.fail_stripe_once = True
    with pytest.raises(RuntimeError):
        asyncio.run(server._apply_referral_reward_if_due(stale_school()))
    assert world.status == "pending" and world.credits == []
    asyncio.run(server._apply_referral_reward_if_due(stale_school()))
    assert len(world.credits) == 1 and world.status == "rewarded"


def test_the_credit_carries_an_idempotency_key(world):
    asyncio.run(server._apply_referral_reward_if_due(stale_school()))
    assert world.credits[0][1]["idempotency_key"] == "referral-reward-new-school"
    assert world.credits[0][1]["amount"] == -3000
