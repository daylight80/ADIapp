import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut, Mail, Phone, MapPin, Award, Calendar, Crown, ShieldCheck, Wallet, Copy, IdCard, Car, Navigation as NavIcon, Users, FileSpreadsheet, Download, Trash2 } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { mockDb, instructorProfile } from '../src/mockDb';
import { Card, Badge, StatusBadge } from '../src/ui';
import { BottomNav } from '../src/BottomNav';
import { useRouter } from 'expo-router';
import { isPaidTier } from '../src/tiers';
import { copyToClipboard } from '../src/tools';
import { useInstructorProfile, updatePreferredNavApp } from '../src/useSupabaseData';
import type { NavApp } from '../src/supabaseDb';
import { submitDeletionRequest, listMyDeletionRequests } from '../src/supabaseDb';
import { exportMyDataJson } from '../src/gdprExport';
import { CalendarFeedCard } from '../src/CalendarFeedCard';
import { ContactsImportSheet } from '../src/ContactsImportSheet';
import { OpenInMapsButton } from '../src/OpenInMapsButton';
import { Alert, TextInput, ActivityIndicator } from 'react-native';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const role = user?.role || 'student';
  const student = user?.email ? mockDb.getStudentByEmail(user.email) : undefined;
  const pro = isPaidTier(user?.tier);

  // Preferred navigation app for the diary's one-tap 🧭 button.
  const { profile: sbInstructor } = useInstructorProfile();
  const [navApp, setNavApp] = useState<NavApp>('google');
  React.useEffect(() => {
    if (sbInstructor?.preferred_nav_app) setNavApp(sbInstructor.preferred_nav_app);
  }, [sbInstructor?.preferred_nav_app]);
  const [savingNav, setSavingNav] = useState(false);

  // ---------------------------------------------------------------------------
  // Privacy & data — self-service export and a formal deletion request.
  // ---------------------------------------------------------------------------
  const [exportingData, setExportingData] = useState(false);
  const [submittingDeletion, setSubmittingDeletion] = useState(false);
  const [pendingDeletionRequest, setPendingDeletionRequest] = useState<boolean>(false);

  React.useEffect(() => {
    const id = role === 'student' ? user?.student_id : user?.instructor_id;
    if (!id) return;
    listMyDeletionRequests(role as 'student' | 'instructor', id)
      .then((reqs) => setPendingDeletionRequest(reqs.some((r) => r.status === 'pending')))
      .catch(() => {});
  }, [role, user?.student_id, user?.instructor_id]);

  const handleDownloadMyData = async () => {
    setExportingData(true);
    try {
      await exportMyDataJson(role as 'student' | 'instructor', user?.student_id ?? undefined, user?.instructor_id ?? undefined);
    } catch (e: any) {
      Alert.alert('Could not export your data', e?.message || 'Please try again.');
    } finally {
      setExportingData(false);
    }
  };

  const handleRequestDeletion = () => {
    Alert.alert(
      'Request account deletion',
      role === 'student'
        ? "This sends a formal request to your instructor to delete your data. This can't be undone once they action it."
        : "This logs a formal request for your account to be reviewed and deleted. Since this affects your students and lesson records too, it needs manual follow-up rather than happening instantly.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send request',
          style: 'destructive',
          onPress: async () => {
            setSubmittingDeletion(true);
            try {
              await submitDeletionRequest({
                role: role as 'student' | 'instructor',
                studentId: user?.student_id ?? undefined,
                instructorId: user?.instructor_id ?? undefined,
              });
              setPendingDeletionRequest(true);
              Alert.alert('Request sent', "We've logged your request. You'll be notified once it's been actioned.");
            } catch (e: any) {
              Alert.alert('Could not submit request', e?.message || 'Please try again.');
            } finally {
              setSubmittingDeletion(false);
            }
          },
        },
      ],
    );
  };

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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
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
              <View style={styles.contactRow}>
                <MapPin size={16} color={theme.colors.textMuted} />
                <Text style={[styles.contactText, { flex: 1 }]} numberOfLines={2}>
                  {`${student.address || ''}, ${student.postcode || ''}`.replace(/^,\s*|,\s*$/g, '')}
                </Text>
                <OpenInMapsButton
                  address={`${student.address || ''}, ${student.postcode || ''}`}
                  variant="pill"
                  label="Maps"
                  testID="btn-open-maps-my-address"
                />
              </View>
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
            onPress={() => router.push('/instructor-profile-screen')}
            testID="link-instructor-profile"
          >
            <IdCard size={18} color={theme.colors.primary} />
            <Text style={styles.linkRowText}>My instructor profile</Text>
          </TouchableOpacity>
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
            onPress={() => router.push('/lesson-note-questions-screen' as any)}
            testID="link-lesson-note-questions"
          >
            <FileSpreadsheet size={18} color={theme.colors.primary} />
            <Text style={styles.linkRowText}>Lesson note questions</Text>
          </TouchableOpacity>
        )}

        {role === 'instructor' && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/standards-check-screen' as any)}
            testID="link-standards-check"
          >
            <Award size={18} color={theme.colors.primary} />
            <Text style={styles.linkRowText}>My Standards Check</Text>
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
            <Text style={styles.proCtaText}>{pro ? 'Manage subscription' : 'Upgrade plan'}</Text>
          </TouchableOpacity>
        )}

        {/* Privacy & data — GDPR self-service export + deletion request */}
        <Card style={{ gap: 10 }} testID="card-privacy-data">
          <Text style={styles.cardTitle}>Privacy & data</Text>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={handleDownloadMyData}
            disabled={exportingData}
            testID="btn-download-my-data"
          >
            {exportingData ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Download size={18} color={theme.colors.primary} />
            )}
            <Text style={styles.linkRowText}>{exportingData ? 'Preparing your data…' : 'Download my data'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.linkRow, { borderColor: theme.colors.danger }]}
            onPress={handleRequestDeletion}
            disabled={submittingDeletion || pendingDeletionRequest}
            testID="btn-request-deletion"
          >
            {submittingDeletion ? (
              <ActivityIndicator size="small" color={theme.colors.danger} />
            ) : (
              <Trash2 size={18} color={theme.colors.danger} />
            )}
            <Text style={[styles.linkRowText, { color: theme.colors.danger }]}>
              {pendingDeletionRequest ? 'Deletion request pending' : 'Request account deletion'}
            </Text>
          </TouchableOpacity>
        </Card>

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
      </KeyboardAvoidingView>
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
