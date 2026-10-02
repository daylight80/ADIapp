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
