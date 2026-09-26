// Single source of truth for the four subscription tiers.
// Prices in GBP, monthly. Keep in sync with /app/supabase/migrations/003_subscription_tiers.sql
// and the Stripe products in your dashboard.

import { supabase } from './supabaseClient';

// 'growth' removed from the union (23 Sept 2026) — the tier itself is
// gone, not just relabelled; see Migration 037 for the one-time move of
// existing Growth schools onto 'pro'/ADI Pro.
export type Tier = 'starter' | 'pro' | 'franchise';

export type TierSpec = {
  id: Tier;
  name: string;
  price_gbp: number;       // monthly base price
  per_seat_gbp?: number;   // additional per-instructor price (franchise only)
  student_limit: number | null;   // null = unlimited
  instructor_limit: number | null; // null = unlimited
  blurb: string;
  features: string[];
  recommended?: boolean;
};

export const TIERS: TierSpec[] = [
  {
    id: 'starter',
    name: 'Starter',
    price_gbp: 0,
    student_limit: 5,
    instructor_limit: 1,
    blurb: 'Free for PDIs training towards their ADI qualification, or for any ADI wanting to try ADI Pro before upgrading.',
    features: [
      'Lesson diary, day & week views',
    ],
  },
  {
    // Retitled from "Pro" and repriced £24.99 -> £11.99 (23 Sept 2026),
    // per Grant directly, to match Drive My Way's Solo Instructor tier
    // exactly — Growth (£14.99/mo, capped at 15 students) removed
    // entirely, since it sat priced ABOVE a competitor offering
    // unlimited students for less. id stays 'pro' deliberately: it's
    // the display name and price changing, not the tier itself, so
    // every existing tier === 'pro' / isProTier() check throughout the
    // app (and every driving_schools.tier = 'pro' row already in the
    // database) keeps working completely unchanged — no DB migration
    // needed for this tier, only for moving former Growth schools onto
    // it (see Migration 037). Every former Growth feature is folded
    // directly into this list below now that there's no separate
    // Growth tier for "Everything in Growth" to point back to.
    id: 'pro',
    name: 'ADI Pro',
    price_gbp: 11.99,
    student_limit: null,
    instructor_limit: 1,
    blurb: 'Solo ADIs — your own RHD vehicle, unlimited students.',
    features: [
      'Unlimited active students',
      'Lesson diary, day & week views',
      'DVSA competency tracker',
      'KPI dashboard & PDF invoices',
      'Lesson reminders, push notifications',
      'Traffic-aware travel time auto-suggest',
      'Receipts & expense logging with photo OCR',
      'Route recording for lessons',
      'Block booking & wallet management',
      'Priority email support',
    ],
    recommended: true,
  },
  {
    // Repriced £39.99+£10/seat -> £13.99+£9.99/seat (23 Sept 2026), per
    // Grant directly, to match Drive My Way's Driving School tier
    // exactly. Name and features unchanged — only the price.
    id: 'franchise',
    name: 'Franchise',
    price_gbp: 13.99,
    per_seat_gbp: 9.99,
    student_limit: null,
    instructor_limit: null,
    blurb: 'Multi-car driving schools — billed per seat.',
    features: [
      'Unlimited students across the fleet',
      'Unlimited instructors (£9.99 / seat after the first)',
      'Ranked instructor leaderboard, sortable by lessons, students, pass rate',
      'Multi-vehicle management & RHD compliance flag',
    ],
  },
];

export const tierById = (id: string | null | undefined): TierSpec =>
  TIERS.find((t) => t.id === id) || TIERS[0];

// True when the user is on Growth, Pro, or Franchise — i.e. NOT free Starter.
// Use this to gate "paid-only" features such as the KPI dashboard, PDF
// invoices, push notifications, traffic-aware travel time, and auto-award
// competency badges. Starter intentionally returns false.
export function isPaidTier(tier: string | null | undefined): boolean {
  return tier === 'pro' || tier === 'franchise';
}

// For features genuinely exclusive to the top tier — e.g. multi-instructor
// student assignment management, which only makes sense with more than one
// instructor in the first place.
export function isFranchiseTier(tier: string | null | undefined): boolean {
  return tier === 'franchise';
}

// Whether Home should offer the School dashboard (owner-dashboard-screen: the
// school-wide leaderboard, Add instructor and student assignments). Only the
// owner of a Franchise school — a non-owner instructor inside a Franchise school
// can't add instructors, and Starter/ADI Pro instructors are solo. This is a UX
// gate only; RLS is the real boundary.
export function canOpenSchoolDashboard(tier: string | null | undefined, isOwner: boolean): boolean {
  return isFranchiseTier(tier) && isOwner;
}

// For features exclusive to Pro and above — e.g. block booking & wallet
// management, per tiers.ts's own feature list. Added 1 Sept 2026 during a
// tier-gating audit that found wallet-screen.tsx (block booking + wallet
// management) with zero gating at all — this helper genuinely didn't exist
// before, only isPaidTier (Growth+) and isFranchiseTier did.
export function isProTier(tier: string | null | undefined): boolean {
  return tier === 'pro' || tier === 'franchise';
}

// Tier-aware replacement for the old proPlan.ts binary canAddStudent — checks
// the real per-tier limit (Starter 5, Growth 15, Pro/Franchise unlimited)
// instead of a flat free/pro split.
export function canAddStudent(tier: string | null | undefined, currentCount: number): boolean {
  const limit = tierById(tier).student_limit;
  return limit === null || currentCount < limit;
}

// ---------------------------------------------------------------------------
// Usage snapshot read from the schools_with_usage view (migration 003).
// ---------------------------------------------------------------------------

export type SchoolUsage = {
  id: string;
  business_name: string;
  tier: Tier;
  subscription_status: string;
  seat_count: number;
  current_period_end: string | null;
  student_limit: number | null;
  instructor_limit: number | null;
  active_students: number;
  instructor_count: number;
  stripe_subscription_id: string | null;
};

export async function loadSchoolUsage(): Promise<SchoolUsage | null> {
  const { data, error } = await supabase
    .from('schools_with_usage')
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[tiers] loadSchoolUsage error', error.message);
    return null;
  }
  return data as SchoolUsage | null;
}

// ---------------------------------------------------------------------------
// Pretty-format a Postgres error code from our tier-enforcement triggers.
// ---------------------------------------------------------------------------

export function explainLimitError(err: any): string | null {
  const msg = String(err?.message || '');
  if (msg.includes('STUDENT_LIMIT_REACHED')) {
    return 'You\u2019ve reached the student limit for your current tier. Upgrade to add more pupils.';
  }
  if (msg.includes('INSTRUCTOR_LIMIT_REACHED')) {
    return 'Only the Franchise tier supports multiple instructors. Upgrade to add more team members.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Escalating "you're getting close to your limit" nudges — the point being
// to prompt an upgrade before someone hits the hard cap, not just when they
// do (previously the only nudge was the paywall that appears once blocked).
// ---------------------------------------------------------------------------
export type UsageUrgency = 'ok' | 'warning' | 'critical';

export function studentUsageUrgency(current: number, limit: number | null): UsageUrgency {
  if (limit === null || limit === 0) return 'ok'; // unlimited tier
  if (current >= limit) return 'critical';
  if (current / limit >= 0.6) return 'warning';
  return 'ok';
}

// Same three-tier message regardless of which screen shows it, so the nudge
// feels consistent wherever it's seen.
export function studentUsageMessage(current: number, limit: number | null): string {
  if (limit === null || limit === 0) return '';
  // Was tierById('growth') — Growth no longer exists; Starter's 5-student
  // cap now nudges straight to ADI Pro (unlimited), the only tier above it.
  const upgrade = tierById('pro');
  const remaining = limit - current;
  if (remaining <= 0) {
    return `You've reached your limit — upgrade to ${upgrade.name} (£${upgrade.price_gbp}/mo) to add more students.`;
  }
  if (remaining === 1) {
    return `Just 1 spot left — upgrade to ${upgrade.name} (£${upgrade.price_gbp}/mo) before you hit your limit.`;
  }
  if (studentUsageUrgency(current, limit) === 'warning') {
    return `Getting close to your limit — upgrade to ${upgrade.name} (£${upgrade.price_gbp}/mo) for more room to grow.`;
  }
  return `Unlock unlimited students + invoicing from £${upgrade.price_gbp}/mo.`;
}

// ---------------------------------------------------------------------------
// A "business name" only really means something once there's an actual
// multi-instructor business to name — Franchise tier. Every tier gets an
// auto-generated business_name in the database (required, NOT NULL), but
// showing that invented name to a solo Starter/Growth/Pro instructor implies
// a formality that isn't there. Below Franchise, show who they actually are
// instead: their own name and ADI number.
export function schoolDisplayName(
  tier: string | null | undefined,
  businessName: string | null | undefined,
  instructorName: string | null | undefined,
  adiNumber: string | null | undefined,
): string {
  if (tier === 'franchise' && businessName) return businessName;
  if (instructorName) return adiNumber ? `${instructorName} · ADI #${adiNumber}` : instructorName;
  return businessName || 'Your driving school';
}

