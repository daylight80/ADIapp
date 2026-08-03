import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
  RefreshControl,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Search, Plus, ArrowLeft, Mail, Phone, MapPin, CalendarDays, Check, Crown, Send, Copy, BookUser, PenLine, Smartphone, X } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb, StudentStatus } from '../src/mockDb';
import { useStudents, createStudent, ensureDemoStudentsSeeded } from '../src/useSupabaseData';
import { listStudentBalances } from '../src/supabaseDb';
import { explainLimitError } from '../src/tiers';
import { Card, ProgressBar, StatusBadge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import { BottomNav } from '../src/BottomNav';
import { useAuth } from '../src/AuthContext';
import { canAddStudent, isPro, FREE_STUDENT_LIMIT } from '../src/proPlan';
import { PaywallModal } from '../src/PaywallModal';
import { fireInstantNotification } from '../src/notifications';
import { openSmsComposer, copyToClipboard } from '../src/tools';
import { api } from '../src/api';
import { ContactsImportSheet } from '../src/ContactsImportSheet';

type FilterChip = 'All' | StudentStatus;

const FILTERS: FilterChip[] = ['All', 'Active', 'Test Ready', 'New', 'Passed', 'Inactive', 'Waitlist'];

export default function StudentCrmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const { user } = useAuth();
  const pro = isPro(user?.subscription_status);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterChip>('All');

  // -----------------------------------------------------------------------
  // Arrears filter — toggled on when the screen is opened via the
  // dashboard's "Students in arrears" tile (?filter=arrears). When active
  // we hide every student whose outstanding balance is ≤ £0. The chip at
  // the top of the list shows an explicit "Arrears Active" pill the user
  // can dismiss to return to the full roster.
  // -----------------------------------------------------------------------
  const [arrearsActive, setArrearsActive] = useState(false);
  const [balances, setBalances] = useState<Record<string, number>>({});
  // Apply on initial mount only — toggling the chip later sets state directly.
  React.useEffect(() => {
    if (params?.filter === 'arrears') setArrearsActive(true);
  }, [params?.filter]);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listStudentBalances();
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const r of rows) map[r.student_id] = r.outstanding_gbp;
        setBalances(map);
      } catch {
        // best-effort — leave map empty so all students render as £0
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const [addOpen, setAddOpen] = useState(false);
  const [methodPickerOpen, setMethodPickerOpen] = useState(false);
  const [contactsImportOpen, setContactsImportOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [busyInvite, setBusyInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteRecipient, setInviteRecipient] = useState<{ name: string; phone: string; email_sent?: boolean; detail?: string } | null>(null);

  // Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [provisionalLicence, setProvisionalLicence] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const { students, loading: studentsLoading, refresh: refreshStudents } = useStudents();

  // Seed demo students on first login for this instructor (idempotent)
  React.useEffect(() => {
    ensureDemoStudentsSeeded().catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const q = search.toLowerCase();
      const matchQ = !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
      const matchF = filter === 'All' || s.status === filter;
      const matchArrears = !arrearsActive || (balances[s.id] ?? 0) > 0;
      return matchQ && matchF && matchArrears;
    });
  }, [students, search, filter, arrearsActive, balances]);

  const counts = useMemo(() => {
    return {
      Active: students.filter((s) => s.status === 'Active').length,
      'Test Ready': students.filter((s) => s.status === 'Test Ready').length,
      New: students.filter((s) => s.status === 'New').length,
      Passed: students.filter((s) => s.status === 'Passed').length,
      Inactive: students.filter((s) => s.status === 'Inactive').length,
      Waitlist: students.filter((s) => s.status === 'Waitlist').length,
    };
  }, [students]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refreshStudents().finally(() => setRefreshing(false));
  }, [refreshStudents]);

  const showSnack = (msg: string) => {
    setSnack(msg);
    setTimeout(() => setSnack(null), 2500);
  };

  const submit = async () => {
    setFormError(null);
    if (!name.trim() || name.trim().length < 2) {
      setFormError('Please enter the full name');
      return;
    }
    if (!email.includes('@')) {
      setFormError('Please enter a valid email');
      return;
    }
    if (!phone.trim()) {
      setFormError('Please enter a phone number');
      return;
    }
    // UK provisional licence numbers are 16 characters (letters + digits).
    // We strip spaces before checking length so "SMITH9 11206 23A6L 79" is OK.
    const licence = provisionalLicence.replace(/\s+/g, '').toUpperCase();
    if (!licence) {
      setFormError('Please enter the provisional licence number');
      return;
    }
    if (licence.length !== 16) {
      setFormError('Provisional licence number must be 16 characters');
      return;
    }
    // Enforce limit (defensive — FAB also gates)
    if (!canAddStudent(user?.subscription_status, students.length)) {
      setAddOpen(false);
      setPaywallOpen(true);
      return;
    }

    setBusyInvite(true);
    try {
      const studentName = name.trim();
      const studentPhone = phone.trim();

      // Persist student into Supabase (RLS enforced by school_id/instructor_id)
      const created = await createStudent({
        name: studentName,
        email: email.trim().toLowerCase(),
        phone: studentPhone,
        address: address.trim(),
        postcode: postcode.trim().toUpperCase(),
        provisional_licence: licence,
      });

      // Trigger Supabase Auth invite email (Supabase's built-in email provider).
      // The recipient gets a magic-link email and can set a password on landing.
      let emailSent = false;
      let inviteDetail = '';
      try {
        const res = await api.post('/v2/students/invite', {
          email: email.trim().toLowerCase(),
          student_name: studentName,
          student_id: created.id,
        });
        emailSent = !!res.data?.sent;
        inviteDetail = res.data?.detail || '';
      } catch (err: any) {
        inviteDetail = err?.response?.data?.detail || err?.message || 'Could not send invite email';
      }

      // Build a shareable link as a fallback for sharing manually (SMS / WhatsApp).
      const payload = btoa(
        JSON.stringify({
          email: email.trim().toLowerCase(),
          name: studentName,
          student_id: created.id,
          instructor_id: created.instructor_id,
          school_id: created.school_id,
        }),
      );
      const inviteUrl = `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/?invite=${payload}`;

      // Clear form
      setName('');
      setEmail('');
      setPhone('');
      setAddress('');
      setPostcode('');
      setProvisionalLicence('');
      setReloadKey((k) => k + 1);
      setAddOpen(false);

      // Show invite-link sheet
      setInviteLink(inviteUrl);
      setInviteRecipient({ name: studentName, phone: studentPhone, email_sent: emailSent, detail: inviteDetail });

      if (pro) {
        const note = emailSent
          ? `Invite email sent to ${email.trim().toLowerCase()}.`
          : `${studentName} added. ${inviteDetail || 'Share the invite link manually.'}`;
        fireInstantNotification('Student invited', note).catch(() => {});
      }
    } catch (e: any) {
      const upgradeMsg = explainLimitError(e);
      if (upgradeMsg) {
        setFormError(upgradeMsg + ' Tap below to upgrade.');
        // Surface an Upgrade CTA via Alert as well so it's clearly actionable
        Alert.alert(
          'Student limit reached',
          upgradeMsg,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'See plans', onPress: () => router.push('/pricing-screen') },
          ],
        );
      } else {
        setFormError(e?.message || e?.response?.data?.detail || 'Failed to create student');
      }
    } finally {
      setBusyInvite(false);
    }
  };

  const handleFabPress = () => {
    if (!canAddStudent(user?.subscription_status, students.length)) {
      setPaywallOpen(true);
      return;
    }
    setMethodPickerOpen(true);
  };

  const chooseManualEntry = () => {
    setMethodPickerOpen(false);
    // Small delay so the picker has time to dismiss before the form slides up.
    setTimeout(() => setAddOpen(true), 220);
  };

  const chooseContactsImport = () => {
    setMethodPickerOpen(false);
    setTimeout(() => setContactsImportOpen(true), 220);
  };

  const copyInviteLink = () => {
    if (!inviteLink) return;
    const ok = copyToClipboard(inviteLink);
    showSnack(ok ? 'Invite link copied to clipboard' : 'Could not copy automatically — long-press to copy.');
  };

  const smsInviteLink = async () => {
    if (!inviteLink || !inviteRecipient) return;
    const body = `Hi ${inviteRecipient.name.split(' ')[0]}, your driving instructor has invited you to ADI Pro. Tap to sign up: ${inviteLink}`;
    await openSmsComposer(inviteRecipient.phone, body);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Students</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <Search size={18} color={theme.colors.textMuted} />
          <TextInput
            placeholder="Search by name or email"
            placeholderTextColor={theme.colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            testID="input-search"
          />
        </View>
      </View>

      {/* Arrears chip — only shown while the arrears filter is active.
          Tapping the ✕ clears the filter and returns the full roster. */}
      {arrearsActive && (
        <View style={styles.arrearsChipRow}>
          <View style={styles.arrearsChip} testID="chip-arrears-active">
            <Text style={styles.arrearsChipText}>Arrears Active</Text>
            <TouchableOpacity
              onPress={() => setArrearsActive(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              testID="btn-clear-arrears"
              accessibilityLabel="Clear arrears filter"
            >
              <X size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {FILTERS.map((f) => {
          const count = f === 'All' ? students.length : counts[f as Exclude<FilterChip, 'All'>];
          const active = filter === f;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(f)}
              testID={`filter-${f.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f} <Text style={[styles.chipCount, active && styles.chipCountActive]}>{count}</Text>
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!pro && (
        <TouchableOpacity
          style={styles.tierBanner}
          onPress={() => router.push('/pricing-screen')}
          testID="tier-usage-banner"
          activeOpacity={0.9}
        >
          <Crown size={16} color={theme.colors.accent} />
          <Text style={styles.tierText}>
            {students.length}/{FREE_STUDENT_LIMIT} students used (Free) ·{' '}
            <Text style={{ fontWeight: '700', color: theme.colors.primary }}>Upgrade</Text>
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item: s }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/student-lifecycle-screen', params: { id: s.id } })}
            activeOpacity={0.8}
            testID={`student-card-${s.id}`}
          >
            <Card style={styles.studentCard}>
              <View style={styles.studentTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{s.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{s.name}</Text>
                  <Text style={styles.studentEmail}>{s.email}</Text>
                </View>
                <StatusBadge status={s.status} testID={`status-${s.id}`} />
              </View>

              <View style={styles.progressRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.progressLabel}>
                    <Text style={styles.progressText}>Progress</Text>
                    <Text style={styles.progressText}>{s.progress}%</Text>
                  </View>
                  <ProgressBar progress={s.progress} />
                </View>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaText}>{s.lessons_count} lessons</Text>
                {s.next_lesson && (
                  <Text style={styles.metaText}>
                    Next: {new Date(s.next_lesson).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                )}
                {s.test_date && (
                  <Text style={[styles.metaText, { color: theme.colors.accent, fontWeight: '600' }]}>
                    Test: {new Date(s.test_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                )}
              </View>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          arrearsActive ? (
            <View style={styles.arrearsEmpty} testID="empty-arrears-up-to-date">
              <View style={styles.arrearsEmptyBadge}>
                <Check size={20} color={theme.colors.success} />
              </View>
              <Text style={styles.arrearsEmptyTitle}>All up to date</Text>
              <Text style={styles.arrearsEmptySub}>
                Every pupil&apos;s payments are currently up to date. Great work!
              </Text>
              <TouchableOpacity
                style={styles.arrearsEmptyBtn}
                onPress={() => setArrearsActive(false)}
                testID="btn-empty-clear-arrears"
              >
                <Text style={styles.arrearsEmptyBtnText}>Show full roster</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No students match your filters.</Text>
            </View>
          )
        }
      />

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, !canAddStudent(user?.subscription_status, students.length) && styles.fabLocked]}
        onPress={handleFabPress}
        testID="fab-add-student"
      >
        {!canAddStudent(user?.subscription_status, students.length) ? (
          <Crown size={24} color="#fff" />
        ) : (
          <Plus size={26} color="#fff" />
        )}
      </TouchableOpacity>

      <BottomNav role="instructor" />

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason={`Free tier is limited to ${FREE_STUDENT_LIMIT} students. You currently have ${students.length}.`}
      />

      {/* Snackbar */}
      {snack && (
        <View style={styles.snackbar} testID="snackbar-success">
          <Check size={18} color="#fff" />
          <Text style={styles.snackText}>{snack}</Text>
        </View>
      )}

      {/* Method picker — shown when the FAB is tapped. Lets the instructor
          choose between importing from Contacts or typing details manually. */}
      <BottomSheet
        visible={methodPickerOpen}
        onClose={() => setMethodPickerOpen(false)}
        title="Add new student"
        testID="sheet-add-method-picker"
      >
        <Text style={styles.hint}>
          How would you like to add this student?
        </Text>

        {Platform.OS !== 'web' ? (
          <TouchableOpacity
            style={styles.methodCard}
            onPress={chooseContactsImport}
            testID="btn-method-contacts"
            activeOpacity={0.85}
          >
            <View style={styles.methodIconWrap}>
              <BookUser size={24} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>Import from address book</Text>
              <Text style={styles.methodSub}>
                Pick from your phone Contacts. Quickest for several students at once.
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={[styles.methodCard, styles.methodCardDisabled]}>
            <View style={styles.methodIconWrap}>
              <Smartphone size={24} color={theme.colors.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.methodTitle, { color: theme.colors.textMuted }]}>
                Import from address book
              </Text>
              <Text style={styles.methodSub}>
                Open ADI Pro on your phone to import directly from your contacts.
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={styles.methodCard}
          onPress={chooseManualEntry}
          testID="btn-method-manual"
          activeOpacity={0.85}
        >
          <View style={styles.methodIconWrap}>
            <PenLine size={24} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.methodTitle}>Enter details manually</Text>
            <Text style={styles.methodSub}>
              Type the student&apos;s name, contact details and licence number.
            </Text>
          </View>
        </TouchableOpacity>
      </BottomSheet>

      {/* Bulk contacts import sheet — opens after the picker if the
          instructor chose "Import from address book". */}
      <ContactsImportSheet
        visible={contactsImportOpen}
        onClose={() => setContactsImportOpen(false)}
        onImported={(count) => {
          if (count > 0) {
            showSnack(`${count} student${count === 1 ? '' : 's'} imported from Contacts`);
            setReloadKey((k) => k + 1);
          }
        }}
      />

      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Invite New Student" testID="sheet-add-student">
        <Text style={styles.hint}>We&apos;ll generate a private invite link you can copy or send by SMS.</Text>

        <Text style={styles.label}>Full name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Charlotte Smith" placeholderTextColor={theme.colors.textMuted} testID="input-student-name" />

        <Text style={styles.label}>Email address</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="name@example.co.uk"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-student-email"
        />

        <Text style={styles.label}>Phone</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="07700 900000"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-student-phone"
        />

        <Text style={styles.label}>Address (optional)</Text>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholder="12 High Street"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-student-address"
        />

        <Text style={styles.label}>Postcode (optional)</Text>
        <TextInput
          style={styles.input}
          value={postcode}
          onChangeText={setPostcode}
          autoCapitalize="characters"
          placeholder="SW1A 1AA"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-student-postcode"
        />

        <Text style={styles.label}>
          Provisional licence number <Text style={{ color: theme.colors.danger }}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={provisionalLicence}
          onChangeText={(v) => setProvisionalLicence(v.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          placeholder="SMITH911206 23A6L 79"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-student-licence"
        />
        <Text style={styles.helperText}>
          16-character DVLA driver number on the front of the pink licence (DD1).
        </Text>

        {formError && <Text style={styles.error}>{formError}</Text>}

        <TouchableOpacity
          style={[styles.submitBtn, busyInvite && styles.submitBtnDisabled]}
          onPress={submit}
          disabled={busyInvite}
          testID="btn-submit-student"
        >
          <Send size={16} color="#fff" />
          <Text style={styles.submitBtnText}>{busyInvite ? 'Creating invite...' : 'Generate invite link'}</Text>
        </TouchableOpacity>
      </BottomSheet>

      {/* Invite link reveal sheet */}
      <BottomSheet
        visible={!!inviteLink}
        onClose={() => {
          setInviteLink(null);
          setInviteRecipient(null);
        }}
        title="Invite link ready"
        testID="sheet-invite-link"
      >
        {inviteLink && inviteRecipient && (
          <View style={{ gap: 14 }}>
            {inviteRecipient.email_sent ? (
              <View style={styles.emailBanner} testID="invite-email-sent">
                <Text style={styles.emailBannerTitle}>📧 Invite email sent</Text>
                <Text style={styles.emailBannerText}>
                  {inviteRecipient.detail || `${inviteRecipient.name} will receive a sign-up link in their inbox.`}
                </Text>
              </View>
            ) : (
              <View style={styles.emailBannerWarn} testID="invite-email-fallback">
                <Text style={styles.emailBannerWarnTitle}>⚠️ Email not sent</Text>
                <Text style={styles.emailBannerText}>
                  {inviteRecipient.detail || 'Could not send the invite email automatically. Share the link below manually.'}
                </Text>
              </View>
            )}
            <Text style={styles.hint}>
              You can also share this back-up link with {inviteRecipient.name}. They&apos;ll set their own password and join your roster.
            </Text>
            <View style={styles.linkBox} testID="invite-link-value">
              <Text style={styles.linkText} numberOfLines={2}>{inviteLink}</Text>
            </View>
            <View style={styles.linkRow}>
              <TouchableOpacity style={[styles.linkBtn, { backgroundColor: theme.colors.primary }]} onPress={copyInviteLink} testID="btn-copy-invite">
                <Copy size={16} color="#fff" />
                <Text style={styles.linkBtnText}>Copy link</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.linkBtn, { backgroundColor: theme.colors.accent }]} onPress={smsInviteLink} testID="btn-sms-invite">
                <Send size={16} color="#fff" />
                <Text style={styles.linkBtnText}>Send via SMS</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  searchRow: { paddingHorizontal: 16, paddingBottom: 8 },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    height: 48,
  },
  searchInput: { flex: 1, fontSize: 15 },
  chipsRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 8,
    alignItems: 'center', // prevent chips from stretching vertically inside the row
  },

  // ----- Arrears filter chip + empty state ---------------------------------
  arrearsChipRow: {
    paddingHorizontal: 16, paddingTop: 8,
    flexDirection: 'row',
  },
  arrearsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: 12, paddingRight: 8,
    height: 32, borderRadius: 16,
    backgroundColor: theme.colors.danger,
  },
  arrearsChipText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  arrearsEmpty: {
    alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32,
    gap: 12,
  },
  arrearsEmptyBadge: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#D1FAE5',
  },
  arrearsEmptyTitle: { fontSize: 18, fontWeight: '800', color: theme.colors.text },
  arrearsEmptySub: {
    fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 20,
  },
  arrearsEmptyBtn: {
    marginTop: 4,
    paddingHorizontal: 16, height: 40, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  arrearsEmptyBtnText: { fontWeight: '700', color: theme.colors.text, fontSize: 13 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.colors.text, lineHeight: 16 },
  chipTextActive: { color: '#fff' },
  chipCount: { color: theme.colors.textMuted, marginLeft: 2 },
  chipCountActive: { color: '#ffffffcc' },
  list: { padding: 16, gap: 12, paddingBottom: 120 },
  studentCard: { gap: 12, marginBottom: 12 },
  studentTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '700', color: theme.colors.primary, fontSize: 16 },
  studentName: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  studentEmail: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressText: { fontSize: 13, color: theme.colors.textMuted, fontWeight: '500' },
  metaRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  metaText: { fontSize: 13, color: theme.colors.textMuted },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: theme.colors.textMuted },
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.2)',
    elevation: 6,
  },
  fabLocked: { backgroundColor: theme.colors.textMuted },
  tierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF7ED',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  tierText: { color: theme.colors.text, fontSize: 13, flex: 1 },
  label: { ...theme.font.caption, fontWeight: '600', marginBottom: 6, color: theme.colors.text },
  helperText: { ...theme.font.caption, color: theme.colors.textMuted, marginTop: -4, marginBottom: 4 },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginTop: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  methodCardDisabled: { opacity: 0.6 },
  methodIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.primaryLight,
  },
  methodTitle: { ...theme.font.body, fontWeight: '700', color: theme.colors.text, marginBottom: 2 },
  methodSub: { ...theme.font.caption, color: theme.colors.textMuted, lineHeight: 17 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 12,
    backgroundColor: theme.colors.background,
    fontSize: 15,
  },
  error: { color: theme.colors.danger, marginBottom: 8 },
  submitBtn: { backgroundColor: theme.colors.primary, height: 52, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', marginTop: 8, flexDirection: 'row', gap: 8 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { color: theme.colors.textMuted, marginBottom: 12, fontSize: 13 },
  linkBox: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, backgroundColor: theme.colors.background },
  linkText: { color: theme.colors.primary, fontWeight: '600', fontSize: 13 },
  linkRow: { flexDirection: 'row', gap: 10 },
  linkBtn: { flex: 1, height: 48, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  linkBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emailBanner: {
    backgroundColor: '#D1FAE5',
    borderColor: theme.colors.success,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  emailBannerTitle: { color: theme.colors.success, fontSize: 14, fontWeight: '700' },
  emailBannerText:  { color: theme.colors.text, fontSize: 13, lineHeight: 18 },
  emailBannerWarn: {
    backgroundColor: '#FEF3C7',
    borderColor: theme.colors.accent,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  emailBannerWarnTitle: { color: theme.colors.accent, fontSize: 14, fontWeight: '700' },
  snackbar: {
    position: 'absolute',
    bottom: 110,
    left: 16,
    right: 16,
    backgroundColor: theme.colors.success,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  snackText: { color: '#fff', fontWeight: '600' },
});
