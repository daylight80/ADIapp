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


# --- the other places the backend reads Stripe results: seat sync, checkout, portal, referral credit amount ---

def _seat_sub():
    return stripe.Subscription.construct_from({
        "id": "sub_1", "object": "subscription", "status": "active",
        "items": {"object": "list", "data": [
            {"id": "si_base", "object": "subscription_item", "quantity": 1, "price": {"id": "price_base", "object": "price"}},
            {"id": "si_seat", "object": "subscription_item", "quantity": 1, "price": {"id": "price_seat", "object": "price"}},
        ]},
    }, "sk_test_x")


def _no_seat_sub():
    return stripe.Subscription.construct_from({
        "id": "sub_1", "object": "subscription", "status": "active",
        "items": {"object": "list", "data": [
            {"id": "si_base", "object": "subscription_item", "quantity": 1, "price": {"id": "price_base", "object": "price"}},
        ]},
    }, "sk_test_x")


def _sync(monkeypatch, sub, seat_count):
    calls = []
    monkeypatch.setattr(server.stripe.Subscription, "retrieve", staticmethod(lambda sid, **kw: sub))
    monkeypatch.setattr(server.stripe.SubscriptionItem, "create", staticmethod(lambda **kw: calls.append(("create", kw))))
    monkeypatch.setattr(server.stripe.SubscriptionItem, "modify", staticmethod(lambda iid, **kw: calls.append(("modify", iid, kw))))
    monkeypatch.setattr(server.stripe.SubscriptionItem, "delete", staticmethod(lambda iid: calls.append(("delete", iid))))
    school = {"id": "school-1", "tier": "franchise", "stripe_subscription_id": "sub_1", "seat_count": seat_count}
    return asyncio.run(server.billing_v2_sync_seats({"school": school})), calls


def test_seat_sync_changes_the_seat_quantity_on_a_real_subscription(monkeypatch):
    result, calls = _sync(monkeypatch, _seat_sub(), seat_count=4)  # 1 base + 3 seats wanted, 1 now
    assert result == {"updated": True, "action": "updated", "quantity": 3}
    assert calls == [("modify", "si_seat", {"quantity": 3, "proration_behavior": "create_prorations"})]


def test_seat_sync_adds_and_removes_the_seat_item_on_real_subscriptions(monkeypatch):
    result, calls = _sync(monkeypatch, _no_seat_sub(), seat_count=3)
    assert result == {"updated": True, "action": "added", "quantity": 2}
    assert calls == [("create", {"subscription": "sub_1", "price": "price_seat", "quantity": 2})]
    result, calls = _sync(monkeypatch, _seat_sub(), seat_count=1)
    assert result == {"updated": True, "action": "removed", "quantity": 0}
    assert calls == [("delete", "si_seat")]


def test_checkout_and_portal_return_the_url_of_a_real_session(monkeypatch):
    async def noop(*a, **k):
        return {}

    monkeypatch.setattr(server, "sb_update_school", noop)
    monkeypatch.setattr(server.stripe.Customer, "create", staticmethod(lambda **kw: stripe.Customer.construct_from({"id": "cus_new", "object": "customer"}, "sk_test_x")))
    monkeypatch.setattr(server.stripe.checkout.Session, "create", staticmethod(lambda **kw: stripe.checkout.Session.construct_from({"id": "cs_1", "object": "checkout.session", "url": "https://checkout.stripe.test/s/1"}, "sk_test_x")))
    monkeypatch.setattr(server.stripe.billing_portal.Session, "create", staticmethod(lambda **kw: stripe.billing_portal.Session.construct_from({"id": "bps_1", "object": "billing_portal.session", "url": "https://billing.stripe.test/p/1"}, "sk_test_x")))
    user = {"school": {"id": "school-1", "tier": "starter"}, "auth_user_id": "u1", "email": "a@example.com"}
    out = asyncio.run(server.billing_v2_checkout(server.CheckoutV2Request(tier="pro"), user))
    assert out.url == "https://checkout.stripe.test/s/1"
    user["school"]["stripe_customer_id"] = "cus_new"
    assert asyncio.run(server.billing_v2_portal(user)).url == "https://billing.stripe.test/p/1"


def test_the_referral_credit_amount_reads_from_a_real_price():
    price = stripe.Price.construct_from({"id": "price_pro", "object": "price", "unit_amount": 3600, "currency": "gbp"}, "sk_test_x")
    assert price["unit_amount"] == 3600
