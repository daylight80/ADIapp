import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BottomNav } from '../src/BottomNav';
import { BottomSheet } from '../src/BottomSheet';
import { ContactsImportSheet } from '../src/ContactsImportSheet';
import { PaywallModal } from '../src/PaywallModal';
import { useAuth } from '../src/AuthContext';
import { useStudents, createStudent } from '../src/useSupabaseData';
import { listStudentBalances, listHoursBalanceForStudents, type StudentStatus } from '../src/supabaseDb';
import { canAddStudent, explainLimitError, tierById, isPaidTier } from '../src/tiers';
import { copyToClipboard, openSmsComposer } from '../src/tools';
import { fireInstantNotification } from '../src/notifications';
import { api } from '../src/api';

/**
 * Students list — redesigned visual direction from the Claude Design
 * handoff (23 Aug 2026), promoted to live on 24 Aug 2026 after review as
 * students-v2-screen. This is now the real, live student list.
 *
 * Behaviour preserved from the original: the same 7 filter chips with live
 * counts, the same search matching (name OR email), and the ?filter=arrears
 * deep-link from the owner dashboard's arrears tile.
 *
 * New from the redesign, and genuinely useful: tapping a row expands it
 * inline to reveal quick actions and detail rows, rather than navigating
 * straight to the profile.
 *
 * The full add-student flow — manual entry form, Contacts import, invite
 * link generation, and paywall gating — was deliberately deferred during
 * the trial (this file linked to the old screen for it) and has now been
 * fully ported in as part of promoting this screen to live, since the old
 * screen it depended on no longer exists.
 */

const C = {
  surface: '#F5F2EC',
  border: '#E4DED2',
  divider: '#EDE8DE',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  faint: '#A69C8B',
  primary: '#00539F',
  accent: '#FF6B00',
  chipTrack: '#EDE8DE',
};

const STATUS_STYLE: Record<string, { solid: string; bg: string; fg: string }> = {
  New: { solid: '#00539F', bg: '#E5F0FA', fg: '#00539F' },
  Active: { solid: '#047857', bg: '#D1FAE5', fg: '#047857' },
  'Test Ready': { solid: '#C2410C', bg: '#FFF7ED', fg: '#C2410C' },
  Passed: { solid: '#0F172A', bg: '#0F172A', fg: '#FFFFFF' },
  Inactive: { solid: '#A69C8B', bg: '#EDE8DE', fg: '#8A8172' },
  Waitlist: { solid: '#92400E', bg: '#FEF3C7', fg: '#92400E' },
};

type FilterChip = 'All' | StudentStatus;
const FILTERS: FilterChip[] = ['All', 'Active', 'Test Ready', 'New', 'Passed', 'Inactive', 'Waitlist'];

function initialsOf(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function StudentsV2Screen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const { students, loading, refresh } = useStudents();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterChip>('All');
  const [arrearsActive, setArrearsActive] = useState(false);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [hoursBalances, setHoursBalances] = useState<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ---- Add-student flow, ported from the real student-crm-screen (24 Aug
  // 2026) — this was deliberately deferred to the old screen during the
  // trial; now that this file is taking over the real route, the full
  // flow needs to genuinely live here rather than link to a screen that
  // no longer exists. ----
  const { user } = useAuth();
  const pro = isPaidTier(user?.tier);
  const [methodPickerOpen, setMethodPickerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [contactsImportOpen, setContactsImportOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [busyInvite, setBusyInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteRecipient, setInviteRecipient] = useState<{ name: string; phone: string; email_sent?: boolean; detail?: string } | null>(null);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [addPostcode, setAddPostcode] = useState('');
  const [addLicence, setAddLicence] = useState('');
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const showSnack = (msg: string) => { setSnack(msg); setTimeout(() => setSnack(null), 3500); };

  const handleFabPress = () => {
    if (!canAddStudent(user?.tier, students.length)) { setPaywallOpen(true); return; }
    setMethodPickerOpen(true);
  };
  const chooseManualEntry = () => {
    setMethodPickerOpen(false);
    setTimeout(() => setAddOpen(true), 220);
  };
  const chooseContactsImport = () => {
    setMethodPickerOpen(false);
    setTimeout(() => setContactsImportOpen(true), 220);
  };
  const copyInviteLink = () => { if (inviteLink) copyToClipboard(inviteLink); };
  const smsInviteLink = async () => {
    if (!inviteLink || !inviteRecipient) return;
    const body = `Hi ${inviteRecipient.name.split(' ')[0]}, your driving instructor has invited you to ADI Pro. Tap to sign up: ${inviteLink}`;
    await openSmsComposer(inviteRecipient.phone, body);
  };

  const submitAddStudent = async () => {
    setAddFormError(null);
    if (!addName.trim()) { setAddFormError('Please enter the student\u2019s full name'); return; }
    if (!addEmail.trim()) { setAddFormError('Please enter an email address'); return; }
    if (!addPhone.trim()) { setAddFormError('Please enter a phone number'); return; }
    const licence = addLicence.replace(/\s+/g, '').toUpperCase();
    if (!licence) { setAddFormError('Please enter the provisional licence number'); return; }
    if (licence.length !== 16) { setAddFormError('Provisional licence number must be 16 characters'); return; }
    if (!canAddStudent(user?.tier, students.length)) { setAddOpen(false); setPaywallOpen(true); return; }

    setBusyInvite(true);
    try {
      const studentName = addName.trim();
      const studentPhone = addPhone.trim();
      const created = await createStudent({
        name: studentName,
        email: addEmail.trim().toLowerCase(),
        phone: studentPhone,
        address: addAddress.trim(),
        postcode: addPostcode.trim().toUpperCase(),
        provisional_licence: licence,
      });

      let emailSent = false;
      let inviteDetail = '';
      try {
        const res = await api.post('/v2/students/invite', {
          email: addEmail.trim().toLowerCase(),
          student_name: studentName,
          student_id: created.id,
        });
        emailSent = !!res.data?.sent;
        inviteDetail = res.data?.detail || '';
      } catch (err: any) {
        inviteDetail = err?.response?.data?.detail || err?.message || 'Could not send invite email';
      }

      const payload = btoa(JSON.stringify({
        email: addEmail.trim().toLowerCase(),
        name: studentName,
        student_id: created.id,
        instructor_id: created.instructor_id,
        school_id: created.school_id,
      }));
      const appOrigin = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.EXPO_PUBLIC_APP_URL || 'https://adiapp.netlify.app');
      const inviteUrl = `${appOrigin}/?invite=${payload}`;

      setAddName(''); setAddEmail(''); setAddPhone(''); setAddAddress(''); setAddPostcode(''); setAddLicence('');
      setAddOpen(false);
      setInviteLink(inviteUrl);
      setInviteRecipient({ name: studentName, phone: studentPhone, email_sent: emailSent, detail: inviteDetail });

      if (pro) {
        const note = emailSent
          ? `Invite email sent to ${addEmail.trim().toLowerCase()}.`
          : `${studentName} added. ${inviteDetail || 'Share the invite link manually.'}`;
        fireInstantNotification('Student invited', note).catch(() => {});
      }
      refresh?.();
    } catch (e: any) {
      const upgradeMsg = explainLimitError(e);
      if (upgradeMsg) {
        setAddFormError(upgradeMsg + ' Tap below to upgrade.');
        Alert.alert('Student limit reached', upgradeMsg, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'See plans', onPress: () => router.push('/pricing-screen' as any) },
        ]);
      } else {
        setAddFormError(e?.message || e?.response?.data?.detail || 'Failed to create student');
      }
    } finally {
      setBusyInvite(false);
    }
  };
  // ---- End of add-student flow ----


  useEffect(() => {
    if (params?.filter === 'arrears') setArrearsActive(true);
  }, [params?.filter]);

  useEffect(() => {
    listStudentBalances()
      .then((rows) => {
        const map: Record<string, number> = {};
        for (const r of rows) map[r.student_id] = r.outstanding_gbp;
        setBalances(map);
      })
      .catch(() => {});
  }, [students.length]);

  useEffect(() => {
    if (students.length === 0) return;
    let cancelled = false;
    listHoursBalanceForStudents(students.map((s) => s.id))
      .then((map) => { if (!cancelled) setHoursBalances(map); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [students]);

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const q = search.toLowerCase();
      const matchQ = !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
      const matchF = filter === 'All' || s.status === filter;
      const matchArrears = !arrearsActive || (balances[s.id] ?? 0) > 0;
      return matchQ && matchF && matchArrears;
    });
  }, [students, search, filter, arrearsActive, balances]);

  const counts = useMemo(() => ({
    Active: students.filter((s) => s.status === 'Active').length,
    'Test Ready': students.filter((s) => s.status === 'Test Ready').length,
    New: students.filter((s) => s.status === 'New').length,
    Passed: students.filter((s) => s.status === 'Passed').length,
    Inactive: students.filter((s) => s.status === 'Inactive').length,
    Waitlist: students.filter((s) => s.status === 'Waitlist').length,
  }), [students]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.resolve(refresh?.()).finally(() => setRefreshing(false));
  }, [refresh]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header + search */}
      <View style={s.headerBlock}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <Text style={s.title}>Students</Text>
          <Text style={s.countLine}>
            {filtered.length} of {students.length}
          </Text>
        </View>

        <View style={s.searchWrap}>
          <View style={s.searchDot} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name or email"
            placeholderTextColor={C.faint}
            testID="v2-students-search"
          />
          {!!search && (
            <TouchableOpacity style={s.clearBtn} onPress={() => setSearch('')} testID="v2-clear-search">
              <Text style={s.clearBtnText}>×</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter chips */}
      <View style={{ flexDirection: 'row' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingHorizontal: 20, paddingVertical: 12 }}>
          {FILTERS.map((f) => {
            const active = filter === f;
            const count = f === 'All' ? students.length : counts[f as Exclude<FilterChip, 'All'>];
            return (
              <TouchableOpacity
                key={f}
                style={[s.filterChip, active && s.filterChipActive]}
                onPress={() => setFilter(f)}
                testID={`v2-filter-${f}`}
              >
                <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{f}</Text>
                <Text style={[s.filterCount, active && s.filterCountActive]}>{count}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {arrearsActive && (
        <TouchableOpacity style={s.arrearsBanner} onPress={() => setArrearsActive(false)} testID="v2-clear-arrears">
          <Text style={s.arrearsBannerText}>Showing pupils in arrears only — tap to clear</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading && students.length === 0 ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={{ paddingVertical: 44, alignItems: 'center', gap: 6 }}>
            <Text style={s.emptyTitle}>No students match</Text>
            <Text style={s.emptySub}>Try a different name or clear the filter.</Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {filtered.map((st) => {
              const status = STATUS_STYLE[st.status] || STATUS_STYLE.New;
              const isOpen = expandedId === st.id;
              const owed = balances[st.id] ?? 0;
              const hours = hoursBalances[st.id] ?? 0;
              return (
                <View key={st.id} style={[s.card, isOpen && s.cardOpen]} testID={`v2-student-${st.id}`}>
                  <TouchableOpacity
                    style={s.cardHead}
                    onPress={() => setExpandedId(isOpen ? null : st.id)}
                    testID={`v2-student-toggle-${st.id}`}
                  >
                    <View style={[s.tile, { backgroundColor: status.solid }]}>
                      <Text style={s.tileText}>{initialsOf(st.name)}</Text>
                    </View>

                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      {!!st.test_date && (
                        <Text style={s.testBadge}>
                          Test {new Date(`${st.test_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </Text>
                      )}
                      <Text style={s.name} numberOfLines={1}>{st.name}</Text>
                      <Text style={s.meta} numberOfLines={1}>
                        {st.lessons_count} lesson{st.lessons_count === 1 ? '' : 's'}
                        {st.progress != null ? ` · ${st.progress}% ready` : ''}
                      </Text>
                    </View>

                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[s.statusBadge, { backgroundColor: status.bg, color: status.fg }]}>
                        {st.status}
                      </Text>
                      {owed > 0 ? (
                        <Text style={s.owedBadge}>£{owed.toFixed(2)} due</Text>
                      ) : hours > 0 ? (
                        <Text style={s.hoursBadge}>{hours.toFixed(1)}h left</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>

                  {isOpen && (
                    <View style={{ paddingHorizontal: 14, paddingBottom: 13, gap: 10 }}>
                      <View style={s.actionRow}>
                        <TouchableOpacity
                          style={[s.action, s.actionPrimary]}
                          onPress={() => router.push({ pathname: '/student-lifecycle-screen', params: { id: st.id } } as any)}
                          testID={`v2-open-profile-${st.id}`}
                        >
                          <Text style={s.actionPrimaryText}>Open profile</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.action}
                          onPress={() => router.push('/lesson-diary-screen' as any)}
                          testID={`v2-book-${st.id}`}
                        >
                          <Text style={s.actionText}>Book</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={{ gap: 5 }}>
                        {[
                          { k: 'Email', v: st.email || '—' },
                          { k: 'Phone', v: st.phone || '—' },
                          { k: 'Rate', v: st.hourly_rate ? `£${st.hourly_rate}/hr` : '—' },
                          ...(st.next_lesson
                            ? [{ k: 'Next', v: new Date(st.next_lesson).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) }]
                            : []),
                        ].map((d) => (
                          <View key={d.k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                            <Text style={s.detailKey}>{d.k}</Text>
                            <Text style={s.detailValue} numberOfLines={1}>{d.v}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${Math.min(100, st.progress ?? 0)}%`, backgroundColor: status.solid }]} />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={s.fab} onPress={handleFabPress} testID="v2-add-student">
        <Text style={s.fabText}>{pro || canAddStudent(user?.tier, students.length) ? '+ Add student' : '★ Add student'}</Text>
      </TouchableOpacity>

      <BottomNav role="instructor" />

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason={`${tierById(user?.tier).name} tier is limited to ${tierById(user?.tier).student_limit} students. You currently have ${students.length}.`}
      />

      {snack && (
        <View style={s.snackbar} testID="v2-snackbar">
          <Text style={s.snackbarText}>{snack}</Text>
        </View>
      )}

      {/* Method picker */}
      <BottomSheet visible={methodPickerOpen} onClose={() => setMethodPickerOpen(false)} title="Add new student" testID="v2-sheet-method-picker">
        <Text style={s.sheetHint}>How would you like to add this student?</Text>
        {Platform.OS !== 'web' && (
          <TouchableOpacity style={s.methodCard} onPress={chooseContactsImport} testID="v2-method-contacts">
            <Text style={s.methodTitle}>Import from address book</Text>
            <Text style={s.methodSub}>Pick from your phone Contacts. Quickest for several students at once.</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.methodCard} onPress={chooseManualEntry} testID="v2-method-manual">
          <Text style={s.methodTitle}>Enter details manually</Text>
          <Text style={s.methodSub}>Type the student&apos;s name, contact details and licence number.</Text>
        </TouchableOpacity>
      </BottomSheet>

      <ContactsImportSheet
        visible={contactsImportOpen}
        onClose={() => setContactsImportOpen(false)}
        onImported={(count) => {
          if (count > 0) { showSnack(`${count} student${count === 1 ? '' : 's'} imported from Contacts`); refresh?.(); }
        }}
      />

      {/* Manual entry form */}
      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Invite new student" testID="v2-sheet-add-student">
        <Text style={s.sheetHint}>We&apos;ll generate a private invite link you can copy or send by SMS.</Text>
        <Text style={s.fieldLabel}>Full name *</Text>
        <TextInput style={s.fieldInput} value={addName} onChangeText={setAddName} placeholder="e.g. Charlotte Smith" placeholderTextColor={C.faint} testID="v2-input-name" />
        <Text style={s.fieldLabel}>Email address *</Text>
        <TextInput style={s.fieldInput} value={addEmail} onChangeText={setAddEmail} autoCapitalize="none" keyboardType="email-address" placeholder="name@example.co.uk" placeholderTextColor={C.faint} testID="v2-input-email" />
        <Text style={s.fieldLabel}>Phone *</Text>
        <TextInput style={s.fieldInput} value={addPhone} onChangeText={setAddPhone} keyboardType="phone-pad" placeholder="07700 900000" placeholderTextColor={C.faint} testID="v2-input-phone" />
        <Text style={s.fieldLabel}>Address (optional)</Text>
        <TextInput style={s.fieldInput} value={addAddress} onChangeText={setAddAddress} placeholder="12 High Street" placeholderTextColor={C.faint} testID="v2-input-address" />
        <Text style={s.fieldLabel}>Postcode (optional)</Text>
        <TextInput style={s.fieldInput} value={addPostcode} onChangeText={setAddPostcode} autoCapitalize="characters" placeholder="SW1A 1AA" placeholderTextColor={C.faint} testID="v2-input-postcode" />
        <Text style={s.fieldLabel}>Provisional licence number *</Text>
        <TextInput style={s.fieldInput} value={addLicence} onChangeText={(v) => setAddLicence(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={20} placeholder="SMITH911206 23A6L 79" placeholderTextColor={C.faint} testID="v2-input-licence" />
        <Text style={s.fieldHelper}>16-character DVLA driver number on the front of the pink licence (DD1).</Text>
        {!!addFormError && <Text style={s.formError}>{addFormError}</Text>}
        <TouchableOpacity style={[s.submitBtn, busyInvite && { opacity: 0.6 }]} onPress={submitAddStudent} disabled={busyInvite} testID="v2-btn-submit-student">
          {busyInvite ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Generate invite link</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* Invite link result */}
      <BottomSheet
        visible={!!inviteLink}
        onClose={() => { setInviteLink(null); setInviteRecipient(null); }}
        title="Invite link ready"
        testID="v2-sheet-invite-link"
      >
        {inviteLink && inviteRecipient && (
          <View style={{ gap: 14 }}>
            {inviteRecipient.email_sent ? (
              <View style={s.emailBanner} testID="v2-invite-email-sent">
                <Text style={s.emailBannerTitle}>Invite email sent</Text>
                <Text style={s.emailBannerText}>{inviteRecipient.detail || `${inviteRecipient.name} will receive a sign-up link in their inbox.`}</Text>
              </View>
            ) : (
              <View style={s.emailBannerWarn} testID="v2-invite-email-fallback">
                <Text style={s.emailBannerWarnTitle}>Email not sent</Text>
                <Text style={s.emailBannerText}>{inviteRecipient.detail || 'Could not send the invite email automatically. Share the link below manually.'}</Text>
              </View>
            )}
            <Text style={s.sheetHint}>
              You can also share this back-up link with {inviteRecipient.name}. They&apos;ll set their own password and join your roster.
            </Text>
            <View style={s.linkBox} testID="v2-invite-link-value">
              <Text style={s.linkText} numberOfLines={2}>{inviteLink}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <TouchableOpacity style={[s.linkBtn, { backgroundColor: C.primary }]} onPress={copyInviteLink} testID="v2-btn-copy-invite">
                <Text style={s.linkBtnText}>Copy link</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.linkBtn, { backgroundColor: C.accent }]} onPress={smsInviteLink} testID="v2-btn-sms-invite">
                <Text style={s.linkBtnText}>Send via SMS</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },

  headerBlock: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 30, letterSpacing: -0.75, color: C.text },
  countLine: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.textMuted },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 46, marginTop: 12, paddingHorizontal: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 14 },
  searchDot: { width: 14, height: 14, borderWidth: 2, borderColor: C.faint, borderRadius: 999 },
  searchInput: { flex: 1, minWidth: 0, fontFamily: 'Barlow_500Medium', fontSize: 15, color: C.text },
  clearBtn: { width: 26, height: 26, borderRadius: 999, backgroundColor: C.chipTrack, alignItems: 'center', justifyContent: 'center' },
  clearBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13, color: C.textMuted },

  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.text, borderColor: C.text },
  filterChipText: { fontFamily: 'Barlow_700Bold', fontSize: 13, color: C.textMuted },
  filterChipTextActive: { color: '#fff' },
  filterCount: { fontFamily: 'Archivo_700Bold', fontSize: 11.5, color: C.faint },
  filterCountActive: { color: 'rgba(255,255,255,.7)' },

  arrearsBanner: { marginHorizontal: 20, marginBottom: 10, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA' },
  arrearsBannerText: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#C2410C' },

  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, overflow: 'hidden' },
  cardOpen: { borderColor: C.text, borderWidth: 1.5 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  tile: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 15, color: '#fff' },
  testBadge: { alignSelf: 'flex-start', fontFamily: 'Archivo_800ExtraBold', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: '#fff', backgroundColor: C.text, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  name: { fontFamily: 'Archivo_700Bold', fontSize: 16.5, letterSpacing: -0.15, color: C.text },
  meta: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.textMuted2 },
  statusBadge: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 0.9, textTransform: 'uppercase', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  owedBadge: { fontFamily: 'Barlow_700Bold', fontSize: 11.5, color: '#C2410C', backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  hoursBadge: { fontFamily: 'Barlow_700Bold', fontSize: 11.5, color: '#047857', backgroundColor: '#D1FAE5', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },

  actionRow: { flexDirection: 'row', gap: 7, paddingTop: 11, borderTopWidth: 1, borderTopColor: C.divider },
  action: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: '#fff' },
  actionPrimary: { backgroundColor: C.primary, borderColor: C.primary },
  actionText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: C.text },
  actionPrimaryText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: '#fff' },

  detailKey: { fontFamily: 'Barlow_600SemiBold', fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: C.faint, paddingTop: 2 },
  detailValue: { flex: 1, fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.text, textAlign: 'right' },

  progressTrack: { height: 4, backgroundColor: C.divider },
  progressFill: { height: '100%' },

  emptyTitle: { fontFamily: 'Archivo_700Bold', fontSize: 17, color: C.text },
  emptySub: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: C.textMuted },

  fab: { position: 'absolute', right: 20, bottom: 96, height: 52, paddingHorizontal: 20, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', shadowColor: C.accent, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 8 },
  fabText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: '#fff' },

  snackbar: { position: 'absolute', left: 20, right: 20, bottom: 96, backgroundColor: '#0F172A', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16 },
  snackbarText: { fontFamily: 'Barlow_600SemiBold', fontSize: 13.5, color: '#fff' },

  sheetHint: { fontFamily: 'Barlow_400Regular', fontSize: 13.5, lineHeight: 19, color: C.textMuted, marginBottom: 12 },
  methodCard: { flexDirection: 'column', gap: 4, padding: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 14, marginBottom: 10 },
  methodTitle: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },
  methodSub: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 17.5, color: C.textMuted },

  fieldLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: C.faint, marginTop: 12, marginBottom: 5 },
  fieldInput: { height: 46, paddingHorizontal: 13, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: '#fff', fontFamily: 'Barlow_400Regular', fontSize: 14, color: C.text },
  fieldHelper: { fontFamily: 'Barlow_400Regular', fontSize: 11.5, lineHeight: 16, color: C.textMuted, marginTop: 5 },
  formError: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#B91C1C', marginTop: 10 },
  submitBtn: { marginTop: 18, minHeight: 50, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  submitBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: '#fff' },

  emailBanner: { backgroundColor: '#D1FAE5', borderWidth: 1, borderColor: '#10B981', borderRadius: 13, padding: 12 },
  emailBannerTitle: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: '#047857' },
  emailBannerWarn: { backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 13, padding: 12 },
  emailBannerWarnTitle: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: '#92400E' },
  emailBannerText: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 17.5, color: C.text, marginTop: 4 },
  linkBox: { backgroundColor: C.chipTrack, borderRadius: 12, padding: 12 },
  linkText: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.textMuted2 },
  linkBtn: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linkBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: '#fff' },
});
