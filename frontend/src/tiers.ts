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
    blurb: 'For new instructors getting set up.',
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
