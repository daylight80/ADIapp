"""Stripe does not promise to deliver events in order. A late event must not undo what the school has now.
Run against a fake database and a fake Stripe. No network."""
import asyncio

import pytest

import server


class FakeRequest:
    headers = {"Stripe-Signature": "sig"}

    async def body(self):
        return b"{}"


@pytest.fixture
def stripe_world(monkeypatch):
    w = {"school": {"id": "school-1", "stripe_subscription_id": "sub_new", "tier": "pro"},
         "event": None, "live": {}, "updates": []}

    monkeypatch.setattr(server, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", staticmethod(lambda p, s, k: w["event"]))
    monkeypatch.setattr(server.stripe.Subscription, "retrieve", staticmethod(lambda sid, **kw: w["live"]))

    async def by_customer(_cid):
        return w["school"]

    async def update(school_id, patch):
        w["updates"].append(patch)
        return {}

    async def no_reward(_school):
        return None

    monkeypatch.setattr(server, "sb_get_school_by_customer", by_customer)
    monkeypatch.setattr(server, "sb_get_school_by_id", by_customer)
    monkeypatch.setattr(server, "sb_update_school", update)
    monkeypatch.setattr(server, "_apply_referral_reward_if_due", no_reward)
    monkeypatch.setattr(server, "_tier_from_subscription", lambda sub: "pro")
    monkeypatch.setattr(server, "_seat_qty_from_subscription", lambda sub: 1)
    monkeypatch.setattr(server.billing_helpers, "period_end_iso", lambda sub: None)
    return w


def send(w, etype, body):
    w["event"] = {"type": etype, "data": {"object": body}}
    return asyncio.run(server.stripe_webhook(FakeRequest()))


def test_a_late_cancellation_of_an_old_subscription_does_not_undo_the_new_one(stripe_world):
    send(stripe_world, "customer.subscription.deleted", {"id": "sub_old", "customer": "cus_1"})
    assert stripe_world["updates"] == []


def test_cancellation_of_the_current_subscription_still_works(stripe_world):
    send(stripe_world, "customer.subscription.deleted", {"id": "sub_new", "customer": "cus_1"})
    assert stripe_world["updates"][0]["tier"] == "starter"


def test_a_stale_update_does_not_reactivate_a_subscription_that_is_now_cancelled(stripe_world):
    stripe_world["live"] = {"id": "sub_new", "status": "canceled"}
    send(stripe_world, "customer.subscription.updated", {"id": "sub_new", "customer": "cus_1", "status": "active"})
    assert stripe_world["updates"][0]["tier"] == "starter"
    assert stripe_world["updates"][0]["subscription_status"] == "cancelled"


def test_an_update_applies_the_current_state_not_the_state_in_the_event(stripe_world):
    stripe_world["live"] = {"id": "sub_new", "status": "past_due"}
    send(stripe_world, "customer.subscription.updated", {"id": "sub_new", "customer": "cus_1", "status": "active"})
    assert stripe_world["updates"][0]["subscription_status"] == "past_due"
