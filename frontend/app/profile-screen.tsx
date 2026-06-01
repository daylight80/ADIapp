import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut, Mail, Phone, MapPin, Award, Calendar, Crown, ShieldCheck, Wallet, Copy, IdCard, Car, Navigation as NavIcon, Users, FileSpreadsheet } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { mockDb, instructorProfile } from '../src/mockDb';
import { Card, Badge, StatusBadge } from '../src/ui';
import { BottomNav } from '../src/BottomNav';
import { useRouter } from 'expo-router';
import { isPro } from '../src/proPlan';
import { copyToClipboard } from '../src/tools';
import { useInstructorProfile, updatePreferredNavApp } from '../src/useSupabaseData';
import type { NavApp } from '../src/supabaseDb';
import { CalendarFeedCard } from '../src/CalendarFeedCard';
import { ContactsImportSheet } from '../src/ContactsImportSheet';
import { Alert, TextInput } from 'react-native';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const role = user?.role || 'student';
  const student = user?.email ? mockDb.getStudentByEmail(user.email) : undefined;
  const pro = isPro(user?.subscription_status);
  const [adi, setAdi] = useState(instructorProfile.adi_number);

  // Preferred navigation app for the diary's one-tap 🧭 button.
  const { profile: sbInstructor } = useInstructorProfile();
  const [navApp, setNavApp] = useState<NavApp>('google');
  React.useEffect(() => {
    if (sbInstructor?.preferred_nav_app) setNavApp(sbInstructor.preferred_nav_app);
  }, [sbInstructor?.preferred_nav_app]);
  const [savingNav, setSavingNav] = useState(false);
  const [contactsImportOpen, setContactsImportOpen] = useState(false);
  const onPickNavApp = async (app: NavApp) => {
    const prev = navApp;
    setNavApp(app); // optimistic
    setSavingNav(true);
    try {
      await updatePreferredNavApp(app);
    } catch (e: any) {
      setNavApp(prev);
      Alert.alert('Could not save', e?.message || 'Please apply Migration 006 first.');
    } finally {
      setSavingNav(false);
    }
  };

  const saveAdi = () => {
    instructorProfile.adi_number = adi.trim();
    Alert.alert('ADI number saved', `Students can copy this number when booking their test.`);
  };

  const copyAdi = () => {
    if (!instructorProfile.adi_number) {
      Alert.alert('Your instructor has not provided an ADI number yet.');
      return;
    }
    const ok = copyToClipboard(instructorProfile.adi_number);
    Alert.alert(ok ? 'Copied' : 'ADI number', instructorProfile.adi_number);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <View style={styles.row}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.name || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} testID="profile-name">{user?.name || 'User'}</Text>
              <Text style={styles.email}>{user?.email}</Text>
              <View style={{ marginTop: 6 }}>
                <Badge label={role === 'instructor' ? 'Instructor' : 'Student'} />
              </View>
            </View>
          </View>
        </Card>

        {student && (
          <>
            <Card style={{ gap: 10 }}>
              <Text style={styles.cardTitle}>Contact details</Text>
              <Row icon={<Mail size={16} color={theme.colors.textMuted} />} text={student.email} />
              <Row icon={<Phone size={16} color={theme.colors.textMuted} />} text={student.phone} />
              <Row icon={<MapPin size={16} color={theme.colors.textMuted} />} text={`${student.address}, ${student.postcode}`} />
            </Card>

            <Card style={{ gap: 10 }}>
              <Text style={styles.cardTitle}>Learning status</Text>
              <Row icon={<Award size={16} color={theme.colors.accent} />} text={`Progress: ${student.progress}%`} />
              <Row icon={<Calendar size={16} color={theme.colors.primary} />} text={`Lessons completed: ${student.lessons_count}`} />
              <View style={{ flexDirection: 'row' }}>
                <StatusBadge status={student.status} />
              </View>
            </Card>
          </>
        )}

        {role === 'instructor' && (
          <Card style={{ gap: 10 }}>
            <View style={styles.contactRow}>
              <IdCard size={18} color={theme.colors.primary} />
              <Text style={styles.cardTitle}>ADI number</Text>
            </View>
            <Text style={styles.hint}>Your DVSA Approved Driving Instructor number. Students can copy it for the DVSA booking site.</Text>
            <View style={styles.adiRow}>
              <TextInput
                style={styles.adiInput}
                value={adi}
                onChangeText={setAdi}
                placeholder="e.g. 123456"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="numeric"
                testID="input-adi"
              />
              <TouchableOpacity style={styles.adiSave} onPress={saveAdi} testID="btn-save-adi">
                <Text style={styles.adiSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {role === 'student' && instructorProfile.adi_number ? (
          <Card style={{ gap: 10 }}>
            <View style={styles.contactRow}>
              <IdCard size={18} color={theme.colors.primary} />
              <Text style={styles.cardTitle}>Instructor's ADI number</Text>
            </View>
            <View style={styles.adiRow}>
              <Text style={styles.adiValue} testID="adi-value">{instructorProfile.adi_number}</Text>
              <TouchableOpacity style={styles.adiSave} onPress={copyAdi} testID="btn-copy-adi">
                <Copy size={14} color="#fff" />
                <Text style={styles.adiSaveText}>Copy</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>Paste this into the DVSA booking site to link your instructor.</Text>
          </Card>
        ) : null}

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => router.push('/onboarding-tc-screen')}
          testID="link-tc"
        >
          <ShieldCheck size={18} color={theme.colors.primary} />
          <Text style={styles.linkRowText}>
            {instructorProfile.tc_signed_at ? 'Pupil Agreement (signed ✓)' : 'Pupil Agreement — sign now'}
          </Text>
        </TouchableOpacity>

        {role === 'instructor' && (
          <Card style={{ gap: 12, marginTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <NavIcon size={18} color={theme.colors.primary} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.text }}>Default navigation app</Text>
            </View>
            <Text style={{ fontSize: 12, color: theme.colors.textMuted }}>
              The diary's one-tap 🧭 button on each lesson will launch your preferred app.
            </Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {([
                { key: 'google', label: 'Google Maps' },
                { key: 'waze', label: 'Waze' },
                { key: 'apple', label: 'Apple Maps' },
              ] as { key: NavApp; label: string }[]).map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.navChip, navApp === opt.key && styles.navChipActive, savingNav && { opacity: 0.7 }]}
                  onPress={() => onPickNavApp(opt.key)}
                  disabled={savingNav}
                  testID={`navapp-${opt.key}`}
                >
                  <Text style={[styles.navChipText, navApp === opt.key && styles.navChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>
        )}

        {role === 'instructor' && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/vehicles-screen')}
            testID="link-vehicles"
          >
            <Car size={18} color={theme.colors.primary} />
            <Text style={styles.linkRowText}>Manage vehicles</Text>
          </TouchableOpacity>
        )}

        {role === 'instructor' && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/packages-screen' as any)}
            testID="link-packages"
          >
            <Wallet size={18} color={theme.colors.accent} />
            <Text style={styles.linkRowText}>Pricing & packages</Text>
          </TouchableOpacity>
        )}

        {role === 'instructor' && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/income-expense-report-screen' as any)}
            testID="link-income-expense"
          >
            <FileSpreadsheet size={18} color={theme.colors.success} />
            <Text style={styles.linkRowText}>Income & expense report (CSV)</Text>
          </TouchableOpacity>
        )}

        {role === 'instructor' && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => setContactsImportOpen(true)}
            testID="link-import-contacts"
          >
            <Users size={18} color={theme.colors.primary} />
            <Text style={styles.linkRowText}>Import students from Contacts</Text>
          </TouchableOpacity>
        )}

        {role === 'instructor' && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/unavailabilities-screen' as any)}
            testID="link-unavailabilities"
          >
            <Calendar size={18} color={theme.colors.danger} />
            <Text style={styles.linkRowText}>Unavailabilities (time off)</Text>
          </TouchableOpacity>
        )}

        {role === 'instructor' && <CalendarFeedCard />}

        {role === 'student' && student && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push({ pathname: '/wallet-screen', params: { studentId: student.id } })}
            testID="link-wallet"
          >
            <Wallet size={18} color={theme.colors.success} />
            <Text style={styles.linkRowText}>Payment Wallet</Text>
          </TouchableOpacity>
        )}

        {role !== 'student' && (
          <TouchableOpacity
            style={[styles.proCta, pro && styles.proCtaActive]}
            onPress={() => router.push('/pricing-screen')}
            testID="btn-pricing"
          >
            <Crown size={18} color="#fff" />
            <Text style={styles.proCtaText}>{pro ? 'Manage Pro plan' : 'Upgrade to Pro'}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.logoutBtn} onPress={signOut} testID="btn-signout">
          <LogOut size={18} color="#fff" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>

      <BottomNav role={role} />

      {/* Contacts import — Profile entry point (manual re-trigger after dismissal) */}
      <ContactsImportSheet
        visible={contactsImportOpen}
        onClose={() => setContactsImportOpen(false)}
      />
    </SafeAreaView>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.contactRow}>
      {icon}
      <Text style={styles.contactText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: 16 },
  title: { ...theme.font.h1 },
  scroll: { padding: 16, gap: 14, paddingBottom: 96 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 22 },
  name: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  email: { ...theme.font.caption, marginTop: 2 },
  cardTitle: { ...theme.font.h3 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contactText: { color: theme.colors.text, fontSize: 14 },
  logoutBtn: {
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  logoutText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  proCta: {
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  proCtaActive: { backgroundColor: theme.colors.primary },
  proCtaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { color: theme.colors.textMuted, fontSize: 12 },
  adiRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  adiInput: { flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, height: 44, backgroundColor: theme.colors.background },
  adiSave: { backgroundColor: theme.colors.primary, paddingHorizontal: 16, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  adiSaveText: { color: '#fff', fontWeight: '700' },
  adiValue: { flex: 1, fontSize: 18, fontWeight: '700', color: theme.colors.primary, letterSpacing: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.surface, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border },
  linkRowText: { fontSize: 15, fontWeight: '600', color: theme.colors.text, flex: 1 },
  navChip: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  navChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  navChipText: { fontSize: 12, fontWeight: '700', color: theme.colors.text, textAlign: 'center' },
  navChipTextActive: { color: '#fff' },
});
