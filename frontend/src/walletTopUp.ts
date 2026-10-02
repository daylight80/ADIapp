// Adding prepaid hours to a student's wallet, from the instructor's side.
// Pure logic, no I/O, so it is unit-tested (see __tests__/walletTopUp.test.ts).
//
// The instructor picks a number of hours in whole-hour steps and how the
// student paid. The money amount is worked out as hours x the student's hourly
// rate (agreed with Grant, 2 Oct 2026), because the app counts a block's amount
// as payment received when it works out who owes money.
import { formatHoursLabel } from './voucher';
import { raceTimeout } from './withTimeout';

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

// ---------------------------------------------------------------------------
// Saving safely: a time limit, and no double-adds.
//
// The save used to have no time limit, so a stalled request left the sheet on
// a spinner with no way out. It now gives up after WALLET_SAVE_TIMEOUT_MS. But
// a request that "timed out" may still have landed on the server, and a naive
// retry would then add the hours twice. So each attempt carries its own ID
// (newAttemptId), reused for every retry of that attempt: if the first try did
// land, the retry is refused as a duplicate, which classifyTopUpError reports
// as 'duplicate' (already added) rather than as a failure.
// ---------------------------------------------------------------------------
export const WALLET_SAVE_TIMEOUT_MS = 15000;

export const TOP_UP_SLOW_MESSAGE =
  "Couldn't confirm the hours were added because it's taking longer than expected. " +
  "Check Prepaid hours below. If they're not there, tap Add again: it won't add them twice.";

export type TopUpFailure = { kind: 'timeout' | 'duplicate' | 'other'; message: string };

/** Works out what a failed save means for the instructor. */
export function classifyTopUpError(e: unknown): TopUpFailure {
  const err = e as any;
  if (err?.name === 'TimeoutError') {
    return { kind: 'timeout', message: TOP_UP_SLOW_MESSAGE };
  }
  const code = typeof err?.code === 'string' ? err.code : '';
  const text = typeof err?.message === 'string' ? err.message : '';
  if (code === '23505' || /duplicate key/i.test(text)) {
    return { kind: 'duplicate', message: 'Those hours were already added.' };
  }
  return { kind: 'other', message: text.trim() || 'Could not add the hours. Please try again.' };
}

/**
 * A random v4 UUID, used to tell one top-up attempt from another. Uses the
 * platform's own generator where there is one; the fallback is fine because
 * this only has to be unique, not secret.
 */
export function newAttemptId(): string {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type TopUpResult =
  | { status: 'saved' }
  | { status: 'already'; message: string }
  | { status: 'timeout' | 'failed'; message: string };

/**
 * Runs one save with the time limit and says what happened. 'already' means an
 * earlier try with the same attempt id had landed after all, so there is
 * nothing more to add. 'timeout' means it is unconfirmed (it may still land),
 * and the same attempt id makes it safe to try again.
 */
export async function runTopUp(save: () => Promise<unknown>, timeoutMs: number = WALLET_SAVE_TIMEOUT_MS): Promise<TopUpResult> {
  try {
    await raceTimeout(save(), timeoutMs);
    return { status: 'saved' };
  } catch (e) {
    const failure = classifyTopUpError(e);
    if (failure.kind === 'duplicate') return { status: 'already', message: failure.message };
    return { status: failure.kind === 'timeout' ? 'timeout' : 'failed', message: failure.message };
  }
}
