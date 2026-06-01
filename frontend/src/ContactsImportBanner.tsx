import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Users, Shield } from 'lucide-react-native';
import { theme } from './theme';
import {
  ContactsImportSheet,
  markContactsImportDismissed,
  isContactsImportDismissed,
} from './ContactsImportSheet';

/**
 * Privacy-first onboarding banner shown on the instructor home screen.
 *
 * Per the user spec:
 *   - Auto-shows when the instructor has 0 imported students AND has never
 *     dismissed the banner before (Migration 014).
 *   - Primary action: prominent ORANGE button "Import Students from Contacts"
 *     → opens the contacts import sheet.
 *   - Secondary action: muted PURPLE text link "I'll Do This Later"
 *     → marks the banner dismissed forever for this instructor (server-side).
 *   - Disclaimer text is rendered in white for high contrast on the gradient.
 *
 * Both CTAs persist a dismissal so the banner doesn't re-show on next login.
 */
export type ContactsImportBannerProps = {
  /** Number of students the instructor currently has. Banner hides when ≥3. */
  studentCount: number;
  /** Whether the current user is an instructor — banner hides otherwise. */
  isInstructor: boolean;
};

export function ContactsImportBanner({ studentCount, isInstructor }: ContactsImportBannerProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hidden, setHidden] = useState<boolean | null>(null);  // null while loading

  useEffect(() => {
    let cancelled = false;
    if (!isInstructor || studentCount >= 3) {
      setHidden(true);
      return;
    }
    isContactsImportDismissed().then((dismissed) => {
      if (!cancelled) setHidden(dismissed);
    });
    return () => { cancelled = true; };
  }, [isInstructor, studentCount]);

  if (hidden === null || hidden) return null;

  const handleImport = () => {
    setSheetOpen(true);
    // Tapping the primary CTA also counts as "handled" — never re-show.
    markContactsImportDismissed();
    setHidden(true);
  };

  const handleLater = () => {
    markContactsImportDismissed();
    setHidden(true);
  };

  return (
    <>
      <View style={styles.banner} testID="contacts-import-banner">
        <View style={styles.iconWrap}>
          <Users size={22} color="#fff" />
        </View>
        <Text style={styles.title}>Import students from your phone</Text>
        <Text style={styles.subtitle}>
          Skip typing them in one by one — pick the learners you teach from your phone Contacts.
        </Text>

        {/* Privacy disclaimer — white text per spec */}
        <View style={styles.disclaimerRow}>
          <Shield size={14} color="#fff" />
          <Text style={styles.disclaimer}>
            You will be asked to grant permission to access your contacts. This is only used to
            import student names and phone numbers.
          </Text>
        </View>

        {/* Primary action — ORANGE button */}
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleImport}
          activeOpacity={0.85}
          testID="btn-banner-import"
        >
          <Text style={styles.primaryBtnText}>Import Students from Contacts</Text>
        </TouchableOpacity>

        {/* Secondary action — muted purple text link */}
        <TouchableOpacity
          style={styles.secondaryLink}
          onPress={handleLater}
          testID="btn-banner-later"
        >
          <Text style={styles.secondaryLinkText}>I’ll Do This Later</Text>
        </TouchableOpacity>
      </View>

      <ContactsImportSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: theme.colors.primary,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    gap: 10,
    // Subtle gradient-feel — slight shadow for elevation.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#fff' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.92)', lineHeight: 19 },
  disclaimerRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingTop: 4,
  },
  disclaimer: {
    flex: 1,
    fontSize: 12,
    color: '#fff',
    lineHeight: 17,
    fontWeight: '500',
  },
  primaryBtn: {
    marginTop: 8,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#F97316',   // Orange-500 — per spec "prominent orange button"
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#9A3412',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.2 },
  secondaryLink: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  // Muted-purple text on the indigo banner — high enough contrast to be
  // readable, low enough to clearly defer to the primary orange CTA.
  secondaryLinkText: {
    color: '#E0E7FF',           // Indigo-100 — soft "muted purple" feel
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
