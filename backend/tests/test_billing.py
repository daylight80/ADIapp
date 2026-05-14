"""Billing (Stripe) endpoint tests for Freemium tier."""
import uuid
import pytest


def _login(api_client, base_url, email, password="password123"):
    r = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def instructor_token(api_client, base_url):
    return _login(api_client, base_url, "instructor@demo.uk")["access_token"]


@pytest.fixture
def student_token(api_client, base_url):
    return _login(api_client, base_url, "student@demo.uk")["access_token"]


@pytest.fixture
def instructor_user(api_client, base_url):
    return _login(api_client, base_url, "instructor@demo.uk")["user"]


# ---------- subscription_status in login/me responses ----------
class TestSubscriptionFieldInAuth:
    def test_login_includes_subscription_status(self, api_client, base_url):
        # Ensure demo user is free (cancel any pre-existing pro from previous tests)
        login_r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "instructor@demo.uk", "password": "password123"},
        )
        token = login_r.json()["access_token"]
        api_client.post(
            f"{base_url}/api/billing/cancel-mock",
            headers={"Authorization": f"Bearer {token}"},
        )

        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "instructor@demo.uk", "password": "password123"},
        )
        assert r.status_code == 200
        user = r.json()["user"]
        assert "subscription_status" in user
        assert user["subscription_status"] == "free"

    def test_login_student_subscription_status(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "student@demo.uk", "password": "password123"},
        )
        assert r.status_code == 200
        user = r.json()["user"]
        assert user.get("subscription_status") == "free"

    def test_me_includes_subscription_status(self, api_client, base_url, instructor_token):
        r = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": f"Bearer {instructor_token}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert "subscription_status" in body
        assert body["subscription_status"] in ("free", "pro", "past_due", "canceled")


# ---------- /api/billing/subscription-status ----------
class TestSubscriptionStatusEndpoint:
    def test_returns_status_for_authed_user(self, api_client, base_url, instructor_token):
        # Reset to free first
        api_client.post(
            f"{base_url}/api/billing/cancel-mock",
            headers={"Authorization": f"Bearer {instructor_token}"},
        )
        r = api_client.get(
            f"{base_url}/api/billing/subscription-status",
            headers={"Authorization": f"Bearer {instructor_token}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["subscription_status"] == "free"
        assert "stripe_customer_id" in body

    def test_requires_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/billing/subscription-status")
        assert r.status_code == 401


# ---------- /api/billing/create-checkout-session ----------
class TestCreateCheckoutSession:
    def test_unauth_returns_401(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/billing/create-checkout-session", json={})
        assert r.status_code == 401

    def test_student_forbidden(self, api_client, base_url, student_token):
        r = api_client.post(
            f"{base_url}/api/billing/create-checkout-session",
            headers={"Authorization": f"Bearer {student_token}"},
            json={},
        )
        assert r.status_code == 403

    def test_instructor_gets_stripe_url(self, api_client, base_url, instructor_token):
        # Ensure free first
        api_client.post(
            f"{base_url}/api/billing/cancel-mock",
            headers={"Authorization": f"Bearer {instructor_token}"},
        )
        r = api_client.post(
            f"{base_url}/api/billing/create-checkout-session",
            headers={"Authorization": f"Bearer {instructor_token}"},
            json={},
        )
        assert r.status_code == 200, r.text
        url = r.json().get("url", "")
        assert "stripe.com" in url, f"Expected stripe URL, got: {url}"


# ---------- /api/billing/cancel-mock ----------
class TestCancelMock:
    def test_cancel_resets_to_free(self, api_client, base_url, instructor_token):
        r = api_client.post(
            f"{base_url}/api/billing/cancel-mock",
            headers={"Authorization": f"Bearer {instructor_token}"},
        )
        assert r.status_code == 200
        assert r.json()["subscription_status"] == "free"

        # Verify via subscription-status endpoint
        s = api_client.get(
            f"{base_url}/api/billing/subscription-status",
            headers={"Authorization": f"Bearer {instructor_token}"},
        )
        assert s.json()["subscription_status"] == "free"

    def test_requires_auth(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/billing/cancel-mock")
        assert r.status_code == 401


# ---------- /api/billing/webhook ----------
class TestWebhook:
    def test_webhook_promotes_user_to_pro(self, api_client, base_url):
        # Register a new instructor specifically for this test
        suffix = uuid.uuid4().hex[:8]
        email = f"TEST_webhook_{suffix}@example.com"
        reg = api_client.post(
            f"{base_url}/api/auth/register",
            json={
                "email": email,
                "password": "secret123",
                "name": f"TEST Webhook {suffix}",
                "role": "instructor",
            },
        )
        assert reg.status_code == 200
        new_user = reg.json()["user"]
        token = reg.json()["access_token"]
        user_id = new_user["id"]
        assert new_user["subscription_status"] == "free"

        # Send a synthetic checkout.session.completed event
        event = {
            "id": f"evt_test_{suffix}",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": f"cs_test_{suffix}",
                    "client_reference_id": user_id,
                    "subscription": f"sub_test_{suffix}",
                    "customer": f"cus_test_{suffix}",
                    "metadata": {"user_id": user_id},
                }
            },
        }
        r = api_client.post(f"{base_url}/api/billing/webhook", json=event)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "received"

        # Confirm via /me
        me = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me.status_code == 200
        assert me.json()["subscription_status"] == "pro"

        # Cleanup: revert to free
        api_client.post(
            f"{base_url}/api/billing/cancel-mock",
            headers={"Authorization": f"Bearer {token}"},
        )

    def test_webhook_unknown_event_ok(self, api_client, base_url):
        event = {
            "id": "evt_test_x",
            "type": "customer.created",
            "data": {"object": {}},
        }
        r = api_client.post(f"{base_url}/api/billing/webhook", json=event)
        assert r.status_code == 200
