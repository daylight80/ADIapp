"""A school's website form posts to /public/enquiries/<key> with no login. The key says whose it is; the enquiry goes to
the school owner. Against an in-memory database. No network."""
import asyncio
import json
from datetime import datetime, timezone
from urllib.parse import urlencode

import pytest
from fastapi import BackgroundTasks, HTTPException

import address_search
import public_enquiries as pe
import server

KEY = "a" * 32
OWNER_AUTH = "auth-owner"


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, "boom"

    def json(self):
        return self._rows


class Db:
    def __init__(self):
        self.tables = {
            "driving_schools": [{"id": "sc1", "tier": "pro", "owner_auth_id": OWNER_AUTH, "enquiry_form_key": KEY, "enquiry_form_enabled": True,
                                 "business_name": "Formula Jon Driving School"}],
            "instructors": [{"id": "ins-owner", "school_id": "sc1", "auth_user_id": OWNER_AUTH, "email": "jon@formula.co"}],
            "enquiries": [],
            "enquiry_contacts": [],
        }
        self.fail_insert = False
        self.pushes, self.emails = [], []  # what the notifications would have sent
        self.auth_emails = {OWNER_AUTH: "jon@login.co"}  # the email each login signs in with

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    @staticmethod
    def _match(row, params):
        for k, v in params.items():
            if k in ("select", "limit"):
                continue
            if v == "is.null":
                if row.get(k) is not None:
                    return False
            elif v.startswith("eq.") and str(row.get(k)) != v[3:]:
                return False
            elif v.startswith("gte.") and not (row.get(k) or "") >= v[4:]:
                return False
        return True

    async def get(self, url, params=None, headers=None):
        if "/auth/v1/admin/users/" in url:
            email = self.auth_emails.get(url.rsplit("/", 1)[-1])
            return Resp({"email": email} if email else {}, 200 if email else 404)
        table = url.rsplit("/", 1)[-1]
        return Resp([r for r in self.tables[table] if self._match(r, params or {})])

    async def post(self, url, headers=None, json=None):
        table = url.rsplit("/", 1)[-1]
        if self.fail_insert and table == "enquiries":
            return Resp([], 500)
        row = {**json, "id": f"{table}-{len(self.tables[table]) + 1}", "created_at": datetime.now(timezone.utc).isoformat(),
               "closed_at": None, "converted_at": None}
        self.tables[table].append(row)
        return Resp([row], 201)


class Req:
    def __init__(self, body: bytes, content_type="application/json", ip="1.2.3.4", extra_headers=None):
        self._body = body
        self.headers = {"content-type": content_type, "x-forwarded-for": f"9.9.9.9, {ip}", "content-length": str(len(body)), **(extra_headers or {})}
        self.client = None

    async def body(self):
        return self._body


@pytest.fixture
def db(monkeypatch):
    d = Db()
    monkeypatch.setattr(server.httpx, "AsyncClient", d)
    monkeypatch.setattr(server, "_sb_headers", lambda *a, **k: {})
    monkeypatch.setattr(server, "_sb_rest_base", "https://db.example/rest/v1")
    monkeypatch.setattr(server, "SUPABASE_URL", "https://db.example")
    monkeypatch.setattr(server, "_enquiry_ip_limiter", address_search.UserLimiter(20, 3600))
    monkeypatch.setattr(server, "_enquiry_key_limiter", address_search.UserLimiter(30, 3600))

    async def push(auth_user_id, message, kind):
        d.pushes.append((auth_user_id, message, kind))
        return True

    async def send(payload, client=None):
        if d.email_error:
            raise server.email_service.EmailSendError("Resend rejected the email")
        d.emails.append(payload)

    d.email_error = False
    monkeypatch.setattr(server, "_push_to_user", push)
    monkeypatch.setattr(server.email_service, "send_email", send)
    monkeypatch.setattr(server.email_service, "is_configured", lambda: True)
    return d


def post(req, key=KEY):
    """What the visitor gets back, then the notifications that follow it."""
    background = BackgroundTasks()
    out = asyncio.run(server.public_enquiry(key, req, background))
    asyncio.run(background())
    return out


def json_req(**fields):
    return Req(json.dumps(fields).encode())


GOOD = {"name": "Dayana Arachchige", "mobile": "07496 496582", "email": "Anusudhi75@Gmail.com", "postcode": "sm5 1es",
        "availability": "Weekdays, one day off each week", "theory": "Y", "practical": "N", "message": "Previously had lessons."}


# --- the happy path -------------------------------------------------------------------------------------------------
def test_a_form_becomes_an_enquiry_for_the_school_owner(db):
    out = post(json_req(**GOOD))
    assert out["ok"] is True
    [row] = db.tables["enquiries"]
    assert row["school_id"] == "sc1" and row["instructor_id"] == "ins-owner" and row["source"] == "Website"
    assert row["name"] == "Dayana Arachchige" and row["phone"] == "07496496582" and row["email"] == "anusudhi75@gmail.com"
    assert row["postcode"] == "SM5 1ES"
    assert row["notes"] == "Message: Previously had lessons.\nAvailability: Weekdays, one day off each week\nTheory test: Y\nPractical test: N"


def test_an_elementor_form_post_with_field_ids_is_understood(db):
    body = urlencode({"first_name": "Sam", "last_name": "Lee", "mobile_telephone": "07700 900123", "your_question": "Auto please"})
    post(Req(body.encode(), "application/x-www-form-urlencoded; charset=UTF-8"))
    [row] = db.tables["enquiries"]
    assert row["name"] == "Sam Lee" and row["phone"] == "07700900123"
    assert "Your question: Auto please" in row["notes"]  # a custom question is kept, not lost


def test_elementor_advanced_data_is_understood_whether_nested_or_flat(db):
    nested = {"form": {"id": "f1", "name": "Enquiry"}, "fields": {"name": {"id": "name", "value": "Sam Lee"}, "email": {"id": "email", "value": "sam@x.co"}}, "meta": {"date": {"value": "30 Oct"}}}
    post(Req(json.dumps(nested).encode()))
    flat = urlencode({"form[id]": "f1", "fields[name][value]": "Pat Roe", "fields[email][value]": "pat@x.co", "meta[date][value]": "30 Oct"})
    post(Req(flat.encode(), "application/x-www-form-urlencoded"))
    assert [(r["name"], r["email"]) for r in db.tables["enquiries"]] == [("Sam Lee", "sam@x.co"), ("Pat Roe", "pat@x.co")]
    assert all("Date" not in (r["notes"] or "") for r in db.tables["enquiries"])


def test_a_consent_tick_is_kept_as_the_record_that_they_agreed_to_be_contacted(db):
    post(json_req(name="Sam Lee", email="sam@x.co", consent="on"))
    assert "Consent: on" in db.tables["enquiries"][0]["notes"]


# --- keys, tiers and switches: all look the same to the caller ---------------------------------------------------------
@pytest.mark.parametrize("key", ["b" * 32, "short", "A" * 32, "x" * 500])
def test_a_wrong_key_says_thanks_and_saves_nothing(db, key):
    assert post(json_req(**GOOD), key)["ok"] is True
    assert db.tables["enquiries"] == []


def test_a_starter_school_saves_nothing(db):
    db.tables["driving_schools"][0]["tier"] = "starter"
    assert post(json_req(**GOOD))["ok"] is True
    assert db.tables["enquiries"] == []


def test_a_form_switched_off_saves_nothing(db):
    db.tables["driving_schools"][0]["enquiry_form_enabled"] = False
    assert post(json_req(**GOOD))["ok"] is True
    assert db.tables["enquiries"] == []


@pytest.mark.parametrize("tier", ["pro", "franchise"])
def test_dc_pro_and_franchise_take_enquiries(db, tier):
    db.tables["driving_schools"][0]["tier"] = tier
    post(json_req(**GOOD))
    assert len(db.tables["enquiries"]) == 1


# --- what the visitor gets wrong ------------------------------------------------------------------------------------------
@pytest.mark.parametrize("fields,message", [
    ({"mobile": "07700 900123"}, "name"),
    ({"name": "Sam"}, "mobile number or an email"),
    ({"name": "Sam", "email": "not an email"}, "email address"),
    ({"name": "Sam", "mobile": "123"}, "phone number"),
])
def test_a_form_missing_something_is_refused_with_words_the_visitor_can_use(db, fields, message):
    with pytest.raises(HTTPException) as e:
        post(json_req(**fields))
    assert e.value.status_code == 422 and message in e.value.detail
    assert db.tables["enquiries"] == []


def test_a_form_with_only_a_phone_or_only_an_email_is_fine(db):
    post(json_req(name="Sam", mobile="07700 900123"))
    post(json_req(name="Pat", email="pat@x.co"))
    assert len(db.tables["enquiries"]) == 2


# --- abuse -----------------------------------------------------------------------------------------------------------------
def test_a_filled_honeypot_says_thanks_and_saves_nothing(db):
    assert post(json_req(**GOOD, company_website="http://spam.example"))["ok"] is True
    assert post(json_req(**GOOD, honeypot_field="x"))["ok"] is True
    assert db.tables["enquiries"] == []


def test_the_same_person_twice_in_a_day_is_one_enquiry_with_a_note(db):
    post(json_req(**GOOD))
    post(json_req(name="Dayana A", mobile="07496 496582", message="Any news?"))  # same phone, different email
    post(json_req(name="Dayana", email="anusudhi75@gmail.com"))  # same email
    assert len(db.tables["enquiries"]) == 1
    notes = [c["note"] for c in db.tables["enquiry_contacts"]]
    assert len(notes) == 2 and all(n.startswith("Sent the website form again.") for n in notes)
    assert "Any news?" in notes[0]
    assert all(c["kind"] == "note" and c["instructor_id"] == "ins-owner" for c in db.tables["enquiry_contacts"])


def test_a_closed_enquiry_does_not_swallow_a_new_one(db):
    post(json_req(**GOOD))
    db.tables["enquiries"][0]["closed_at"] = "2026-10-30T10:00:00+00:00"
    post(json_req(**GOOD))
    assert len(db.tables["enquiries"]) == 2


def test_one_address_is_limited_to_20_an_hour_and_the_limit_counts_the_real_address(db):
    for i in range(20):
        post(json_req(name=f"P{i}", email=f"p{i}@x.co"))
    with pytest.raises(HTTPException) as e:
        post(json_req(name="One more", email="more@x.co"))
    assert e.value.status_code == 429
    post(Req(json.dumps({"name": "Other", "email": "o@x.co"}).encode(), ip="5.6.7.8"))  # another address is unaffected


def test_a_school_form_is_limited_to_30_an_hour_across_addresses(db):
    for i in range(30):
        post(Req(json.dumps({"name": f"P{i}", "email": f"p{i}@x.co"}).encode(), ip=f"10.0.0.{i}"))
    with pytest.raises(HTTPException) as e:
        post(Req(json.dumps({"name": "x", "email": "x@x.co"}).encode(), ip="10.0.1.1"))
    assert e.value.status_code == 429


def test_a_big_body_is_refused_before_it_is_read_and_when_the_length_is_missing_or_wrong(db):
    big = json.dumps({"name": "Sam", "email": "s@x.co", "message": "x" * 30000}).encode()
    with pytest.raises(HTTPException) as e:
        post(Req(big))
    assert e.value.status_code == 413
    with pytest.raises(HTTPException) as e:
        post(Req(big, extra_headers={"content-length": "10"}))  # a lie about the length does not help
    assert e.value.status_code == 413
    with pytest.raises(HTTPException) as e:
        post(Req(b"{}", extra_headers={"content-length": "abc"}))
    assert e.value.status_code == 400
    assert db.tables["enquiries"] == []


@pytest.mark.parametrize("ctype", ["text/plain", "multipart/form-data; boundary=x", ""])
def test_other_content_types_are_refused(db, ctype):
    with pytest.raises(HTTPException) as e:
        post(Req(b"name=Sam", ctype))
    assert e.value.status_code == 415


@pytest.mark.parametrize("body", [b"not json", b"[1,2]", b"\xff\xfe"])
def test_garbage_is_refused_not_a_crash(db, body):
    with pytest.raises(HTTPException) as e:
        post(Req(body))
    assert e.value.status_code == 422


def test_long_and_odd_text_is_trimmed_and_cleaned_to_fit_the_columns(db):
    post(json_req(name="N" * 300, email="a@x.co", postcode="p" * 50, message="m" * 5000, availability="a" * 500,
                  address="line1\x00\x07\nline2"))
    [row] = db.tables["enquiries"]
    assert len(row["name"]) == 100 and len(row["postcode"]) == 10 and len(row["notes"]) <= 1000
    assert "\x00" not in row["notes"] and "\x07" not in row["notes"]


def test_html_is_stored_as_text_not_run(db):
    post(json_req(name="<script>alert(1)</script>", email="a@x.co"))
    assert db.tables["enquiries"][0]["name"] == "<script>alert(1)</script>"  # shown as text; emails must escape it (next change)


# --- when things go wrong on our side ----------------------------------------------------------------------------------
def test_a_failed_save_is_reported_not_claimed_as_done(db):
    db.fail_insert = True
    with pytest.raises(HTTPException) as e:
        post(json_req(**GOOD))
    assert e.value.status_code == 503 and "phone" in e.value.detail


def test_an_owner_with_no_instructor_record_is_reported_not_lost_silently(db):
    db.tables["instructors"].clear()
    with pytest.raises(HTTPException) as e:
        post(json_req(**GOOD))
    assert e.value.status_code == 503


# --- the reading of field names ---------------------------------------------------------------------------------------
@pytest.mark.parametrize("name", ["Mobile telephone", "mobile_telephone", "Mobile-Telephone", "MOBILE"])
def test_field_names_are_matched_loosely(name):
    assert pe.build_enquiry({"name": "Sam", name: "07700 900123"})["phone"] == "07700900123"


def test_a_phone_number_keeps_a_leading_plus_and_loses_spaces_and_brackets():
    assert pe.build_enquiry({"name": "Sam", "phone": "+44 (0)7700 900123"})["phone"] == "+4407700900123"


# --- over real HTTP: the route is mounted, needs no login, and reads real request bodies ------------------------------------
def test_the_route_is_public_and_works_over_real_http(db):
    from fastapi.testclient import TestClient
    client = TestClient(server.app)
    r = client.post(f"/api/public/enquiries/{KEY}", json=GOOD)  # no Authorization header
    assert r.status_code == 200 and r.json()["ok"] is True
    r = client.post(f"/api/public/enquiries/{KEY}", content=urlencode({"name": "Sam Lee", "mobile_telephone": "07700 900123"}),
                    headers={"content-type": "application/x-www-form-urlencoded"})
    assert r.status_code == 200
    assert [e["name"] for e in db.tables["enquiries"]] == ["Dayana Arachchige", "Sam Lee"]
    r = client.post(f"/api/public/enquiries/{KEY}", json={"name": "Sam"})
    assert r.status_code == 422 and "mobile number or an email" in r.json()["detail"]
    r = client.post(f"/api/public/enquiries/{KEY}", content=b"x" * 30000, headers={"content-type": "application/json"})
    assert r.status_code == 413


# --- notifications: push + email to the owner, a thank-you to the visitor ---------------------------------------------
def test_a_new_enquiry_pushes_the_owner_with_no_details(db):
    post(json_req(**GOOD))
    assert db.pushes == [(OWNER_AUTH, {"title": "New Enquiry", "body": "Check DualControl for more details"}, "new_enquiry")]


def test_the_owner_is_emailed_the_details_and_replying_answers_the_visitor(db):
    post(json_req(**GOOD))
    to_owner = next(p for p in db.emails if p["to"] == ["jon@formula.co"])
    assert to_owner["subject"] == "New website enquiry from Dayana Arachchige"
    assert to_owner["from"] == server.email_service.system_sender_header()
    assert to_owner["reply_to"] == "anusudhi75@gmail.com"
    for needle in ("Dayana Arachchige", "07496496582", "anusudhi75@gmail.com", "SM5 1ES", "Availability: Weekdays", "Theory test: Y"):
        assert needle in to_owner["text"] and needle in to_owner["html"]


def test_the_visitor_gets_a_thank_you_from_the_school_that_echoes_nothing_they_wrote(db):
    post(json_req(**GOOD))
    to_visitor = next(p for p in db.emails if p["to"] == ["anusudhi75@gmail.com"])
    assert to_visitor["from"] == '"Formula Jon Driving School via DualControl" <' + server.email_service.EMAIL_FROM_ADDRESS + ">"
    assert to_visitor["reply_to"] == "jon@formula.co"
    assert to_visitor["subject"] == "We've got your enquiry - Formula Jon Driving School"
    assert "Hi Dayana," in to_visitor["text"]
    # A stranger types this address in: nothing else they wrote is repeated back to it.
    for echoed in ("07496496582", "SM5 1ES", "Previously had lessons", "Weekdays", "Arachchige"):
        assert echoed not in to_visitor["text"] and echoed not in to_visitor["html"]
    assert len(db.emails) == 2


def test_what_a_stranger_types_cannot_inject_html_or_email_headers(db):
    post(json_req(name="<script>alert(1)</script>", email="a@x.co", message="<img src=x onerror=alert(2)>\n<b>bold</b>"))
    for payload in db.emails:
        assert "<script>" not in payload["html"] and "<img" not in payload["html"] and "<b>bold" not in payload["html"]
        assert "\n" not in payload["subject"] and "\r" not in payload["subject"]
    assert "&lt;script&gt;" in next(p for p in db.emails if p["to"] == ["jon@formula.co"])["html"]
    # Straight into the template, newlines and quotes in a name cannot reach the subject or the sender line.
    subject, _, _ = server.email_service.render_new_enquiry_email(name="Sam\r\nBcc: evil@x.co", phone=None, email="a@x.co", postcode=None, notes=None)
    assert "\n" not in subject and "\r" not in subject
    subject, _, text = server.email_service.render_enquiry_confirmation_email(visitor_name='Sam"\r\nBcc: x', school_name='Evil" <a@b.c>\r\nX: y')
    assert "\n" not in subject and "\r" not in subject and "<a@b.c>" not in subject


def test_an_enquiry_with_only_a_phone_pushes_and_emails_the_owner_but_sends_no_thank_you(db):
    post(json_req(name="Sam Lee", mobile="07700 900123"))
    assert len(db.pushes) == 1
    assert [p["to"] for p in db.emails] == [["jon@formula.co"]]
    assert "reply_to" not in db.emails[0] and "ring or text them" in db.emails[0]["text"]


def test_an_owner_with_no_email_on_their_record_is_emailed_at_the_address_they_sign_in_with(db):
    db.tables["instructors"][0]["email"] = None
    post(json_req(**GOOD))
    assert [p["to"] for p in db.emails] == [["jon@login.co"], ["anusudhi75@gmail.com"]]
    assert next(p for p in db.emails if p["to"] == ["anusudhi75@gmail.com"])["reply_to"] == "jon@login.co"


def test_an_owner_with_no_email_anywhere_is_pushed_and_the_visitor_still_thanked(db):
    db.tables["instructors"][0]["email"] = None
    db.auth_emails.clear()
    post(json_req(**GOOD))
    assert len(db.pushes) == 1
    assert [p["to"] for p in db.emails] == [["anusudhi75@gmail.com"]]
    assert "reply_to" not in db.emails[0]


def test_a_failed_login_email_lookup_does_not_stop_the_visitor_being_thanked(db, monkeypatch):
    db.tables["instructors"][0]["email"] = None

    async def boom(*a, **k):
        raise RuntimeError("auth down")

    monkeypatch.setattr(db, "get", lambda url, params=None, headers=None: boom() if "/auth/v1/" in url else Db.get(db, url, params, headers))
    post(json_req(**GOOD))
    assert [p["to"] for p in db.emails] == [["anusudhi75@gmail.com"]]


def test_when_email_is_not_set_up_the_owner_is_still_pushed(db, monkeypatch):
    monkeypatch.setattr(server.email_service, "is_configured", lambda: False)
    post(json_req(**GOOD))
    assert len(db.pushes) == 1 and db.emails == [] and len(db.tables["enquiries"]) == 1


def test_a_failing_email_never_loses_the_enquiry_or_the_visitor_their_thanks(db):
    db.email_error = True
    assert post(json_req(**GOOD))["ok"] is True
    assert len(db.tables["enquiries"]) == 1 and len(db.pushes) == 1


def test_a_failing_push_does_not_stop_the_emails(db, monkeypatch):
    async def boom(*a):
        raise RuntimeError("expo down")

    monkeypatch.setattr(server, "_push_to_user", boom)
    post(json_req(**GOOD))
    assert len(db.emails) == 2 and len(db.tables["enquiries"]) == 1


def test_one_failing_email_does_not_stop_the_other(db, monkeypatch):
    calls = []

    async def send(payload, client=None):
        calls.append(payload["to"][0])
        if payload["to"] == ["jon@formula.co"]:
            raise server.email_service.EmailSendError("nope")

    monkeypatch.setattr(server.email_service, "send_email", send)
    post(json_req(**GOOD))
    assert calls == ["jon@formula.co", "anusudhi75@gmail.com"]


def test_a_repeat_enquiry_is_a_note_and_pings_nobody(db):
    post(json_req(**GOOD))
    db.pushes.clear(); db.emails.clear()
    post(json_req(name="Dayana", mobile="07496 496582"))
    assert len(db.tables["enquiries"]) == 1 and len(db.tables["enquiry_contacts"]) == 1
    assert db.pushes == [] and db.emails == []  # no second thank-you to the same address either


@pytest.mark.parametrize("setup", ["wrong key", "starter", "off", "honeypot", "bad form", "save fails"])
def test_nothing_is_sent_when_nothing_was_saved(db, setup):
    key, fields = KEY, dict(GOOD)
    if setup == "wrong key":
        key = "b" * 32
    elif setup == "starter":
        db.tables["driving_schools"][0]["tier"] = "starter"
    elif setup == "off":
        db.tables["driving_schools"][0]["enquiry_form_enabled"] = False
    elif setup == "honeypot":
        fields["company_website"] = "http://spam.example"
    elif setup == "bad form":
        fields.pop("name")
    elif setup == "save fails":
        db.fail_insert = True
    try:
        post(json_req(**fields), key)
    except HTTPException:
        pass
    assert db.pushes == [] and db.emails == []


def test_over_real_http_the_visitor_is_answered_and_the_notifications_follow(db):
    from fastapi.testclient import TestClient
    r = TestClient(server.app).post(f"/api/public/enquiries/{KEY}", json=GOOD)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert len(db.pushes) == 1 and len(db.emails) == 2
