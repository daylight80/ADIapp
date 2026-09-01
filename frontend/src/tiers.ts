// Single source of truth for the four subscription tiers.
// Prices in GBP, monthly. Keep in sync with /app/supabase/migrations/003_subscription_tiers.sql
// and the Stripe products in your dashboard.

import { supabase } from './supabaseClient';

export type Tier = 'starter' | 'growth' | 'pro' | 'franchise';

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
    id: 'growth',
    name: 'Growth',
    price_gbp: 14.99,
    student_limit: 15,
    instructor_limit: 1,
    blurb: 'For solo ADIs scaling their lesson book.',
    features: [
      'Up to 15 active students',
      'Everything in Starter',
      'DVSA competency tracker',
      'KPI dashboard & PDF invoices',
      'Pro features: lesson reminders, push notifications',
      'Traffic-aware travel time auto-suggest',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price_gbp: 24.99,
    student_limit: null,
    instructor_limit: 1,
    blurb: 'Single-instructor — your own RHD vehicle.',
    features: [
      'Unlimited active students',
      'Everything in Growth',
      'Block booking & wallet management',
      'Priority email support',
    ],
    recommended: true,
  },
  {
    id: 'franchise',
    name: 'Franchise',
    price_gbp: 39.99,
    per_seat_gbp: 10.0,
    student_limit: null,
    instructor_limit: null,
    blurb: 'Multi-car driving schools — billed per seat.',
    features: [
      'Unlimited students across the fleet',
      'Unlimited instructors (£10 / seat after the first)',
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
  return tier === 'growth' || tier === 'pro' || tier === 'franchise';
}

// For features genuinely exclusive to the top tier — e.g. multi-instructor
// student assignment management, which only makes sense with more than one
// instructor in the first place.
export function isFranchiseTier(tier: string | null | undefined): boolean {
  return tier === 'franchise';
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
  const growth = tierById('growth');
  const remaining = limit - current;
  if (remaining <= 0) {
    return `You've reached your limit — upgrade to ${growth.name} (£${growth.price_gbp}/mo) to add more students.`;
  }
  if (remaining === 1) {
    return `Just 1 spot left — upgrade to ${growth.name} (£${growth.price_gbp}/mo) before you hit your limit.`;
  }
  if (studentUsageUrgency(current, limit) === 'warning') {
    return `Getting close to your limit — upgrade to ${growth.name} (£${growth.price_gbp}/mo) for more room to grow.`;
  }
  return `Unlock more students + invoicing from £${growth.price_gbp}/mo.`;
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

