import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { theme } from '../src/theme';

const AUTH_ROUTE = 'sign-up-login-screen';

function AuthGate() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const current = segments[segments.length - 1] || '';
    const isAuthScreen = current === AUTH_ROUTE;
    if (!user && !isAuthScreen) {
      router.replace('/sign-up-login-screen');
    } else if (user && (isAuthScreen || current === '' || current === 'index')) {
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
