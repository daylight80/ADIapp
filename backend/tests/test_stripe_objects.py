"""Real stripe-python objects, not plain dicts. stripe-python 15 objects are no longer dicts (no .get()), so code that
reads them like dicts passes a test with fake dicts and then fails against Stripe. No network."""
import asyncio

import pytest
import stripe

import billing_helpers
import server


def _sub(status="active"):
    return stripe.Subscription.construct_from({
        "id": "sub_1", "object": "subscription", "status": status, "customer": "cus_1",
        "items": {"object": "list", "data": [
            {"id": "si_base", "object": "subscription_item", "quantity": 1, "current_period_end": 1_900_000_000,
             "price": {"id": "price_base", "object": "price"}},
            {"id": "si_seat", "object": "subscription_item", "quantity": 2, "current_period_end": 1_900_000_000,
             "price": {"id": "price_seat", "object": "price"}},
        ]},
    }, "sk_test_x")


@pytest.fixture(autouse=True)
def prices(monkeypatch):
    monkeypatch.setattr(server, "STRIPE_PRICE_PRO", "price_pro")
    monkeypatch.setattr(server, "STRIPE_PRICE_FRANCHISE_BASE", "price_base")
    monkeypatch.setattr(server, "STRIPE_PRICE_FRANCHISE_SEAT", "price_seat")


def test_plain_gives_dicts_with_get_and_leaves_plain_data_alone():
    p = billing_helpers.plain(_sub())
    assert p.get("status") == "active"
    assert p["items"]["data"][0]["price"]["id"] == "price_base"
    d = {"a": 1}
    assert billing_helpers.plain(d) is d


def test_tier_and_seats_are_read_from_a_real_subscription():
    sub = billing_helpers.plain(_sub())
    assert server._tier_from_subscription(sub) == "franchise"
    assert server._seat_qty_from_subscription(sub) == 3


def test_the_webhook_handles_real_stripe_objects(monkeypatch):
    sub = _sub()
    event = stripe.Event.construct_from({
        "id": "evt_1", "object": "event", "type": "customer.subscription.updated",
        "data": {"object": {"id": "sub_1", "object": "subscription", "customer": "cus_1", "status": "active"}},
    }, "sk_test_x")
    updates = []

    class Req:
        headers = {"Stripe-Signature": "sig"}

        async def body(self):
            return b"{}"

    async def school(_cid):
        return {"id": "school-1", "stripe_subscription_id": "sub_1", "tier": "pro"}

    async def update(school_id, patch):
        updates.append(patch)

    async def no_reward(_school):
        return None

    monkeypatch.setattr(server, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", staticmethod(lambda p, s, k: event))
    monkeypatch.setattr(server.stripe.Subscription, "retrieve", staticmethod(lambda sid, **kw: sub))
    monkeypatch.setattr(server, "sb_get_school_by_customer", school)
    monkeypatch.setattr(server, "sb_get_school_by_id", school)
    monkeypatch.setattr(server, "sb_update_school", update)
    monkeypatch.setattr(server, "_apply_referral_reward_if_due", no_reward)

    assert asyncio.run(server.stripe_webhook(Req()))["handled"] is True
    assert updates[0]["tier"] == "franchise"
    assert updates[0]["seat_count"] == 3
    assert updates[0]["subscription_status"] == "active"
    assert updates[0]["current_period_end"].startswith("2030-03-17")
