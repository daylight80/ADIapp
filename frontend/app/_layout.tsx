import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/AuthContext';
import { isBiometricEnabled, authenticateWithBiometrics } from '../src/biometrics';
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { theme } from '../src/theme';
import { useFonts, Archivo_800ExtraBold, Archivo_700Bold } from '@expo-google-fonts/archivo';
import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';

const AUTH_ROUTE = 'sign-up-login-screen';
// Routes that don't require an authenticated session. The forgot/reset
// password screens must be reachable when the user is signed out, and the
// reset screen also runs in a brief recovery-session state where we still
// want to keep them on this page rather than bouncing to home.
const PUBLIC_ROUTES = new Set<string>([
  AUTH_ROUTE,
  'forgot-password-screen',
  'reset-password-screen',
]);

function AuthGate() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const params = useLocalSearchParams();
  const inviteToken = (params.invite as string) || '';

  // Biometric app-unlock (3 Sept 2026), per Grant directly — opt-in,
  // sitting entirely on top of the session-restore flow above (not a new
  // Supabase auth method). null means "still checking whether it's even
  // enabled" — deliberately distinct from false, so there's no one-frame
  // flash of unlocked app content before that check resolves. Reset back
  // to null whenever the user goes back to being signed-out (rather than
  // staying stuck locked/unlocked from a previous session), so this
  // re-evaluates cleanly on every fresh sign-in too, not just a cold app
  // launch.
  const [biometricLocked, setBiometricLocked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) { setBiometricLocked(null); return; }
    let cancelled = false;
    (async () => {
      const enabled = await isBiometricEnabled();
      if (cancelled) return;
      if (!enabled) { setBiometricLocked(false); return; }
      setBiometricLocked(true);
      const ok = await authenticateWithBiometrics();
      if (cancelled) return;
      if (ok) {
        setBiometricLocked(false);
      } else {
        // Per Grant's direct choice — fall back to normal email/password
        // login on failure or cancel, not a retry loop and not silently
        // waving them through on the still-technically-valid session.
        signOut();
      }
    })();
    return () => { cancelled = true; };
    // Deliberately only re-runs when the signed-in user identity changes
    // (a fresh sign-in), not on every render — this is a once-per-launch
    // (or once-per-sign-in) gate, not something to re-trigger constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (loading) return;
    const current = segments[segments.length - 1] || '';
    const isPublic = PUBLIC_ROUTES.has(current);
    const onRootish = current === AUTH_ROUTE || current === '' || current === 'index';

    // A genuine invite link must always win over "you're already signed
    // in, go to your dashboard" — otherwise opening an invite link while
    // signed in as someone else (a different student, or the inviting
    // instructor testing their own link) just bounces straight back to
    // that existing session's dashboard and the invite is silently
    // dropped. If someone else's session is active, clear it first so the
    // invite is accepted with a clean slate rather than layered under a
    // stale session.
    //
    // Deliberately NOT gated on onRootish (fixed 25 Aug 2026) — on a fresh
    // page load with an already-persisted session, params.invite can take
    // one extra render cycle to populate after the URL loads. If the
    // "already signed in" redirect below fires first (since onRootish was
    // still true at that exact moment, before segments moved), by the time
    // inviteToken finally populates, the current route is no longer
    // "rootish" — so this check would never fire, and the invite gets
    // silently dropped with zero indication anything went wrong. A real
    // invite token should win no matter what route we're currently on.
    if (inviteToken) {
      if (user) {
        signOut().finally(() => router.replace({ pathname: '/sign-up-login-screen', params: { invite: inviteToken } }));
      } else {
        router.replace({ pathname: '/sign-up-login-screen', params: { invite: inviteToken } });
      }
      return;
    }

    if (!user && !isPublic) {
      router.replace('/sign-up-login-screen');
    } else if (user && onRootish) {
      // Only auto-redirect signed-in users away from the SIGN-IN route, not
      // forgot/reset — they may legitimately be there to change their password.
      if (user.role === 'instructor') router.replace('/home-screen');
      else router.replace('/student-home-screen');
    }
  }, [user, loading, segments, inviteToken]);

  if (loading) {
    return (
      <View style={styles.loading} testID="auth-loading">
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (biometricLocked) {
    return (
      <View style={styles.loading} testID="biometric-lock">
        <Text style={styles.lockTitle}>ADI Pro is locked</Text>
        <Text style={styles.lockSub}>Waiting for fingerprint…</Text>
        <TouchableOpacity onPress={() => signOut()} testID="btn-use-password-instead" style={styles.lockFallbackBtn}>
          <Text style={styles.lockFallbackText}>Use password instead</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return null;
}

export default function RootLayout() {
  // Archivo + Barlow — loaded app-wide for the redesigned Lesson Diary
  // trial (a Claude Design handoff, 23 Aug 2026). Every other screen still
  // uses the system font via theme.ts; this doesn't change anything
  // elsewhere. If this becomes the permanent direction across more
  // screens, worth revisiting whether app-wide load-at-startup is still
  // the right call vs. lazy-loading per screen.
  const [fontsLoaded] = useFonts({
    Archivo_800ExtraBold,
    Archivo_700Bold,
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loading} testID="fonts-loading">
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <AuthGate />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          />
          <StatusBar style="dark" />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    zIndex: 1000,
  },
  lockTitle: { fontSize: 19, fontWeight: '700', color: theme.colors.text, marginTop: 14 },
  lockSub: { fontSize: 14, color: theme.colors.textMuted, marginTop: 6 },
  lockFallbackBtn: { marginTop: 28, paddingVertical: 10, paddingHorizontal: 18 },
  lockFallbackText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
});
