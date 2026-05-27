import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { theme } from '../src/theme';

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
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const current = segments[segments.length - 1] || '';
    const isPublic = PUBLIC_ROUTES.has(current);
    if (!user && !isPublic) {
      router.replace('/sign-up-login-screen');
    } else if (user && (current === AUTH_ROUTE || current === '' || current === 'index')) {
      // Only auto-redirect signed-in users away from the SIGN-IN route, not
      // forgot/reset — they may legitimately be there to change their password.
      if (user.role === 'instructor') router.replace('/home-screen');
      else router.replace('/student-home-screen');
    }
  }, [user, loading, segments]);

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
