// Pricing & packages: the instructor's default hourly rate, applying a changed rate to existing pupils, and
// using a package when adding hours to a pupil's wallet. Pure logic, no I/O, so it is unit-tested
// (see __tests__/pricing.test.ts).
import { formatGbp } from './payments';

export const MAX_HOURLY_RATE = 500;

/** What was typed as an hourly rate, in pounds: "40", "£37.50"; not zero, negative, over 2 decimals or over the maximum. */
export function parseRate(input: string | null | undefined): number | null {
  const t = (input || '').replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  if (!(n > 0) || n > MAX_HOURLY_RATE) return null;
  return Math.round(n * 100) / 100;
}

/** "£40.00 an hour". */
export function rateLabel(rate: number): string {
  return `${formatGbp(rate)} an hour`;
}

export type RateCount = { rate: number; pupils: number };

export type RateChangeOffer = {
  newRate: number;
  oldRate: number;
  /** pupils on the old rate (they were following the default) */
  onOld: number;
  /** pupils on any other rate that is not the new one (set by hand for them) */
  onOther: number;
  /** everyone not already on the new rate */
  total: number;
  /** a short description of those on other rates, e.g. "£35.00" */
  otherRates: string;
};

/**
 * After the default rate changes: who could be moved to the new one. Pupils already on the new rate need
 * nothing; pupils on the old rate were following the default; pupils on any other rate had theirs set by hand.
 * Null when nobody needs changing.
 */
export function rateChangeOffer(oldRate: number, newRate: number, counts: RateCount[]): RateChangeOffer | null {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const onOld = counts.filter((c) => near(c.rate, oldRate) && !near(c.rate, newRate)).reduce((s, c) => s + c.pupils, 0);
  const others = counts.filter((c) => !near(c.rate, oldRate) && !near(c.rate, newRate));
  const onOther = others.reduce((s, c) => s + c.pupils, 0);
  const total = onOld + onOther;
  if (total === 0) return null;
  return {
    newRate, oldRate, onOld, onOther, total,
    otherRates: others.map((c) => formatGbp(c.rate)).join(', '),
  };
}

const pupilsWord = (n: number) => `${n} ${n === 1 ? 'pupil is' : 'pupils are'}`;

/** The question put to the instructor after they change the default rate. */
export function rateChangeQuestion(o: RateChangeOffer): string {
  const parts: string[] = [];
  if (o.onOld > 0) parts.push(`${pupilsWord(o.onOld)} on ${formatGbp(o.oldRate)}`);
  if (o.onOther > 0) parts.push(`${o.onOther} on a different rate (${o.otherRates})`);
  return `Your default is now ${formatGbp(o.newRate)}. ${parts.join(' and ')}.`;
}

export const RATE_CHANGE_NOTE = 'Lessons you have already taught keep the price agreed for them.';

export function appliedMessage(changed: number, newRate: number): string {
  return changed === 0
    ? 'No pupils needed changing.'
    : `${changed} ${changed === 1 ? 'pupil' : 'pupils'} moved to ${formatGbp(newRate)} an hour.`;
}

export type PackageLike = { id: string; name: string; hours: number; price: number | null; active: boolean };

/** Packages that can be used to add hours: switched on, with a price and some hours. */
export function usablePackages<T extends PackageLike>(pkgs: T[]): T[] {
  return pkgs.filter((p) => p.active && p.price != null && p.price >= 0 && p.hours > 0);
}

/** Packages that exist but cannot be used yet because they have no price. */
export function packagesNeedingPrice<T extends PackageLike>(pkgs: T[]): T[] {
  return pkgs.filter((p) => p.price == null);
}

export function packagePerHour(p: { hours: number; price: number | null }): number | null {
  return p.price != null && p.hours > 0 ? Math.round((p.price / p.hours) * 100) / 100 : null;
}

/** "10-hour block: 10 hours for £380.00 (£38.00 an hour)" */
export function describePackageTopUp(p: { name: string; hours: number; price: number | null }): string {
  const h = Math.round(p.hours * 100) / 100;
  const per = packagePerHour(p);
  return `${p.name}: ${h} ${h === 1 ? 'hour' : 'hours'} for ${formatGbp(p.price ?? 0)}${per != null ? ` (${formatGbp(per)} an hour)` : ''}`;
}

/** What is saved against the wallet top-up: the package's own hours and price, and a note saying which package. */
export function packageTopUp(p: { name: string; hours: number; price: number | null }): { hours: number; amount: number; notes: string } {
  return {
    hours: Math.round(p.hours * 100) / 100,
    amount: Math.round((p.price ?? 0) * 100) / 100,
    notes: `Package: ${p.name}`.slice(0, 120),
  };
}
