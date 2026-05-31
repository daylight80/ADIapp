// =============================================================================
// Calendar Feed (.ics) — frontend helpers
// =============================================================================
// Talks to the FastAPI endpoints added under /api/calendar/* to enable, fetch,
// rotate and disable an instructor's personal iCal subscription URL.
// =============================================================================

import { supabase } from './supabaseClient';

export type CalendarStatus = {
  enabled: boolean;
  token: string | null;
  /** Server-rendered relative path, e.g. "/api/calendar/<token>.ics". */
  feed_path: string | null;
};

function backendBase(): string {
  const raw = (process as any).env?.EXPO_PUBLIC_BACKEND_URL || '';
  return String(raw).replace(/\/+$/, '');
}

/** Absolute, share-ready URL the user can paste into Apple/Google Calendar. */
export function absoluteFeedUrl(status: CalendarStatus): string | null {
  if (!status.enabled || !status.feed_path) return null;
  return `${backendBase()}${status.feed_path}`;
}

async function authedRequest(method: 'GET' | 'POST', path: string): Promise<CalendarStatus> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('You are not signed in.');
  const url = `${backendBase()}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await resp.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* keep empty */ }
  if (!resp.ok) {
    const detail = (json && (json.detail || json.error)) || `HTTP ${resp.status}`;
    throw new Error(typeof detail === 'string' ? detail : 'Request failed');
  }
  return {
    enabled: !!json.enabled,
    token: json.token ?? null,
    feed_path: json.feed_path ?? null,
  };
}

export const calendarApi = {
  status:      () => authedRequest('GET',  '/api/calendar/status'),
  enable:      () => authedRequest('POST', '/api/calendar/enable'),
  regenerate:  () => authedRequest('POST', '/api/calendar/regenerate'),
  disable:     () => authedRequest('POST', '/api/calendar/disable'),
};
