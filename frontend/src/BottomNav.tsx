import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { theme } from './theme';
import { Home, CalendarDays, Users, BookOpen, FileCheck, User, LogOut } from 'lucide-react-native';
import { useAuth } from './AuthContext';

type Tab = { key: string; label: string; icon: any; route: string };

const INSTRUCTOR_TABS: Tab[] = [
  { key: 'home', label: 'Home', icon: Home, route: '/home-screen' },
  { key: 'diary', label: 'Diary', icon: CalendarDays, route: '/lesson-diary-screen' },
  { key: 'students', label: 'Students', icon: Users, route: '/student-crm-screen' },
  { key: 'logout', label: 'Logout', icon: LogOut, route: '' },
];

const STUDENT_TABS: Tab[] = [
  { key: 'learning', label: 'My Learning', icon: BookOpen, route: '/student-home-screen' },
  { key: 'mock', label: 'Mock Test', icon: FileCheck, route: '/dl25-mock-test-screen' },
  { key: 'profile', label: 'Profile', icon: User, route: '/profile-screen' },
  { key: 'logout', label: 'Logout', icon: LogOut, route: '' },
];

export function BottomNav({ role }: { role: 'instructor' | 'student' }) {
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuth();
  const tabs = role === 'instructor' ? INSTRUCTOR_TABS : STUDENT_TABS;

  // Logout (10 Sept 2026), per Grant directly — a 4th, special-cased tab
  // rather than a real route: it has no persistent screen of its own, so
  // the usual pathname === t.route active-state check doesn't apply to
  // it, and tapping it signs out instead of navigating. Confirms first,
  // since this sits right next to three ordinary navigation taps and a
  // single mis-tap shouldn't sign someone out with no way back.
  const handleLogout = () => {
    Alert.alert('Log out?', 'You\u2019ll need to sign in again to get back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <View style={styles.container} testID={`bottom-nav-${role}`}>
      {tabs.map((t) => {
        const active = t.key !== 'logout' && pathname === t.route;
        const Icon = t.icon;
        const isStudentsCta = role === 'instructor' && t.key === 'students';
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tab}
            onPress={() => (t.key === 'logout' ? handleLogout() : router.replace(t.route as any))}
            testID={`nav-${t.key}`}
            activeOpacity={0.7}
          >
            <Icon
              size={22}
              color={
                isStudentsCta
                  ? theme.colors.accent
                  : active
                  ? theme.colors.primary
                  : theme.colors.textMuted
              }
            />
            <Text
              style={[
                styles.label,
                {
                  color: isStudentsCta
                    ? theme.colors.accent
                    : active
                    ? theme.colors.primary
                    : theme.colors.textMuted,
                  fontWeight: active || isStudentsCta ? '700' : '500',
                },
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 48,
  },
  label: { fontSize: 11 },
});
