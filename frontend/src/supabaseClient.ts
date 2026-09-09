// Supabase client — single instance shared across the app.
// Uses public anon key (safe to ship) + EXPO_PUBLIC_SUPABASE_URL.
// Session is persisted via SecureStore on native and localStorage on web.

import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Fallback values (3 Sept 2026) — the primary source is still
// process.env.EXPO_PUBLIC_SUPABASE_URL/ANON_KEY above, correctly set on
// EAS for every environment (confirmed directly via `eas env:list
// --environment preview`, showing a genuine https:// URL and a real
// JWT). Despite that, a standalone preview APK crashed on launch with
// "Invalid supabaseUrl" — the correctly-configured values simply
// weren't making it into the compiled JS bundle for reasons that
// couldn't be conclusively pinned down without deeper EAS-side access
// than is available here. The anon key is explicitly designed to be
// public and safe to ship — Supabase's own security model relies on
// Row Level Security, not on hiding this value — so hardcoding it as a
// fallback (used only if the env var is somehow genuinely absent) is a
// safe, pragmatic way to guarantee the app can never crash on this
// again, regardless of how EAS's env-var injection behaves on any
// given build.
const FALLBACK_SUPABASE_URL = 'https://otqokumouwrwyylpruqt.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90cW9rdW1vdXdyd3l5bHBydXF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTEyMTQsImV4cCI6MjA5NDc4NzIxNH0.pjv54vvguXiNTTm5fAVnB88PYcAxhBDyhH89eT8Ybhk';

// Genuinely validates the value looks like a real http(s) URL, rather than
// just checking truthiness (3 Sept 2026, 2nd pass at this fix) — the
// first pass used a plain `||`, which still crashed identically on a
// real device. Root-caused why: process.env.EXPO_PUBLIC_SUPABASE_URL was
// resolving to the literal string "undefined" (text, not the real JS
// undefined value) — a known Metro/bundler substitution gotcha when an
// EXPO_PUBLIC_* var isn't actually present at bundle time. That string is
// truthy, so `|| FALLBACK` never triggered, and createClient() still got
// handed that literal "undefined" text as the URL. Checking for a genuine
// http(s) prefix catches this case too, not just empty/missing.
//
// 3rd pass (9 Sept 2026) — a fresh adb logcat capture showed the *real*
// culprit this time: EXPO_PUBLIC_SUPABASE_URL was genuinely present and
// otherwise correct, but with a single stray, invisible control
// character (U+0016) glued onto the very front of it — "\u0016https://
// ...supabase.co", confirmed directly from the app's own diagnostic
// warning below. The URL happened to survive via the fallback (the
// http(s) prefix check correctly rejected it), but the anon key's check
// below was only a truthiness check, not a real format check — so if the
// exact same stray character was prepended to the key too, it would have
// sailed straight through unsanitized, been sent to Supabase as a
// corrupted key, and the resulting rejection is consistent with the
// "unexpected end of input" JSON parse error Grant hit. Rather than
// reject-and-fallback (which risks silently running on a stale hardcoded
// key if Grant ever rotates it), strip any stray leading/trailing control
// characters from both values first, so the genuinely correct
// EAS-configured values can still be recovered and used.
function sanitizeEnvValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return value;
  // eslint-disable-next-line no-control-regex
  return value.replace(/^[\x00-\x1F\x7F]+|[\x00-\x1F\x7F]+$/g, '');
}

function isValidHttpUrl(value: string | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

const rawUrl = sanitizeEnvValue(process.env.EXPO_PUBLIC_SUPABASE_URL);
const rawAnonKey = sanitizeEnvValue(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

const SUPABASE_URL = isValidHttpUrl(rawUrl) ? rawUrl : FALLBACK_SUPABASE_URL;
const SUPABASE_ANON_KEY = (rawAnonKey && rawAnonKey !== 'undefined' && rawAnonKey.length > 20)
  ? rawAnonKey
  : FALLBACK_SUPABASE_ANON_KEY;

// Polyfill WebSocket on Node < 22 (Metro SSR pass).
// Without this, supabase-js Realtime fails on the SSR render. In the browser
// and on native, the global WebSocket is already defined and this no-ops.
if (typeof (globalThis as any).WebSocket === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (globalThis as any).WebSocket = require('ws');
  } catch {
    /* not available — realtime simply won't connect during SSR, fine for now */
  }
}

// Native: bridge expo-secure-store into the AsyncStorage shape Supabase wants.
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// Web: localStorage is auto-used when no storage is supplied (handled by SDK).
const storage = Platform.OS === 'web' ? undefined : (SecureStoreAdapter as any);

if (process.env.EXPO_PUBLIC_SUPABASE_URL !== rawUrl || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== rawAnonKey) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] Raw env value had stray characters, sanitized. Raw URL seen: ' + JSON.stringify(process.env.EXPO_PUBLIC_SUPABASE_URL));
}
if (SUPABASE_URL === FALLBACK_SUPABASE_URL || SUPABASE_ANON_KEY === FALLBACK_SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing or invalid even after sanitizing — using hardcoded fallback values. Raw URL value seen: ' + JSON.stringify(process.env.EXPO_PUBLIC_SUPABASE_URL));
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
  // Realtime isn't used in Wave-2 yet — keep events minimal so the SDK doesn't
  // try to open extra websockets during SSR.
  realtime: { params: { eventsPerSecond: 1 } },
});

// Convenience: tiny "is configured?" check used by callers that want to fall
// back to mockDb until the migration is rolled out.
export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
