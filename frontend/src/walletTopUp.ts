// Adding prepaid hours to a student's wallet, from the instructor's side.
// Pure logic, no I/O, so it is unit-tested (see __tests__/walletTopUp.test.ts).
//
// The instructor picks a number of hours in whole-hour steps and how the
// student paid. The money amount is worked out as hours x the student's hourly
// rate (agreed with Grant, 2 Oct 2026), because the app counts a block's amount
// as payment received when it works out who owes money.
import { formatHoursLabel } from './voucher';

export const MIN_ADD_HOURS = 1;
export const MAX_ADD_HOURS = 100;
export const ADD_HOURS_STEP = 1;

export type PaymentMethod = 'bank_transfer' | 'card' | 'cash';

export const PAYMENT_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: 'bank_transfer', label: 'Bank Transfer' },
  { key: 'card', label: 'Card' },
  { key: 'cash', label: 'Cash' },
];

export function paymentMethodLabel(m: PaymentMethod): string {
  return PAYMENT_METHODS.find((p) => p.key === m)?.label ?? m;
}

/** Keeps a number of hours whole and inside the allowed range. Anything unusable becomes the minimum. */
export function clampAddHours(n: number): number {
  if (!Number.isFinite(n)) return MIN_ADD_HOURS;
  return Math.min(MAX_ADD_HOURS, Math.max(MIN_ADD_HOURS, Math.round(n)));
}

/** One step up (+1) or down (-1), never leaving the allowed range. */
export function stepAddHours(current: number, direction: 1 | -1): number {
  return clampAddHours(clampAddHours(current) + direction * ADD_HOURS_STEP);
}

/** hours x rate, to the penny. A missing, negative or non-numeric rate gives 0 rather than a nonsense amount. */
export function topUpAmount(hours: number, ratePerHour: number | null | undefined): number {
  const rate = Number(ratePerHour);
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.round(clampAddHours(hours) * rate * 100) / 100;
}

/** 114 -> "£114", 114.5 -> "£114.50". */
export function formatMoney(n: number): string {
  return Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`;
}

/** "3 hours at £38/hr = £114" */
export function describeTopUp(hours: number, ratePerHour: number | null | undefined): string {
  const h = clampAddHours(hours);
  const rate = Number(ratePerHour);
  const shownRate = Number.isFinite(rate) && rate >= 0 ? rate : 0;
  return `${formatHoursLabel(h)} at ${formatMoney(shownRate)}/hr = ${formatMoney(topUpAmount(h, ratePerHour))}`;
}

/** The line shown once the hours have been added. */
export function topUpConfirmation(studentName: string, hours: number, amount: number, method: PaymentMethod): string {
  return `${formatHoursLabel(hours)} added to ${studentName}'s wallet (${formatMoney(amount)}, ${paymentMethodLabel(method)}).`;
}

/** The Add button is only enabled once a payment method is chosen and there is a student to add to. */
export function canAddHours(studentId: string | null | undefined, method: PaymentMethod | null): boolean {
  return !!studentId && method !== null;
}
