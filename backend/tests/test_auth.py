"""Auth endpoint tests for UK Driving Portal."""
import uuid
import pytest


# ---------- /api/health & root ----------
class TestHealth:
    def test_health_endpoint(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/health")
        assert r.status_code == 200
        assert r.json().get("status") == "healthy"

    def test_root_endpoint(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"


# ---------- /api/auth/login ----------
class TestLogin:
    def test_login_demo_instructor(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "instructor@demo.uk", "password": "password123"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data and len(data["access_token"]) > 20
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == "instructor@demo.uk"
        assert data["user"]["role"] == "instructor"
        assert "id" in data["user"]

    def test_login_demo_student(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "student@demo.uk", "password": "password123"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "student"
        assert data["user"]["email"] == "student@demo.uk"

    def test_login_email_case_insensitive(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "Instructor@Demo.UK", "password": "password123"},
        )
        assert r.status_code == 200

    def test_login_invalid_password(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "instructor@demo.uk", "password": "wrongpass"},
        )
        assert r.status_code == 401

    def test_login_unknown_user(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "nobody@demo.uk", "password": "password123"},
        )
        assert r.status_code == 401

    def test_login_missing_fields(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/auth/login", json={"email": "a@b.co"})
        assert r.status_code == 422


# ---------- /api/auth/me ----------
class TestMe:
    def test_me_with_valid_token(self, api_client, base_url):
        login = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": "instructor@demo.uk", "password": "password123"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        r = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == "instructor@demo.uk"
        assert body["role"] == "instructor"
        # ensure no Mongo _id leaked
        assert "_id" not in body
        assert "password" not in body

    def test_me_without_token(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": "Bearer not-a-real-token"},
        )
        assert r.status_code == 401

    def test_me_bad_scheme(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": "Token abc"},
        )
        assert r.status_code == 401


# ---------- /api/auth/register ----------
class TestRegister:
    def _payload(self, role="student"):
        suffix = uuid.uuid4().hex[:8]
        return {
            "email": f"TEST_user_{suffix}@example.com",
            "password": "secret123",
            "name": f"TEST User {suffix}",
            "role": role,
        }

    def test_register_student(self, api_client, base_url):
        payload = self._payload("student")
        r = api_client.post(f"{base_url}/api/auth/register", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["email"] == payload["email"].lower()
        assert data["user"]["role"] == "student"
        assert data["user"]["name"] == payload["name"]
        token = data["access_token"]

        # verify token works with /me
        me = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me.status_code == 200
        assert me.json()["email"] == payload["email"].lower()

    def test_register_instructor(self, api_client, base_url):
        payload = self._payload("instructor")
        r = api_client.post(f"{base_url}/api/auth/register", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "instructor"

    def test_register_duplicate_email(self, api_client, base_url):
        payload = self._payload("student")
        r1 = api_client.post(f"{base_url}/api/auth/register", json=payload)
        assert r1.status_code == 200
        r2 = api_client.post(f"{base_url}/api/auth/register", json=payload)
        assert r2.status_code == 400

    def test_register_short_password(self, api_client, base_url):
        payload = self._payload("student")
        payload["password"] = "abc"
        r = api_client.post(f"{base_url}/api/auth/register", json=payload)
        assert r.status_code == 422

    def test_register_invalid_role(self, api_client, base_url):
        payload = self._payload("student")
        payload["role"] = "admin"
        r = api_client.post(f"{base_url}/api/auth/register", json=payload)
        assert r.status_code == 422

    def test_register_then_login(self, api_client, base_url):
        payload = self._payload("instructor")
        r = api_client.post(f"{base_url}/api/auth/register", json=payload)
        assert r.status_code == 200
        login = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": payload["email"], "password": payload["password"]},
        )
        assert login.status_code == 200
        assert login.json()["user"]["email"] == payload["email"].lower()
