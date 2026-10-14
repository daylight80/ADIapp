// Crash and error reporting on the phone apps, through Sentry. The web app has its own
// do-nothing version of this file (errorReporting.ts), so the Sentry code is not in the web
// download. Reports nothing while developing, and no personal data: see errorScrub.ts.
import * as Sentry from '@sentry/react-native';
import type React from 'react';
import { scrubBreadcrumb, scrubEvent } from './errorScrub';

// A Sentry DSN is a write-only address for sending reports, designed to ship inside apps.
const SENTRY_DSN = 'https://e1d0e565a4a39de129e999de11e3a71f@o4512253623074816.ingest.de.sentry.io/4512253632512080';

export function initErrorReporting(): void {
  if (__DEV__) return;
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: 'production',
      sendDefaultPii: false,
      // Errors only: no performance traces or session replays.
      tracesSampleRate: 0,
      beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
      beforeSend: (event) => scrubEvent(event),
    });
  } catch {
    // Reporting must never stop the app from starting.
  }
}

/** Tags reports with the signed-in user's id only (never email or name); null when signed out. */
export function setReportingUser(id: string | null, role?: string): void {
  try {
    Sentry.setUser(id ? { id } : null);
    if (role) Sentry.setTag('role', role);
  } catch { /* ignore */ }
}

/** Wraps the root component so errors thrown while rendering are reported. */
export function withErrorReporting<P extends object>(Component: React.ComponentType<P>): React.ComponentType<P> {
  return __DEV__ ? Component : (Sentry.wrap(Component as React.ComponentType<any>) as unknown as React.ComponentType<P>);
}
