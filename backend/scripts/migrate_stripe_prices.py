#!/usr/bin/env python3
"""
Move every existing live Stripe subscription onto the new, repriced
Pro/Franchise Price objects (23 Sept 2026), per Grant directly.

Context: Pro (retitled "ADI Pro" in the UI) moved £24.99 -> £11.99/mo,
and Franchise moved £39.99+£10/seat -> £13.99+£9.99/seat, to match
Drive My Way's Solo Instructor and Driving School tiers exactly (see
Migration 037). Stripe Price objects are immutable once created, so
this can't be done by editing the old prices in place — new Price
objects have to exist first, and every LIVE subscription still
pointing at an old price needs its subscription item swapped over.

Per Grant's explicit choice: every existing subscriber moves to the new
price, no grandfathering, no exceptions. This script is what actually
carries that out against real Stripe data, which is exactly why it
defaults to a dry run and needs an explicit flag to touch anything live.

BEFORE RUNNING THIS SCRIPT:
  1. In the Stripe Dashboard, create two new Price objects:
       - ADI Pro:        £11.99/mo, recurring
       - Franchise base: £13.99/mo, recurring
       - Franchise seat: £9.99/mo, recurring
     (Prices can't be edited — archive the old ones once every
     subscription below is confirmed moved, don't archive them first.)
  2. Update STRIPE_PRICE_PRO, STRIPE_PRICE_FRANCHISE_BASE and
     STRIPE_PRICE_FRANCHISE_SEAT in backend/.env (and on Render) to the
     new Price IDs from step 1. This script reads the same three env
     vars the app itself uses, so it automatically targets whatever
     they're currently set to — get them right before running this.

USAGE:
    cd backend
    python3 scripts/migrate_stripe_prices.py            # dry run — prints
                                                          # what WOULD change,
                                                          # touches nothing
    python3 scripts/migrate_stripe_prices.py --live      # actually applies it

Uses proration_behavior='none' deliberately — this is a company-
initiated repricing, not a customer-initiated upgrade/downgrade, so
there should be no surprise prorated charge or credit on anyone's next
invoice. The new price simply takes effect from their next billing
cycle onward.
"""
import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import httpx
import stripe

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / ".env")

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
STRIPE_PRICE_PRO = os.environ.get("STRIPE_PRICE_PRO", "")
STRIPE_PRICE_FRANCHISE_BASE = os.environ.get("STRIPE_PRICE_FRANCHISE_BASE", "")
STRIPE_PRICE_FRANCHISE_SEAT = os.environ.get("STRIPE_PRICE_FRANCHISE_SEAT", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

stripe.api_key = STRIPE_API_KEY


def fetch_schools_to_migrate() -> list[dict]:
    """Every school on Pro or Franchise with a live Stripe subscription.
    Starter is excluded — it has no subscription to move. Schools with
    no stripe_subscription_id (comp accounts, or ones that never
    actually completed checkout) are skipped too — nothing to migrate."""
    resp = httpx.get(
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/driving_schools",
        params={
            "tier": "in.(pro,franchise)",
            "stripe_subscription_id": "not.is.null",
            "select": "id,business_name,tier,stripe_subscription_id,stripe_customer_id,seat_count,is_comp_account",
        },
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()


def migrate_one(school: dict, live: bool) -> None:
    name = school.get("business_name") or school["id"]
    tier = school["tier"]
    sub_id = school["stripe_subscription_id"]

    if school.get("is_comp_account"):
        print(f"  SKIP  {name} ({tier}) — comp account, not on real billing")
        return

    sub = stripe.Subscription.retrieve(sub_id, expand=["items.data.price"])
    items = sub["items"]["data"]
    updates = []

    if tier == "pro":
        # Solo tier — always exactly one subscription item.
        item = items[0]
        if item["price"]["id"] != STRIPE_PRICE_PRO:
            updates.append({"id": item["id"], "price": STRIPE_PRICE_PRO, "quantity": item["quantity"]})

    elif tier == "franchise":
        # Up to two items: base (always quantity 1, always created first
        # — see tier_to_line_items()) and, only if there's more than one
        # instructor, a seat item (quantity = extra seats). By the time
        # this script runs the STRIPE_PRICE_FRANCHISE_* env vars have
        # already been repointed at the NEW prices (per this script's own
        # prerequisites), so matching against them can't tell an item's
        # OLD identity apart — position is what tier_to_line_items()
        # itself guarantees instead: base first, seat second if present.
        # Quantity is cross-checked as a sanity check, not the primary
        # signal, since a school with exactly one extra instructor would
        # have a seat item with quantity 1 too, indistinguishable from
        # the base item by quantity alone.
        if len(items) not in (1, 2):
            print(f"  WARN  {name} ({tier}) — expected 1 or 2 subscription items, found {len(items)}. Skipping — handle manually in the Stripe Dashboard.")
            return
        base_item = items[0]
        if base_item["quantity"] != 1:
            print(f"  WARN  {name} ({tier}) — first item has quantity {base_item['quantity']}, expected 1 for the base price. Skipping — handle manually in the Stripe Dashboard.")
            return
        if base_item["price"]["id"] != STRIPE_PRICE_FRANCHISE_BASE:
            updates.append({"id": base_item["id"], "price": STRIPE_PRICE_FRANCHISE_BASE, "quantity": 1})
        if len(items) == 2:
            seat_item = items[1]
            if seat_item["price"]["id"] != STRIPE_PRICE_FRANCHISE_SEAT:
                updates.append({"id": seat_item["id"], "price": STRIPE_PRICE_FRANCHISE_SEAT, "quantity": seat_item["quantity"]})

    if not updates:
        print(f"  OK    {name} ({tier}) — already on the new price")
        return

    if not live:
        print(f"  WOULD UPDATE  {name} ({tier}) — {len(updates)} item(s): {updates}")
        return

    stripe.Subscription.modify(
        sub_id,
        items=updates,
        proration_behavior="none",
    )
    print(f"  UPDATED  {name} ({tier}) — {len(updates)} item(s) moved to the new price")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Actually apply changes. Without this flag, only prints what would happen.")
    args = parser.parse_args()

    if not STRIPE_API_KEY:
        sys.exit("STRIPE_API_KEY not set — check backend/.env")
    if not STRIPE_PRICE_PRO or not STRIPE_PRICE_FRANCHISE_BASE or not STRIPE_PRICE_FRANCHISE_SEAT:
        sys.exit("STRIPE_PRICE_PRO / STRIPE_PRICE_FRANCHISE_BASE / STRIPE_PRICE_FRANCHISE_SEAT must all be set to the NEW price IDs before running this — see the docstring at the top of this file.")

    mode = "LIVE — changes will be applied" if args.live else "DRY RUN — nothing will be changed"
    print(f"=== Stripe price migration ({mode}) ===\n")

    schools = fetch_schools_to_migrate()
    if not schools:
        print("No schools with a live subscription on Pro or Franchise found. Nothing to do.")
        return

    print(f"Found {len(schools)} school(s) with a live subscription on Pro or Franchise:\n")
    for school in schools:
        migrate_one(school, live=args.live)

    print("\nDone." if args.live else "\nDry run complete — re-run with --live to actually apply these changes.")


if __name__ == "__main__":
    main()
