import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
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
});
