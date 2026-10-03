// The instructor picks one navigation app in Profile; Lesson tools uses just that
// one instead of offering all three on every lesson.
import type { NavApp } from './supabaseDb';

export const NAV_APP_LABELS: Record<NavApp, string> = {
  google: 'Google Maps',
  waze: 'Waze',
  apple: 'Apple Maps',
};

/** Falls back to Google Maps when nothing (or something unrecognised) is stored. */
export function resolveNavApp(preferred: string | null | undefined): NavApp {
  return preferred === 'waze' || preferred === 'apple' ? preferred : 'google';
}

export function navButtonLabel(preferred: string | null | undefined): string {
  return `Navigate in ${NAV_APP_LABELS[resolveNavApp(preferred)]}`;
}
