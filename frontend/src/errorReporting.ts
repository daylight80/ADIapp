// The web app's version of error reporting: it does nothing. Sentry is added on the phone
// apps only (errorReporting.native.ts), which keeps it out of the web download.
import type React from 'react';

export function initErrorReporting(): void {}

export function setReportingUser(_id: string | null, _role?: string): void {}

export function withErrorReporting<P extends object>(Component: React.ComponentType<P>): React.ComponentType<P> {
  return Component;
}

export function reportError(_error: unknown, _area: string): void {}

export function reportNote(_message: string, _area: string): void {}
