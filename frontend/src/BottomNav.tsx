import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { theme } from './theme';
import { Home, CalendarDays, Users, BookOpen, FileCheck, User } from 'lucide-react-native';

type Tab = { key: string; label: string; icon: any; route: string };

const INSTRUCTOR_TABS: Tab[] = [
  { key: 'home', label: 'Home', icon: Home, route: '/home-screen' },
  { key: 'diary', label: 'Diary', icon: CalendarDays, route: '/lesson-diary-screen' },
  { key: 'students', label: 'Students', icon: Users, route: '/student-crm-screen' },
];

const STUDENT_TABS: Tab[] = [
  { key: 'learning', label: 'My Learning', icon: BookOpen, route: '/student-home-screen' },
  { key: 'mock', label: 'Mock Test', icon: FileCheck, route: '/dl25-mock-test-screen' },
  { key: 'profile', label: 'Profile', icon: User, route: '/profile-screen' },
];

export function BottomNav({ role }: { role: 'instructor' | 'student' }) {
  const router = useRouter();
  const pathname = usePathname();
  const tabs = role === 'instructor' ? INSTRUCTOR_TABS : STUDENT_TABS;

  return (
    <View style={styles.container} testID={`bottom-nav-${role}`}>
      {tabs.map((t) => {
        const active = pathname === t.route;
        const Icon = t.icon;
        const isStudentsCta = role === 'instructor' && t.key === 'students';
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tab}
            onPress={() => router.replace(t.route as any)}
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
