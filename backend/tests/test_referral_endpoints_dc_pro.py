"""Who may get a referral code. Grant, 29 Oct 2026: only the owner of a DC Pro school, once subscribed for a month.
Franchise schools and instructors linked to a school cannot. Fake database. No network."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import server

LONG_AGO = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def world(monkeypatch):
    w = {"school": {"id": "s1", "tier": "pro", "subscription_status": "active", "is_comp_account": False,
                    "subscribed_since": LONG_AGO, "owner_auth_id": "owner-1"}}

    async def own(_user):
        return {"id": "i1", "referral_code": "ABC123", "school_id": "s1"}

    async def school(_id):
        return w["school"]

    monkeypatch.setattr(server, "_get_own_instructor", own)
    monkeypatch.setattr(server, "sb_get_school_by_id", school)
    return w


def as_user(auth_id):
    return {"auth_user_id": auth_id, "email": "x@example.com"}


def test_a_dc_pro_owner_gets_their_code_and_the_status_says_eligible(world):
    assert run(server.get_my_referral_code(as_user("owner-1"))).code == "ABC123"
    assert run(server.get_referral_status(as_user("owner-1"))).eligible is True


@pytest.mark.parametrize("tier", ["franchise", "starter"])
def test_other_plans_get_no_code_and_no_eligibility(world, tier):
    world["school"]["tier"] = tier
    with pytest.raises(HTTPException) as e:
        run(server.get_my_referral_code(as_user("owner-1")))
    assert e.value.status_code == 403
    status = run(server.get_referral_status(as_user("owner-1")))
    assert status.eligible is False and status.eligible_from is None  # the app then shows nothing at all


def test_an_instructor_linked_to_a_school_they_do_not_own_gets_no_code(world):
    with pytest.raises(HTTPException) as e:
        run(server.get_my_referral_code(as_user("sub-instructor-9")))
    assert e.value.status_code == 403
    assert run(server.get_referral_status(as_user("sub-instructor-9"))).eligible is False
