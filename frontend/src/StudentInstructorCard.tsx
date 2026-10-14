import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Phone, Mail, IdCard, Copy } from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { copyToClipboard } from './tools';
import type { AgreementContext } from './agreementTerms';

/**
 * A pupil's own instructor: name, phone, email and ADI number. The details come from
 * my_pupil_agreement_context() (a pupil cannot read the instructors table). This card
 * used to show a hard-coded demo instructor (ADI 123456) from mockDb.
 */
export function StudentInstructorCard({
  instructor, loadFailed,
}: { instructor: AgreementContext | null; loadFailed: boolean }) {
  const [copied, setCopied] = useState(false);

  if (!instructor) {
    return loadFailed ? (
      <Card testID="student-instructor-error">
        <Text style={styles.hint}>Couldn&apos;t load your instructor&apos;s details. Check your connection and reopen this page.</Text>
      </Card>
    ) : null;
  }

  const copyAdi = () => {
    if (!instructor.adi_number) return;
    copyToClipboard(instructor.adi_number);
    // On the page, not an Alert: Alert.alert does nothing in a browser.
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Card style={{ gap: 12 }} testID="student-instructor-card">
      <View>
        <Text style={styles.hint}>YOUR INSTRUCTOR</Text>
        <Text style={styles.name} testID="instructor-name">{instructor.instructor_name || 'Your instructor'}</Text>
        {!!instructor.business_name && <Text style={styles.sub}>{instructor.business_name}</Text>}
      </View>
      {!!instructor.contact_phone && (
        <TouchableOpacity
          style={styles.row}
          onPress={() => Linking.openURL(`tel:${instructor.contact_phone!.replace(/\s+/g, '')}`)}
          testID="instructor-phone"
        >
          <Phone size={18} color={theme.colors.primary} />
          <Text style={styles.link}>{instructor.contact_phone}</Text>
        </TouchableOpacity>
      )}
      {!!instructor.contact_email && (
        <TouchableOpacity
          style={styles.row}
          onPress={() => Linking.openURL(`mailto:${instructor.contact_email}`)}
          testID="instructor-email"
        >
          <Mail size={18} color={theme.colors.primary} />
          <Text style={[styles.link, { flex: 1 }]} numberOfLines={1}>{instructor.contact_email}</Text>
        </TouchableOpacity>
      )}
      {!!instructor.adi_number && (
        <>
          <View style={styles.row}>
            <IdCard size={18} color={theme.colors.primary} />
            <Text style={styles.title}>Instructor&apos;s ADI number</Text>
          </View>
          <View style={styles.adiRow}>
            <Text style={styles.adiValue} testID="adi-value">{instructor.adi_number}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={copyAdi} testID="btn-copy-adi">
              <Copy size={14} color="#fff" />
              <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Paste this into the DVSA booking site to link your instructor.</Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  hint: { color: theme.colors.textMuted, fontSize: 12 },
  name: { fontSize: 20, fontWeight: '700', color: theme.colors.text, marginTop: 2 },
  sub: { fontSize: 12.5, color: theme.colors.textMuted, marginTop: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  link: { color: theme.colors.primary, fontSize: 14, fontWeight: '600' },
  title: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  adiRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  adiValue: { flex: 1, fontSize: 18, fontWeight: '700', color: theme.colors.primary, letterSpacing: 2 },
  copyBtn: { backgroundColor: theme.colors.primary, paddingHorizontal: 16, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  copyText: { color: '#fff', fontWeight: '700' },
});
