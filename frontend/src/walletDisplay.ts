// How a student's prepaid balance is shown to their instructor. Pure logic, no
// I/O, so the rules are unit-tested (see __tests__/walletDisplay.test.ts).

// Below this many prepaid hours a student is "running low". Also drives the
// Students list "Low credit" tile, so the tile and the coloured pill agree.
export const LOW_CREDIT_THRESHOLD_HOURS = 2;

export type WalletTone = 'ok' | 'low' | 'none';
export type WalletDisplay = { text: string; tone: WalletTone };

/** 3 -> "3", 1.5 -> "1.5", 0.25 -> "0.3" (one decimal place, no trailing ".0"). */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 10) / 10);
}

/**
 * What to show on a student's row or profile. `managesWallet` is whether the
 * instructor's plan includes block bookings (Pro and above).
 *
 * - Hours left: always shown, on every plan, so an instructor never loses sight
 *   of money a student has already paid.
 * - No hours: shown only where the wallet is available. On Starter nobody can
 *   have prepaid hours, so "No prepaid hours" on every card would be noise.
 * - A balance of zero or below (used more than paid) counts as none.
 */
export function walletDisplay(hours: number | null | undefined, managesWallet: boolean): WalletDisplay | null {
  const h = Number.isFinite(hours as number) ? (hours as number) : 0;
  if (h > 0) {
    return { text: `${formatHours(h)}h prepaid`, tone: h < LOW_CREDIT_THRESHOLD_HOURS ? 'low' : 'ok' };
  }
  return managesWallet ? { text: 'No prepaid hours', tone: 'none' } : null;
}

/** True for a student who still has some prepaid hours, but not many. */
export function isLowCredit(hours: number | null | undefined): boolean {
  const h = Number.isFinite(hours as number) ? (hours as number) : 0;
  return h > 0 && h < LOW_CREDIT_THRESHOLD_HOURS;
}
