// Leaves a trace in Sentry when a list fails to load or the login can't be renewed. Until now a stalled load
// threw nothing, so a blank Diary or Students screen left no record at all. Reports carry no personal data:
// only the screen, how long the wait was, how long the app had been in the background, and a short reason.
import { reportError, reportNote } from './errorReporting';
import { isTimeoutError } from './withTimeout';

/** The same area is reported at most once in this long, so a retry loop can't flood Sentry. */
export const REPORT_COOLDOWN_MS = 5 * 60 * 1000;

let lastReturn: { at: number; awayMs: number } | null = null;
const lastReported = new Map<string, number>();

/** Called when the app comes back to the foreground after being away. */
export function noteReturnFromBackground(awayMs: number, now: number = Date.now()): void {
  lastReturn = { at: now, awayMs };
}

const seconds = (ms: number) => Math.round(ms / 1000);

/** What the app was doing just before: how long ago it came back from the background, and how long it was away. */
export function describeRecentContext(now: number = Date.now()): string {
  if (!lastReturn) return 'no recent return from background';
  return `returned from background ${seconds(now - lastReturn.at)}s ago after ${seconds(lastReturn.awayMs)}s away`;
}

/** Whether this area may be reported now (and records that it was). */
export function shouldReport(area: string, now: number = Date.now()): boolean {
  const last = lastReported.get(area);
  if (last != null && now - last < REPORT_COOLDOWN_MS) return false;
  lastReported.set(area, now);
  return true;
}

/**
 * A list failed to load. A stall (timeout) is reported as a note with the context; any other failure
 * (permission denied, a bad response) is reported as an error. Never throws.
 */
export function reportLoadFailure(area: string, error: unknown, waitedMs: number, now: number = Date.now()): void {
  try {
    if (!shouldReport(area, now)) return;
    if (isTimeoutError(error)) {
      reportNote(`${area} did not load within ${seconds(waitedMs)}s; ${describeRecentContext(now)}`, `load-stall:${area}`);
    } else {
      reportError(error, `load-failure:${area}`);
    }
  } catch { /* reporting must never get in the way */ }
}

/** The login could not be renewed when the app came back. */
export function reportResumeProblem(error: unknown, now: number = Date.now()): void {
  try {
    if (!shouldReport('resume', now)) return;
    if (isTimeoutError(error)) {
      reportNote(`Login renewal on return timed out; ${describeRecentContext(now)}`, 'auth-resume');
    } else {
      reportError(error, 'auth-resume');
    }
  } catch { /* ignore */ }
}

/** For tests. */
export function resetStallReportForTests(): void {
  lastReturn = null;
  lastReported.clear();
}
