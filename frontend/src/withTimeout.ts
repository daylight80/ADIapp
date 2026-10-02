// Extracted from biometrics.ts (23 Sept 2026) into its own shared file —
// that was the first genuine need for this exact pattern (a native
// biometric call that could hang forever with zero timeout and zero
// recovery path), useStudents()/useStudent() below are the second, and
// two independent needs for the same fix is the signal this belongs
// somewhere shared rather than copied a second time.
//
// Wraps a promise that might never settle (a native call, a network
// request with no built-in timeout) so callers always get SOME answer
// within a bounded time, even if the underlying promise itself never
// resolves or rejects. This is deliberately a last-resort safety net,
// not a substitute for fixing a genuinely slow operation — see each
// call site's own comment for why that specific hang was judged
// plausible enough to guard against.
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

// ---------------------------------------------------------------------------
// raceTimeout — for data loads, where the caller needs to know WHY it failed.
//
// withTimeout above answers with a fallback for a stall AND for a real error,
// so a refused or failed request looks exactly like a slow one. That is right
// for biometrics (any failure means "fall back to the password screen") but
// wrong for loading data: "permission denied" must not read as "taking longer
// than expected". raceTimeout rejects with a TimeoutError only for a genuine
// stall; a real result or a real error passes straight through untouched.
// ---------------------------------------------------------------------------
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function isTimeoutError(e: unknown): e is TimeoutError {
  return e instanceof TimeoutError || (typeof e === 'object' && e !== null && (e as any).name === 'TimeoutError');
}

export const SLOW_LOAD_MESSAGE = 'Taking longer than expected. Check your connection and try again.';

/** The text to show for a failed load: a stall gets the slow-connection message, a real error keeps its own. */
export function loadErrorMessage(e: unknown, fallback: string): string {
  if (isTimeoutError(e)) return SLOW_LOAD_MESSAGE;
  const msg = typeof e === 'object' && e !== null ? (e as any).message : undefined;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

export function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
