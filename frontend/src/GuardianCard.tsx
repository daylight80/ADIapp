import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Phone, Mail, UserRound } from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { hasGuardian, telHref } from './guardianDetails';

type Guardian = { guardian_name?: string | null; guardian_phone?: string | null; guardian_email?: string | null };

/**
 * A pupil's parent or guardian contact (for pupils under 18), shown on the instructor's view of the
 * profile with call and email buttons. With nothing recorded it just offers to add them.
 */
export function GuardianCard({ student, onEdit }: { student: Guardian; onEdit: () => void }) {
  const open = (url: string) => { Linking.openURL(url).catch(() => {}); };

  if (!hasGuardian(student)) {
    return (
      <Card style={{ gap: 6 }} testID="guardian-card">
        <Text style={styles.title}>Parent / guardian</Text>
        <Text style={styles.hint}>For pupils under 18, add a parent or guardian to contact.</Text>
        <TouchableOpacity onPress={onEdit} testID="btn-add-guardian" style={{ paddingVertical: 6 }}>
          <Text style={styles.link}>Add parent / guardian</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  return (
    <Card style={{ gap: 10 }} testID="guardian-card">
      <View style={styles.header}>
        <Text style={styles.title}>Parent / guardian</Text>
        <TouchableOpacity onPress={onEdit} testID="btn-edit-guardian"><Text style={styles.link}>Edit</Text></TouchableOpacity>
      </View>
      <View style={styles.row}>
        <UserRound size={16} color={theme.colors.textMuted} />
        <Text style={styles.name} testID="guardian-name">{student.guardian_name}</Text>
      </View>
      {!!student.guardian_phone && (
        <TouchableOpacity style={styles.row} onPress={() => open(telHref(student.guardian_phone!))} testID="guardian-phone">
          <Phone size={16} color={theme.colors.primary} />
          <Text style={styles.contact}>{student.guardian_phone}</Text>
        </TouchableOpacity>
      )}
      {!!student.guardian_email && (
        <TouchableOpacity style={styles.row} onPress={() => open(`mailto:${student.guardian_email}`)} testID="guardian-email">
          <Mail size={16} color={theme.colors.primary} />
          <Text style={styles.contact}>{student.guardian_email}</Text>
        </TouchableOpacity>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 12.5, color: theme.colors.textMuted },
  link: { color: theme.colors.primary, fontWeight: '700', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  contact: { fontSize: 15, color: theme.colors.primary },
});
