import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Modal } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { theme } from './theme';
import { Home, CalendarDays, Users, BookOpen, FileCheck, User, LogOut } from 'lucide-react-native';
import { useAuth } from './AuthContext';
import { INSTRUCTOR_TAB_SPECS, STUDENT_TAB_SPECS, isTabActive, type TabSpec } from './navTabs';

type Tab = { key: string; label: string; icon: any; route: string };

// Icons by tab key; the tabs themselves (labels and routes) live in navTabs.ts.
const TAB_ICONS: Record<string, any> = {
  home: Home, diary: CalendarDays, students: Users, profile: User, logout: LogOut,
  learning: BookOpen, mock: FileCheck,
};
const withIcons = (specs: TabSpec[]): Tab[] => specs.map((t) => ({ ...t, icon: TAB_ICONS[t.key] }));
const INSTRUCTOR_TABS: Tab[] = withIcons(INSTRUCTOR_TAB_SPECS);
const STUDENT_TABS: Tab[] = withIcons(STUDENT_TAB_SPECS);

export function BottomNav({ role }: { role: 'instructor' | 'student' }) {
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuth();
  const tabs = role === 'instructor' ? INSTRUCTOR_TABS : STUDENT_TABS;
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Logout (10 Sept 2026), per Grant directly — a 4th, special-cased tab
  // rather than a real route: it has no persistent screen of its own, so
  // the usual pathname === t.route active-state check doesn't apply to
  // it, and tapping it signs out instead of navigating.
  //
  // Confirms first via a plain in-app Modal, not Alert.alert() — Grant
  // reported the button doing nothing at all on a real device the first
  // time this shipped with Alert.alert(). Rather than guess at why a
  // system-level dialog API might be silently swallowed on a specific
  // device, switched to the exact same custom-Modal pattern this app
  // already uses elsewhere for confirmations (lesson-diary-screen's drag
  // confirmation), which sidesteps the OS's own alert dialog entirely and
  // is already proven reliable in this codebase.
  return (
    <View style={styles.container} testID={`bottom-nav-${role}`}>
      {tabs.map((t) => {
        const active = isTabActive(t, pathname);
        const Icon = t.icon;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tab}
            onPress={() => (t.key === 'logout' ? setConfirmOpen(true) : router.replace(t.route as any))}
            testID={`nav-${t.key}`}
            activeOpacity={0.7}
          >
            <Icon
              size={22}
              color={active ? theme.colors.accent : theme.colors.textMuted}
            />
            <Text
              style={[
                styles.label,
                {
                  color: active ? theme.colors.accent : theme.colors.textMuted,
                  fontWeight: active ? '700' : '500',
                },
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}

      <Modal
        visible={confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmOpen(false)}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard} testID="logout-confirm-modal">
            <Text style={styles.confirmTitle}>Log out?</Text>
            <Text style={styles.confirmLine}>You'll need to sign in again to get back in.</Text>
            <View style={{ flexDirection: 'row', gap: 9, marginTop: 16 }}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setConfirmOpen(false)}
                testID="logout-confirm-cancel"
              >
                <Text style={styles.confirmCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmOkBtn}
                onPress={() => { setConfirmOpen(false); signOut(); }}
                testID="logout-confirm-ok"
              >
                <Text style={styles.confirmOkBtnText}>Log out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmCard: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.text, marginBottom: 6 },
  confirmLine: { fontSize: 14, color: theme.colors.textMuted, lineHeight: 20 },
  confirmCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  confirmCancelBtnText: { color: theme.colors.text, fontWeight: '600', fontSize: 14 },
  confirmOkBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.colors.danger, alignItems: 'center' },
  confirmOkBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
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
