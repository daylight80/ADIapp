// Keeps the sign-in alive across the phone's app lifecycle. On a phone the timer that renews the login is
// suspended while the app is in the background, so on coming back the app can be holding an expired login
// and its first requests stall or come back empty (blank Diary and Students, no error). Supabase's own advice
// for React Native is to stop renewing in the background and start again, and renew straight away, on return.
// After a real absence the lists are also reloaded, so a screen left blank by a stalled request fills itself.
import { raceTimeout } from './withTimeout';

/** Away for at least this long before the app renews the login and reloads lists on return. */
export const RESUME_REFRESH_AFTER_MS = 30_000;
/** How long to wait for the login to renew before carrying on regardless. */
export const RESUME_REFRESH_TIMEOUT_MS = 8_000;

type AuthLike = {
  startAutoRefresh: () => Promise<void> | void;
  stopAutoRefresh: () => Promise<void> | void;
  getSession: () => Promise<unknown>;
};

export function createAuthLifecycle(opts: {
  auth: AuthLike;
  /** Called after returning from a real absence, once the login has been renewed (or given up on). */
  onResume?: () => void;
  now?: () => number;
}) {
  const now = opts.now ?? Date.now;
  let leftAt: number | null = null;

  return {
    /** Wire to AppState's 'change' event. 'inactive' (an iOS transition, or a system dialog) is ignored. */
    async onChange(state: string): Promise<void> {
      if (state === 'background') {
        if (leftAt == null) leftAt = now();
        try { await opts.auth.stopAutoRefresh(); } catch { /* nothing to stop */ }
        return;
      }
      if (state !== 'active') return;
      const away = leftAt == null ? 0 : now() - leftAt;
      leftAt = null;
      try { await opts.auth.startAutoRefresh(); } catch { /* it will start on the next change */ }
      if (away < RESUME_REFRESH_AFTER_MS) return;
      try {
        // getSession renews an expired login; bounded so a stuck lock can't hold the app up.
        await raceTimeout(Promise.resolve(opts.auth.getSession()), RESUME_REFRESH_TIMEOUT_MS);
      } catch { /* carry on: lists show their own error with Try again */ }
      opts.onResume?.();
    },
  };
}
