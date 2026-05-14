"""Backend tests: instructor signup w/ ADI + student invite flow."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _unique(prefix="user"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}"


# ---------- Demo users ----------
class TestDemoUsers:
    def test_demo_instructor_login(self, s):
        r = s.post(f"{API}/auth/login", json={"email": "instructor@demo.uk", "password": "password123"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["role"] == "instructor"
        assert body["user"]["adi_number"] == "123456"
        assert "access_token" in body

    def test_demo_student_login(self, s):
        r = s.post(f"{API}/auth/login", json={"email": "student@demo.uk", "password": "password123"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["role"] == "student"
        assert body["user"]["invited_by_adi"] == "123456"


# ---------- Instructor register ----------
class TestInstructorRegister:
    def test_register_with_adi(self, s):
        email = f"{_unique('inst')}@example.com"
        adi = str(700000 + int(time.time()) % 200000)
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": "password123", "name": "TEST Inst", "adi_number": adi,
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["role"] == "instructor"
        assert body["user"]["adi_number"] == adi
        assert body["user"]["email"] == email.lower()
        assert "access_token" in body

        # GET /auth/me to verify persistence
        me = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
        assert me.status_code == 200
        assert me.json()["adi_number"] == adi

    def test_register_missing_adi_returns_422(self, s):
        r = s.post(f"{API}/auth/register", json={
            "email": f"{_unique('noadi')}@example.com", "password": "password123", "name": "X",
        })
        assert r.status_code == 422, r.text

    def test_register_duplicate_adi_returns_400(self, s):
        adi = str(800000 + int(time.time()) % 100000)
        e1 = f"{_unique('a')}@example.com"
        e2 = f"{_unique('b')}@example.com"
        r1 = s.post(f"{API}/auth/register", json={"email": e1, "password": "password123", "name": "A", "adi_number": adi})
        assert r1.status_code == 200, r1.text
        r2 = s.post(f"{API}/auth/register", json={"email": e2, "password": "password123", "name": "B", "adi_number": adi})
        assert r2.status_code == 400
        # Accept any message mentioning ADI duplicate
        detail = r2.json().get("detail", "").lower()
        assert "adi" in detail and ("already" in detail or "exists" in detail)

    def test_register_with_role_field_still_creates_instructor(self, s):
        """Extra role field should be ignored — user becomes instructor (not student)."""
        email = f"{_unique('roley')}@example.com"
        adi = str(900000 + int(time.time()) % 90000)
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": "password123", "name": "Roley", "adi_number": adi,
            "role": "student",
        })
        # Acceptable: 200 with role=instructor OR 422
        assert r.status_code in (200, 422), r.text
        if r.status_code == 200:
            assert r.json()["user"]["role"] == "instructor"


# ---------- Invite flow ----------
@pytest.fixture(scope="class")
def instructor_token(s):
    r = s.post(f"{API}/auth/login", json={"email": "instructor@demo.uk", "password": "password123"})
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest.fixture(scope="class")
def student_token(s):
    r = s.post(f"{API}/auth/login", json={"email": "student@demo.uk", "password": "password123"})
    assert r.status_code == 200
    return r.json()["access_token"]


class TestInviteFlow:
    def test_invite_without_auth_401(self, s):
        r = s.post(f"{API}/instructor/invite-student", json={"email": "x@y.com", "name": "X"})
        assert r.status_code == 401

    def test_invite_with_student_role_403(self, s, student_token):
        r = s.post(
            f"{API}/instructor/invite-student",
            json={"email": "x@y.com", "name": "X"},
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert r.status_code == 403

    def test_invite_existing_email_400(self, s, instructor_token):
        r = s.post(
            f"{API}/instructor/invite-student",
            json={"email": "student@demo.uk", "name": "Already"},
            headers={"Authorization": f"Bearer {instructor_token}"},
        )
        assert r.status_code == 400

    def test_invite_success_and_preview_and_accept(self, s, instructor_token):
        email = f"{_unique('invitee')}@example.com"
        name = "TEST Invitee"
        r = s.post(
            f"{API}/instructor/invite-student",
            json={"email": email, "name": name, "phone": "07700900111"},
            headers={"Authorization": f"Bearer {instructor_token}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "invite_token" in body
        assert "invite_url" in body and "?invite=" in body["invite_url"]
        assert "expires_at" in body
        token = body["invite_token"]

        # preview
        pr = s.get(f"{API}/auth/invite/{token}")
        assert pr.status_code == 200, pr.text
        pj = pr.json()
        assert pj["email"] == email.lower()
        assert pj["name"] == name
        assert pj["instructor_name"] == "Alex Thompson"
        assert pj["instructor_adi"] == "123456"
        assert "expires_at" in pj

        # accept invite
        ac = s.post(f"{API}/auth/accept-invite", json={"invite_token": token, "password": "newpass123"})
        assert ac.status_code == 200, ac.text
        aj = ac.json()
        assert aj["user"]["role"] == "student"
        assert aj["user"]["invited_by_adi"] == "123456"
        assert aj["user"]["email"] == email.lower()
        assert "access_token" in aj

        # second accept with same token should 400
        ac2 = s.post(f"{API}/auth/accept-invite", json={"invite_token": token, "password": "newpass123"})
        assert ac2.status_code == 400
        assert "already" in ac2.json().get("detail", "").lower()

    def test_invite_garbage_token_400(self, s):
        r = s.get(f"{API}/auth/invite/garbage")
        assert r.status_code == 400
        assert "invalid" in r.json().get("detail", "").lower() or "expired" in r.json().get("detail", "").lower()
