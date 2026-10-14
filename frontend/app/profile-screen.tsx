import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, ChevronDown, Building2, Mail, Phone, MapPin, Award, Calendar, CalendarClock, Crown, ShieldCheck, Wallet, Copy, IdCard, Car, Navigation as NavIcon, Users, FileSpreadsheet, Download, Trash2, BookOpen, Fingerprint, Gift } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { mockDb } from '../src/mockDb';
import { Card, Badge, StatusBadge } from '../src/ui';
import { BottomNav } from '../src/BottomNav';
import { useRouter } from 'expo-router';
import { isPaidTier, isFranchiseTier } from '../src/tiers';
import { InstructorDetailsSection } from '../src/InstructorDetailsSection';
import { INSTRUCTOR_PROFILE_SECTIONS, visibleSections, type ProfileRowKey } from '../src/profileSections';
import { NAV_APP_LABELS, resolveNavApp } from '../src/navApp';
import { studentAgreementLabel } from '../src/pupilAgreement';
import { PaywallModal } from '../src/PaywallModal';
import { copyToClipboard } from '../src/tools';
import { useInstructorProfile, useStudentByAuthId, updatePreferredNavApp } from '../src/useSupabaseData';
import type { NavApp } from '../src/supabaseDb';
import { submitDeletionRequest, listMyDeletionRequests } from '../src/supabaseDb';
import { StudentDetailsCard } from '../src/StudentDetailsCard';
import { exportMyDataJson } from '../src/gdprExport';
import { CalendarFeedCard } from '../src/CalendarFeedCard';
import { BankHolidayRegionCard } from '../src/BankHolidayRegionCard';
import { ContactsImportSheet } from '../src/ContactsImportSheet';
import { OpenInMapsButton } from '../src/OpenInMapsButton';
import { Alert, TextInput, ActivityIndicator } from 'react-native';
import { isBiometricAvailable, isBiometricEnabled, setBiometricEnabled } from '../src/biometrics';

export default function ProfileScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const role = user?.role || 'student';

  // Biometric app-unlock toggle (3 Sept 2026), per Grant directly —
  // shown for both roles, since both instructors and students have their
  // own account. Hidden entirely on a device with no biometric hardware
  // or nothing enrolled, rather than shown disabled with no way to use
  // it — a toggle for a feature the device genuinely can't do isn't
  // useful, just confusing.
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);
  useEffect(() => {
    (async () => {
      const available = await isBiometricAvailable();
      setBiometricAvailable(available);
      if (available) setBiometricOn(await isBiometricEnabled());
    })();
  }, []);
  const handleToggleBiometric = async (next: boolean) => {
    setBiometricOn(next); // optimistic — this is a fast, local-only write
    try {
      await setBiometricEnabled(next);
    } catch (e: any) {
      setBiometricOn(!next); // revert on a genuine write failure
      Alert.alert('Could not save', e?.message || 'Please try again.');
    }
  };
  const student = user?.email ? mockDb.getStudentByEmail(user.email) : undefined;
  const pro = isPaidTier(user?.tier);
  const { student: myStudent } = useStudentByAuthId(role === 'student' ? user?.id : undefined);

  // Preferred navigation app for the diary's one-tap 🧭 button.
  const { profile: sbInstructor } = useInstructorProfile();
  const [navApp, setNavApp] = useState<NavApp>('google');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
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
  // Deadlines is a paid feature; Starter instructors get the upgrade prompt.
  const [deadlinesPaywallOpen, setDeadlinesPaywallOpen] = useState(false);
  // Gift vouchers are a paid feature too; Starter instructors get the upgrade prompt.
  const [vouchersPaywallOpen, setVouchersPaywallOpen] = useState(false);
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

  // Rows shared by the instructor sections and the student layout.
  const fingerprintRow = biometricAvailable ? (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Fingerprint size={20} color={theme.colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.linkRowText}>Use fingerprint to unlock</Text>
        <Text style={styles.hint}>Skip re-entering your password each time you open the app.</Text>
      </View>
      <Switch value={biometricOn} onValueChange={handleToggleBiometric} testID="switch-biometric" />
    </Card>
  ) : null;

  // Privacy & data — GDPR self-service export + deletion request
  const privacyCard = (
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
  );

  // Instructor rows, keyed as in profileSections.ts (which decides the grouping and order).
  const navAppLabel = NAV_APP_LABELS[resolveNavApp(navApp)];
  const instructorRows = (key: ProfileRowKey): React.ReactNode => {
    switch (key) {
      case 'details':
        return (
          <>
            <NavRow
              icon={<IdCard size={18} color={theme.colors.primary} />}
              label="My details"
              value={sbInstructor?.adi_number ? `ADI ${sbInstructor.adi_number}` : undefined}
              open={detailsOpen}
              onPress={() => setDetailsOpen((o) => !o)}
              testID="link-my-details"
            />
            {detailsOpen && <InstructorDetailsSection tier={user?.tier} />}
          </>
        );
      case 'school':
        return isFranchiseTier(user?.tier) ? null : (
          <NavRow
            icon={<Building2 size={18} color={theme.colors.primary} />}
            label="School profile"
            value="Business name, logo, reviews, refunds"
            onPress={() => router.push('/school-profile-screen' as any)}
            testID="link-school-profile"
          />
        );
      case 'packages':
        return <NavRow icon={<Wallet size={18} color={theme.colors.accent} />} label="Pricing & packages" onPress={() => router.push('/packages-screen' as any)} testID="link-packages" />;
      case 'vouchers':
        return (
          <NavRow
            icon={<Gift size={18} color={theme.colors.accent} />}
            label="Gift vouchers"
            onPress={() => (pro ? router.push('/vouchers-screen' as any) : setVouchersPaywallOpen(true))}
            testID="link-vouchers"
          />
        );
      case 'income':
        return <NavRow icon={<FileSpreadsheet size={18} color={theme.colors.success} />} label="Income & expense report (CSV)" onPress={() => router.push('/income-expense-report-screen' as any)} testID="link-income-expense" />;
      case 'subscription':
        return (
          <TouchableOpacity
            style={[styles.proCta, pro && styles.proCtaActive]}
            onPress={() => router.push('/pricing-screen')}
            testID="btn-pricing"
          >
            <Crown size={18} color="#fff" />
            <Text style={styles.proCtaText}>{pro ? 'Manage subscription' : 'Upgrade plan'}</Text>
          </TouchableOpacity>
        );
      case 'syllabuses':
        return <NavRow icon={<BookOpen size={18} color={theme.colors.primary} />} label="My syllabuses" onPress={() => router.push('/syllabuses-screen')} testID="link-syllabuses" />;
      case 'vehicles':
        return <NavRow icon={<Car size={18} color={theme.colors.primary} />} label="Manage vehicles" onPress={() => router.push('/vehicles-screen')} testID="link-vehicles" />;
      case 'noteQuestions':
        return <NavRow icon={<FileSpreadsheet size={18} color={theme.colors.primary} />} label="Lesson note questions" onPress={() => router.push('/lesson-note-questions-screen' as any)} testID="link-lesson-note-questions" />;
      case 'standards':
        return <NavRow icon={<Award size={18} color={theme.colors.primary} />} label="My Standards Check" onPress={() => router.push('/standards-check-screen' as any)} testID="link-standards-check" />;
      case 'deadlines':
        return (
          <NavRow
            icon={<CalendarClock size={18} color={theme.colors.primary} />}
            label="Deadlines & reminders"
            onPress={() => (pro ? router.push('/deadlines-screen' as any) : setDeadlinesPaywallOpen(true))}
            testID="link-deadlines"
          />
        );
      case 'navApp':
        return (
          <>
            <NavRow
              icon={<NavIcon size={18} color={theme.colors.primary} />}
              label="Default navigation app"
              value={navAppLabel}
              open={navOpen}
              onPress={() => setNavOpen((o) => !o)}
              testID="link-nav-app"
            />
            {navOpen && (
              <Card style={{ gap: 10 }}>
                <Text style={styles.hint}>The diary&apos;s one-tap 🧭 button and Lesson tools will launch this app.</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(Object.keys(NAV_APP_LABELS) as NavApp[]).map((key) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.navChip, navApp === key && styles.navChipActive, savingNav && { opacity: 0.7 }]}
                      onPress={() => onPickNavApp(key)}
                      disabled={savingNav}
                      testID={`navapp-${key}`}
                    >
                      <Text style={[styles.navChipText, navApp === key && styles.navChipTextActive]}>{NAV_APP_LABELS[key]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Card>
            )}
          </>
        );
      case 'unavailabilities':
        return <NavRow icon={<Calendar size={18} color={theme.colors.danger} />} label="Unavailabilities (time off)" onPress={() => router.push('/unavailabilities-screen' as any)} testID="link-unavailabilities" />;
      case 'bankHolidays':
        return <BankHolidayRegionCard />;
      case 'calendarFeed':
        return <CalendarFeedCard />;
      case 'importContacts':
        return <NavRow icon={<Users size={18} color={theme.colors.primary} />} label="Import students from Contacts" onPress={() => setContactsImportOpen(true)} testID="link-import-contacts" />;
      case 'fingerprint':
        return fingerprintRow;
      case 'privacy':
        return privacyCard;
    }
  };
  const sections = visibleSections(INSTRUCTOR_PROFILE_SECTIONS, instructorRows);

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

        {role === 'instructor' && sections.map((sec) => (
          <View key={sec.title} style={styles.section} testID={`profile-section-${sec.title}`}>
            <Text style={styles.sectionTitle}>{sec.title}</Text>
            {sec.rows.map((r) => <React.Fragment key={r.key}>{r.node}</React.Fragment>)}
          </View>
        ))}

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

        {role === 'student' && myStudent && <StudentDetailsCard student={myStudent} />}

        {role === 'student' && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/onboarding-tc-screen')}
            testID="link-tc"
          >
            <ShieldCheck size={18} color={theme.colors.primary} />
            <Text style={styles.linkRowText}>{studentAgreementLabel(myStudent)}</Text>
          </TouchableOpacity>
        )}

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

        {role !== 'instructor' && (
          <View style={styles.section}>
            {fingerprintRow}
            {privacyCard}
          </View>
        )}

        {/* Sign out lives in the bottom bar (Logout), so there is no second button here. */}

        <View style={{ height: 32 }} />
      </ScrollView>

      <BottomNav role={role} />

      {/* Contacts import — Profile entry point (manual re-trigger after dismissal) */}
      <ContactsImportSheet
        visible={contactsImportOpen}
        onClose={() => setContactsImportOpen(false)}
      />

      <PaywallModal
        visible={deadlinesPaywallOpen}
        onClose={() => setDeadlinesPaywallOpen(false)}
        reason="Never miss a renewal. Track your ADI badge, MOT, insurance, road tax and dual-control service, with email and notification reminders before each one."
      />

      <PaywallModal
        visible={vouchersPaywallOpen}
        onClose={() => setVouchersPaywallOpen(false)}
        reason="Sell prepaid lessons as gifts. Make a branded PDF gift voucher for any number of hours, with your logo, a unique code and an expiry date."
      />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A tappable row. With `open` set it acts as an expander (chevron down/up) instead of a link. */
function NavRow({
  icon, label, value, onPress, testID, open,
}: {
  icon: React.ReactNode; label: string; value?: string; onPress: () => void; testID: string; open?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.linkRow} onPress={onPress} testID={testID} accessibilityRole="button">
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={styles.linkRowText}>{label}</Text>
        {!!value && <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>}
      </View>
      {open === undefined ? (
        <ChevronRight size={18} color={theme.colors.textMuted} />
      ) : (
        open ? <ChevronDown size={18} color={theme.colors.textMuted} /> : <ChevronRight size={18} color={theme.colors.textMuted} />
      )}
    </TouchableOpacity>
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
  section: { gap: 10 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginLeft: 2 },
  rowValue: { fontSize: 12.5, color: theme.colors.textMuted, marginTop: 1 },
  instructorName: { fontSize: 20, fontWeight: '700', color: theme.colors.text, marginTop: 2 },
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
