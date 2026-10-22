import { supabase } from './supabaseClient';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

/**
 * Calls one of the backend's Supabase-authenticated endpoints with the signed-in user's token. Throws an Error whose
 * message is the backend's own reason (so it can be shown to the instructor), or "Not signed in".
 */
export async function callBackend<T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const resp = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(typeof json?.detail === 'string' ? json.detail : `Something went wrong (HTTP ${resp.status}).`);
  return json as T;
}
