// Supabase client — single instance shared across the app.
// Uses public anon key (safe to ship) + EXPO_PUBLIC_SUPABASE_URL.
// Session is persisted via SecureStore on native and localStorage on web.

import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Native: bridge expo-secure-store into the AsyncStorage shape Supabase wants.
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// Web: localStorage is auto-used when no storage is supplied (handled by SDK).
const storage = Platform.OS === 'web' ? undefined : (SecureStoreAdapter as any);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is not set');
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Convenience: tiny "is configured?" check used by callers that want to fall
// back to mockDb until the migration is rolled out.
export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
