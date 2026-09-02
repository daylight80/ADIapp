import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, IdCard, Phone, Mail, MapPin } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { useInstructorProfile } from '../src/useSupabaseData';

/**
 * Instructor profile — a dedicated, view-only screen (1 Sept 2026), per
 * Grant directly. Answers a genuine gap found while checking: the
 * existing shared profile-screen.tsx had a name/email in its header card
 * for both roles, but its "ADI number" section was a real, misleading
 * bug — the Save button showed a success alert while only writing to
 * mockDb's in-memory instructorProfile object, never the real database.
 * Address and mobile number had no instructor-facing UI anywhere at all.
 *
 * Deliberately view-only: per Grant, only the owner can change these
 * details, via the existing Add Instructor flow on the owner dashboard
 * (inviteInstructor()) — there is no edit/save action on this screen at
 * all, not even a disabled one, so there's nothing here to mislead
 * anyone the way the old ADI-number field did.
 */
export default function InstructorProfileScreen() {
  const router = useRouter();
  const { profile, loading } = useInstructorProfile();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Instructor profile</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />
        ) : !profile ? (
          <Card>
            <Text style={styles.empty}>Couldn't load your profile. Please try again.</Text>
          </Card>
        ) : (
          <>
            <Card style={{ gap: 4 }}>
              <View style={styles.avatarRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(profile.full_name || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.name} testID="ip-name">{profile.full_name}</Text>
              </View>
            </Card>

            <Card style={{ gap: 12 }}>
              <Text style={styles.cardTitle}>Contact details</Text>
              <Field icon={<IdCard size={16} color={theme.colors.textMuted} />} label="ADI/PDI number" value={profile.adi_number} testID="ip-adi" />
              <Field icon={<Phone size={16} color={theme.colors.textMuted} />} label="Mobile number" value={profile.mobile_number} testID="ip-mobile" />
              <Field icon={<Mail size={16} color={theme.colors.textMuted} />} label="Email" value={profile.email} testID="ip-email" />
              <Field icon={<MapPin size={16} color={theme.colors.textMuted} />} label="Address" value={profile.address} testID="ip-address" />
            </Card>

            <Text style={styles.hint}>
              These details are set by your school owner. To update anything here, ask them to make the change.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ icon, label, value, testID }: { icon: React.ReactNode; label: string; value: string | null; testID: string }) {
  return (
    <View style={styles.fieldRow}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue} testID={testID}>{value || 'Not set'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  scroll: { padding: 16, gap: 14 },
  empty: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', paddingVertical: 12 },

  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  name: { fontSize: 18, fontWeight: '700', color: theme.colors.text },

  cardTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  fieldRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  fieldLabel: { fontSize: 11.5, fontWeight: '600', color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldValue: { fontSize: 14.5, color: theme.colors.text, marginTop: 2 },

  hint: { fontSize: 12.5, color: theme.colors.textMuted, textAlign: 'center', paddingHorizontal: 8, lineHeight: 18 },
});
