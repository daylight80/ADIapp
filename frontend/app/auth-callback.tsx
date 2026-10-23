import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { completeAuthReturn } from '../src/socialAuth';
import { theme } from '../src/theme';

/** Where the emailed sign-in link lands on a phone (adipro://auth-callback#access_token=...): signs in, then goes home. */
export default function AuthCallback() {
  const router = useRouter();
  const url = Linking.useURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    completeAuthReturn(url).then((r) => {
      if (!alive) return;
      if (r.ok) router.replace('/');
      else setError(r.error || "That sign-in link didn't work.");
    });
    return () => { alive = false; };
  }, [url, router]);

  // No address arrived (the link was opened some other way, or has already been used).
  useEffect(() => {
    const t = setTimeout(() => setError((e) => e ?? "That sign-in link didn't work. Ask for a new one."), 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={s.wrap} testID="auth-callback">
      {error ? (
        <>
          <Text style={s.text} testID="auth-callback-error">{error}</Text>
          <TouchableOpacity style={s.btn} onPress={() => router.replace('/sign-up-login-screen')} testID="auth-callback-back">
            <Text style={s.btnText}>Back to sign in</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={s.text}>Signing you in…</Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: theme.colors.background },
  text: { fontSize: 15, color: theme.colors.text, textAlign: 'center' },
  btn: { minHeight: 48, paddingHorizontal: 22, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
