import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Lock, FileText, Download } from 'lucide-react-native';
import { PaywallModal } from '../src/PaywallModal';
import { useAuth } from '../src/AuthContext';
import { mockDb } from '../src/mockDb';
import { BottomSheet } from '../src/BottomSheet';
import { TestOutcomeModal } from '../src/TestOutcomeModal';
import { buildInvoiceHtml, generateAndShareInvoicePdf } from '../src/invoice';
import {
  useStudent, patchStudent, passStudent, useLessonsForStudent, useCompetencies,
  useTestOutcomesForStudent, useMockTestAttempts, setStudentStatusAsync, removeStudentViaApi,
} from '../src/useSupabaseData';
import {
  getPendingDeletionRequestForStudent, type GdprDeletionRequest, getMySchoolProfile,
  listLessonNotesForStudent, listMyLessonNoteQuestions, type InstructorLessonNote, type LessonNoteQuestion,
} from '../src/supabaseDb';
import { isPaidTier } from '../src/tiers';
import { OpenInMapsButton } from '../src/OpenInMapsButton';
import { openSmsComposer } from '../src/tools';
import { colorForLessonType } from '../src/diary/lessonTypes';

/**
 * Student Profile — redesigned visual direction from the Claude Design
 * handoff (23 Aug 2026), promoted to live on 24 Aug 2026 after review as
 * student-profile-v2-screen. This is now the real, live student profile —
 * the biggest, most-layered screen in the app.
 *
 * The handoff's own comment said it covered "the same content blocks that
 * screen renders" — but checked against the real source, it was missing
 * three genuinely real, working features built later in this session: the
 * GDPR pending-deletion banner, customizable instructor lesson notes, and
 * the "Request a Google review" button. Confirmed with Grant before
 * building; all three included using the new visual language.
 *
 * Three more things fixed as part of promoting this to live (24 Aug 2026):
 *   - Amend, the instructor notes editor, and Log test were all wrongly
 *     built as navigation to another screen in the original v2 trial. The
 *     real screen never left this one at all — all three are genuinely
 *     local bottom sheets, ported in properly here. Log test reuses the
 *     existing, already-working TestOutcomeModal component.
 *   - A real bug: the competency-detail-screen link passed studentId/
 *     category_key, but that screen actually reads params.id/params.key
 *     — every tap would have landed with a missing student and always
 *     defaulted to the "controls" category regardless of what was tapped.
 *     Fixed here, and in student-app-v2-screen.tsx too (same bug, found
 *     while checking this one, fixed ahead of its own swap).
 *
 * Real "Driving readiness" criteria, same approach as student-app-v2:
 * genuinely computed, not the design's example numbers.
 */

const C = {
  pageBg: '#DCD6CA',
  surface: '#F5F2EC',
  border: '#E4DED2',
  divider: '#EDE8DE',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  faint: '#A69C8B',
  primary: '#00539F',
  accent: '#FF6B00',
  ink: '#0F172A',
  warmBg: '#FFF7ED',
  warmBorder: '#FED7AA',
  warmText: '#C2410C',
  dangerBg: '#FEF2F2',
  dangerBorder: '#FECACA',
  dangerText: '#B91C1C',
};

const STATUS_STYLE: Record<string, { bg: string; fg: string; solid: string }> = {
  New: { bg: '#E5F0FA', fg: '#00539F', solid: '#00539F' },
  Active: { bg: '#D1FAE5', fg: '#047857', solid: '#047857' },
  'Test Ready': { bg: '#FFF7ED', fg: '#C2410C', solid: '#C2410C' },
  Passed: { bg: '#0F172A', fg: '#fff', solid: '#0F172A' },
  Inactive: { bg: '#EDE8DE', fg: '#8A8172', solid: '#A69C8B' },
  Waitlist: { bg: '#FEF3C7', fg: '#92400E', solid: '#92400E' },
};

const MANOEUVRE_KEYS = ['parallel_park', 'bay_park_forward', 'bay_park_reverse', 'pull_up_right', 'emergency_stop'];
const MIN_LESSONS = 25;
const READY_LEVEL = 4;

type Tab = 'overview' | 'lessons' | 'competency' | 'earnings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'competency', label: 'Competency' },
  { key: 'earnings', label: 'Earnings' },
];

function initialsOf(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function StudentProfileV2Screen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { user } = useAuth();
  const pro = isPaidTier(user?.tier);
  // Route recording is a Growth+ feature (31 Aug 2026) — this is the
  // second of two entry points to route-recorder-screen (the other is
  // LessonToolsSheet's identical button), found while fixing the first one.
  const [routePaywallOpen, setRoutePaywallOpen] = useState(false);
  const [invoicePaywallOpen, setInvoicePaywallOpen] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const id = (params.id as string) || '';

  const [tab, setTab] = useState<Tab>('overview');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // ---- Amend / Notes / Log test — all three genuinely local, ported in
  // (24 Aug 2026) from the real student-lifecycle-screen. The original
  // v2 trial wrongly assumed these navigated to another screen; the real
  // screen opens local sheets and never left this one at all. ----
  const [amendOpen, setAmendOpen] = useState(false);
  const [aName, setAName] = useState('');
  const [aEmail, setAEmail] = useState('');
  const [aPhone, setAPhone] = useState('');
  const [aAddress, setAAddress] = useState('');
  const [aPostcode, setAPostcode] = useState('');
  const [aHourlyRate, setAHourlyRate] = useState('');
  const [aTestDate, setATestDate] = useState('');
  const [aLicence, setALicence] = useState('');
  const [savingAmend, setSavingAmend] = useState(false);

  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const [testOutcomeOpen, setTestOutcomeOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [snack, setSnack] = useState<{ message: string; undoTo: 'Active' | 'Inactive' | 'Waitlist' | null } | null>(null);
  const snackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { student: sbStudent, loading: studentLoading } = useStudent(id);
  const student = sbStudent || mockDb.getStudent(id);

  const { lessons: sbLessons } = useLessonsForStudent(student?.id);
  const lessons = useMemo(
    () => (sbStudent ? (sbLessons || []) : (student ? mockDb.listLessonsForStudent(student.id) : [])),
    [sbStudent, sbLessons, student?.id],
  );

  const { competencies: sbCompetencies } = useCompetencies(sbStudent ? student?.id : undefined);
  const competencies = useMemo(
    () => (sbStudent ? (sbCompetencies || []) : (student ? mockDb.getCompetencies(student.id) : [])),
    [sbStudent, sbCompetencies, student?.id],
  );

  const { rows: testOutcomes } = useTestOutcomesForStudent(student?.id);
  const { attempts: mockAttempts } = useMockTestAttempts(student?.id);

  const [pendingGdprRequest, setPendingGdprRequest] = useState<GdprDeletionRequest | null>(null);
  const [lessonNotesHistory, setLessonNotesHistory] = useState<InstructorLessonNote[]>([]);
  const [lessonNoteQuestions, setLessonNoteQuestions] = useState<LessonNoteQuestion[]>([]);
  useEffect(() => {
    if (!student?.id) return;
    getPendingDeletionRequestForStudent(student.id).then(setPendingGdprRequest).catch(() => {});
    listLessonNotesForStudent(student.id).then(setLessonNotesHistory).catch(() => {});
    if (user?.instructor_id) {
      listMyLessonNoteQuestions(user.instructor_id).then(setLessonNoteQuestions).catch(() => {});
    }
  }, [student?.id, user?.instructor_id]);
  const questionTextById = useMemo(
    () => Object.fromEntries(lessonNoteQuestions.map((q) => [q.id, q.question_text])),
    [lessonNoteQuestions],
  );
  const hasPassedPracticalTest = student?.status === 'Passed'
    || testOutcomes.some((o) => o.test_type === 'practical' && o.result === 'pass');

  const handleRequestReview = async () => {
    let schoolProfile: Awaited<ReturnType<typeof getMySchoolProfile>> = null;
    try { schoolProfile = await getMySchoolProfile(); } catch { /* treated as not-set below */ }
    const reviewUrl = schoolProfile?.google_review_url;
    if (!reviewUrl) {
      Alert.alert(
        'No review link set',
        "You haven't added a Google review link yet. Set one in School Profile first, then come back to send this.",
        [{ text: 'Not now', style: 'cancel' }, { text: 'Go to School Profile', onPress: () => router.push('/school-profile-screen' as any) }],
      );
      return;
    }
    const firstName = (student?.name || 'there').split(' ')[0];
    const message = `Hi ${firstName}, congratulations again on passing! If you have a moment, we'd love a Google review: ${reviewUrl}\n\nP.s. include your pass photo!`;
    openSmsComposer(student?.phone || '', message);
  };

  // PDF invoices (31 Aug 2026) — Growth+ per tiers.ts, but buildInvoiceHtml/
  // generateAndShareInvoicePdf were fully built and never actually called
  // from anywhere in the app at all, found during a tier-gating audit.
  // Invoices the student's paid lessons (matches what the Earnings tab's
  // "Recent payments" list already shows) rather than every lesson,
  // since an invoice for unpaid/free lessons wouldn't make sense.
  const handleGenerateInvoice = async () => {
    if (!pro) { setInvoicePaywallOpen(true); return; }
    if (!student) return;
    const paidLessons = lessons.filter((l) => l.amount_paid);
    if (paidLessons.length === 0) {
      Alert.alert('No paid lessons yet', "This student doesn't have any paid lessons to invoice yet.");
      return;
    }
    setGeneratingInvoice(true);
    try {
      let schoolProfile: Awaited<ReturnType<typeof getMySchoolProfile>> = null;
      try { schoolProfile = await getMySchoolProfile(); } catch { /* falls back to default branding below */ }
      const issuedAt = new Date();
      const invoiceNo = `${issuedAt.getFullYear()}${String(issuedAt.getMonth() + 1).padStart(2, '0')}${String(issuedAt.getDate()).padStart(2, '0')}-${student.id.slice(0, 6).toUpperCase()}`;
      const html = buildInvoiceHtml({
        invoiceNo,
        instructorName: user?.name || 'Your instructor',
        instructorEmail: user?.email || '',
        student,
        lessons: paidLessons,
        issuedAt,
        schoolName: schoolProfile?.business_name,
        schoolLogoUrl: schoolProfile?.logo_url,
        schoolContactEmail: schoolProfile?.contact_email,
        schoolContactPhone: schoolProfile?.contact_phone,
        schoolAddress: schoolProfile?.address,
      });
      const result = await generateAndShareInvoicePdf(html, `Invoice-${invoiceNo}.pdf`);
      if (!result.ok) Alert.alert('Could not generate invoice', result.error || 'Please try again.');
    } catch (e: any) {
      Alert.alert('Could not generate invoice', e?.message || 'Please try again.');
    } finally {
      setGeneratingInvoice(false);
    }
  };

  const levelByKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of competencies) map[c.category_key] = c.level;
    return map;
  }, [competencies]);

  const readiness = useMemo(() => {
    const completed = lessons.filter((l) => l.status === 'Completed');
    const hasMockPass = mockAttempts.some((a) => a.passed);
    const hasTheoryOutcome = testOutcomes.some((o) => o.test_type === 'theory' && o.result === 'pass');
    const manoeuvresReady = MANOEUVRE_KEYS.every((k) => (levelByKey[k] || 0) >= READY_LEVEL);
    const independentReady = (levelByKey.independent_driving || 0) >= READY_LEVEL;
    const criteria = [
      { key: 'lessons', label: `Minimum ${MIN_LESSONS} lessons`, met: completed.length >= MIN_LESSONS },
      { key: 'mock_test', label: 'Mock test passed', met: hasMockPass },
      { key: 'theory', label: 'Theory test passed', met: hasTheoryOutcome },
      { key: 'manoeuvres', label: 'All manoeuvres at Level 4+', met: manoeuvresReady },
      { key: 'independent', label: 'Independent driving (Level 4+)', met: independentReady },
    ];
    const met = criteria.filter((c) => c.met).length;
    return { criteria, met, total: criteria.length, pct: Math.round((met / criteria.length) * 100) };
  }, [lessons, mockAttempts, testOutcomes, levelByKey]);

  const showSnack = (message: string, undoTo: 'Active' | 'Inactive' | 'Waitlist' | null) => {
    if (snackTimeoutRef.current) clearTimeout(snackTimeoutRef.current);
    setSnack({ message, undoTo });
    snackTimeoutRef.current = setTimeout(() => setSnack(null), 5000);
  };

  const runStatusChange = async (next: 'Active' | 'Inactive' | 'Waitlist', previous?: string) => {
    if (!student) return;
    try {
      await setStudentStatusAsync(student.id, next);
      if (previous && next !== 'Active') {
        showSnack(next === 'Inactive' ? `${student.name} marked as inactive.` : `${student.name} moved to the waiting list.`, previous as any);
      } else if (next === 'Active') {
        showSnack(`${student.name} reactivated.`, null);
      }
    } catch (e: any) {
      Alert.alert('Update failed', e?.message || 'Could not update status');
    }
  };

  const handleUndo = () => {
    if (!snack?.undoTo) return;
    const target = snack.undoTo;
    setSnack(null);
    if (snackTimeoutRef.current) clearTimeout(snackTimeoutRef.current);
    runStatusChange(target);
  };

  const openAmend = () => {
    if (!student) return;
    setAName(student.name);
    setAEmail(student.email);
    setAPhone(student.phone);
    setAAddress(student.address || '');
    setAPostcode(student.postcode || '');
    setAHourlyRate(String(student.hourly_rate));
    setATestDate(student.test_date ? student.test_date.slice(0, 10) : '');
    setALicence(student.provisional_licence || '');
    setAmendOpen(true);
  };

  const saveAmend = async () => {
    if (!student) return;
    const rate = parseInt(aHourlyRate, 10);
    if (!aName.trim()) {
      Alert.alert('Name required', "Please enter the student\u2019s full name.");
      return;
    }
    const licence = aLicence.replace(/\s+/g, '').toUpperCase();
    if (!licence) {
      Alert.alert('Licence required', 'Please enter the provisional licence number.');
      return;
    }
    if (licence !== 'PENDING' && licence.length !== 16) {
      Alert.alert('Invalid licence', 'Provisional licence number must be 16 characters.');
      return;
    }
    setSavingAmend(true);
    try {
      await patchStudent(student.id, {
        name: aName.trim(),
        email: aEmail.trim(),
        phone: aPhone.trim(),
        address: aAddress.trim(),
        postcode: aPostcode.trim().toUpperCase(),
        hourly_rate: Number.isFinite(rate) && rate > 0 ? rate : student.hourly_rate,
        test_date: aTestDate ? new Date(aTestDate).toISOString() : null,
        provisional_licence: licence,
      });
      setAmendOpen(false);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save changes');
    } finally {
      setSavingAmend(false);
    }
  };

  const openNotesEditor = () => {
    if (!student) return;
    setNotesDraft(student.notes || '');
    setNotesOpen(true);
  };

  const saveNotes = async () => {
    if (!student) return;
    setSavingNotes(true);
    try {
      await patchStudent(student.id, { notes: notesDraft.trim() ? notesDraft.trim() : null });
      setNotesOpen(false);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save notes');
    } finally {
      setSavingNotes(false);
    }
  };
  // ---- End of Amend / Notes / Log test ----

  const handleDelete = async () => {
    if (!student) return;
    setDeleting(true);
    try {
      await removeStudentViaApi(student.id);
      setDeleteConfirmOpen(false);
      setTimeout(() => router.back(), 80);
    } catch (e: any) {
      setDeleting(false);
      Alert.alert('Delete failed', e?.message || 'Could not delete student');
    }
  };

  const totalEarnings = lessons.reduce((sum, l) => sum + (l.amount_paid || 0), 0);
  const totalHours = lessons.reduce((sum, l) => sum + l.duration_hours, 0);
  const completedCount = lessons.filter((l) => l.status === 'Completed').length;

  if (studentLoading && !student) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.primary} />
        </View>
      </SafeAreaView>
    );
  }
  if (!student) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={s.emptyTitle}>Student not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = STATUS_STYLE[student.status] || STATUS_STYLE.New;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.surface}>
        <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 40 }}>
            <TouchableOpacity style={s.navBtn} onPress={() => router.back()} testID="v2-profile-back">
              <ArrowLeft size={17} color={C.text} />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              <TouchableOpacity
                style={s.amendBtn}
                onPress={openAmend}
                testID="v2-amend"
              >
                <Text style={s.amendBtnText}>Amend</Text>
              </TouchableOpacity>
              {student.status !== 'Passed' && (
                <TouchableOpacity
                  style={[s.passedBtn, { backgroundColor: status.solid }]}
                  onPress={() => passStudent(student.id).catch(() => {})}
                  testID="v2-mark-passed"
                >
                  <Text style={s.passedBtnText}>Passed</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 12 }}>
            <View style={[s.avatar, { backgroundColor: status.solid }]}>
              <Text style={s.avatarText}>{initialsOf(student.name)}</Text>
            </View>
            <View style={{ minWidth: 0, gap: 4 }}>
              <Text style={s.name} numberOfLines={1}>{student.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text style={[s.statusBadge, { backgroundColor: status.bg, color: status.fg }]}>{student.status}</Text>
                <Text style={s.subline}>{student.email}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 20, paddingTop: 14 }}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[s.tab, tab === t.key && s.tabActive]}
              onPress={() => setTab(t.key)}
              testID={`v2-tab-${t.key}`}
            >
              <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 60 }}>
          {tab === 'overview' && (
            <>
              <View style={s.readyCard}>
                <View style={s.readyInner}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={s.readyLabel}>Driving readiness</Text>
                    {!!student.test_date && (
                      <Text style={s.testFlag}>
                        Test {new Date(`${student.test_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9, marginTop: 8 }}>
                    <Text style={s.readyPct}>{readiness.pct}</Text>
                    <Text style={s.readyPctSign}>%</Text>
                    <Text style={s.readyLine} numberOfLines={1}>{readiness.met}/{readiness.total} criteria met</Text>
                  </View>
                  <View style={s.readyTrack}><View style={[s.readyFill, { width: `${readiness.pct}%` }]} /></View>
                  <View style={{ marginTop: 13, gap: 7 }}>
                    {readiness.criteria.map((c) => (
                      <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                        <Text style={[s.criteriaMark, { color: c.met ? '#6EE7B7' : 'rgba(255,255,255,.35)' }]}>{c.met ? '✓' : '○'}</Text>
                        <Text style={[s.criteriaLabel, { color: c.met ? '#fff' : 'rgba(255,255,255,.55)' }]}>{c.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 7, marginTop: 12 }}>
                {!!student.pickup_address && (
                  <OpenInMapsButton address={student.pickup_address} variant="pill" label="Directions" testID="v2-directions" />
                )}
                <TouchableOpacity
                  style={s.qaBtn}
                  onPress={() => openSmsComposer(student.phone || '', `Hi ${student.name.split(' ')[0]}, I've arrived for your lesson!`)}
                  testID="v2-arrived"
                >
                  <Text style={s.qaBtnText}>I&apos;ve arrived</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.qaBtn, !pro && { opacity: 0.55, flexDirection: 'row' }]}
                  onPress={() => pro ? router.push('/route-recorder-screen' as any) : setRoutePaywallOpen(true)}
                  testID="v2-record-route"
                >
                  {!pro && <Lock size={12} color={C.textMuted} style={{ marginRight: 4 }} />}
                  <Text style={s.qaBtnText}>Record route</Text>
                </TouchableOpacity>
              </View>

              {hasPassedPracticalTest && (
                <TouchableOpacity style={s.reviewBtn} onPress={handleRequestReview} testID="v2-request-review">
                  <Text style={s.reviewBtnText}>Request a Google review</Text>
                </TouchableOpacity>
              )}

              <View style={s.card}>
                {[
                  { k: 'Email', v: student.email || '—' },
                  { k: 'Phone', v: student.phone || '—' },
                  { k: 'Pickup', v: student.pickup_address || '—' },
                  { k: 'Rate', v: student.hourly_rate ? `£${student.hourly_rate}/hr` : '—' },
                ].map((d) => (
                  <View key={d.k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                    <Text style={s.detailKey}>{d.k}</Text>
                    <Text style={s.detailValue} numberOfLines={1}>{d.v}</Text>
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <View style={s.statTile}><Text style={s.statValue}>{completedCount}</Text><Text style={s.statLabel}>Lessons</Text></View>
                <View style={s.statTile}><Text style={s.statValue}>{totalHours.toFixed(1)}h</Text><Text style={s.statLabel}>Hours</Text></View>
                <View style={s.statTile}><Text style={s.statValue}>£{student.hourly_rate || 0}</Text><Text style={s.statLabel}>Rate</Text></View>
              </View>

              <View style={s.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={s.sectionLabel}>Instructor notes</Text>
                  <TouchableOpacity style={s.editBtn} onPress={openNotesEditor} testID="v2-edit-notes">
                    <Text style={s.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                </View>
                <Text style={s.notesText}>{student.notes || 'No notes yet.'}</Text>
              </View>

              {lessonNotesHistory.length > 0 && (
                <View style={s.card}>
                  <Text style={s.sectionLabel}>Lesson notes</Text>
                  <View style={{ marginTop: 9, gap: 12 }}>
                    {lessonNotesHistory.slice(0, 3).map((note) => (
                      <View key={note.id} style={{ gap: 6, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.divider }}>
                        <Text style={s.lessonNoteDate}>
                          {new Date(note.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                        {Object.entries(note.answers)
                          .filter(([, answer]) => answer && answer.trim())
                          .map(([questionId, answer]) => (
                            <View key={questionId} style={{ gap: 2 }}>
                              <Text style={s.lessonNoteQ}>{questionTextById[questionId] || 'Question'}</Text>
                              <Text style={s.lessonNoteA}>{answer}</Text>
                            </View>
                          ))}
                      </View>
                    ))}
                  </View>
                  {lessonNotesHistory.length > 3 && (
                    <Text style={s.moreText}>Showing 3 most recent of {lessonNotesHistory.length} entries.</Text>
                  )}
                </View>
              )}

              <View style={s.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={s.sectionLabel}>Test outcomes</Text>
                  <TouchableOpacity style={s.logTestBtn} onPress={() => setTestOutcomeOpen(true)} testID="v2-log-test">
                    <Text style={s.logTestBtnText}>+ Log test</Text>
                  </TouchableOpacity>
                </View>
                {testOutcomes.length === 0 ? (
                  <Text style={s.emptyMuted}>No test outcomes logged yet.</Text>
                ) : (
                  <View style={{ marginTop: 10, gap: 9 }}>
                    {testOutcomes.map((o) => (
                      <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                        <Text style={[s.pill, o.result === 'pass' ? s.pillPass : s.pillFail]}>{o.result === 'pass' ? 'PASS' : 'FAIL'}</Text>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.outcomeTitle}>{o.test_type === 'practical' ? 'Practical test' : 'Theory test'}</Text>
                          <Text style={s.outcomeMeta} numberOfLines={1}>
                            {new Date(`${o.test_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={s.card}>
                <Text style={s.sectionLabel}>Mock test history</Text>
                {mockAttempts.length === 0 ? (
                  <Text style={s.emptyMuted}>No mock tests taken yet.</Text>
                ) : (
                  <View style={{ marginTop: 10, gap: 9 }}>
                    {mockAttempts.slice(0, 5).map((m) => (
                      <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.outcomeTitle}>{new Date(m.taken_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                          <Text style={s.outcomeMeta}>{m.driving_faults} driving · {m.serious_faults} serious · {m.dangerous_faults} dangerous</Text>
                        </View>
                        <Text style={[s.pill, m.passed ? s.pillPass : s.pillFail]}>{m.passed ? 'PASS' : 'FAIL'}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={s.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={s.sectionLabel}>Lifecycle status</Text>
                  <Text style={[s.statusBadge, { backgroundColor: status.bg, color: status.fg }]}>{student.status}</Text>
                </View>
                <Text style={s.lifecycleHint}>Pause a student without losing their records, or move them onto the waiting list until a slot becomes available.</Text>
                <View style={{ flexDirection: 'row', gap: 7, marginTop: 11 }}>
                  {student.status !== 'Inactive' && student.status !== 'Passed' && (
                    <TouchableOpacity style={s.lifecycleBtn} onPress={() => runStatusChange('Inactive', student.status)} testID="v2-deactivate">
                      <Text style={s.lifecycleBtnText}>Deactivate</Text>
                    </TouchableOpacity>
                  )}
                  {student.status !== 'Waitlist' && student.status !== 'Passed' && (
                    <TouchableOpacity style={s.lifecycleBtn} onPress={() => runStatusChange('Waitlist', student.status)} testID="v2-waitlist">
                      <Text style={s.lifecycleBtnText}>Waitlist</Text>
                    </TouchableOpacity>
                  )}
                  {(student.status === 'Inactive' || student.status === 'Waitlist') && (
                    <TouchableOpacity style={[s.lifecycleBtn, { backgroundColor: '#D1FAE5', borderColor: '#10B981' }]} onPress={() => runStatusChange('Active', student.status)} testID="v2-reactivate">
                      <Text style={[s.lifecycleBtnText, { color: '#047857' }]}>Reactivate</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={s.dangerCard}>
                <Text style={s.dangerTitle}>Danger zone</Text>
                {pendingGdprRequest && (
                  <View style={s.gdprBanner} testID="v2-gdpr-pending-banner">
                    <Text style={s.gdprBannerText}>
                      {student.name.split(' ')[0]} submitted a formal data deletion request on{' '}
                      {new Date(pendingGdprRequest.requested_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.
                      {pendingGdprRequest.reason ? ` Reason given: "${pendingGdprRequest.reason}"` : ''}
                    </Text>
                  </View>
                )}
                <Text style={s.dangerHint}>
                  Deleting {student.name.split(' ')[0]} permanently removes every lesson, competency record and test outcome attached to them. This cannot be undone.
                </Text>
                {!deleteConfirmOpen ? (
                  <TouchableOpacity style={s.deleteBtn} onPress={() => setDeleteConfirmOpen(true)} testID="v2-delete-student">
                    <Text style={s.deleteBtnText}>Delete student permanently</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ marginTop: 11, gap: 7 }}>
                    <Text style={[s.dangerHint, { fontWeight: '700', color: C.dangerText }]}>Are you sure? This cannot be undone.</Text>
                    <View style={{ flexDirection: 'row', gap: 7 }}>
                      <TouchableOpacity style={s.cancelDeleteBtn} onPress={() => setDeleteConfirmOpen(false)} testID="v2-cancel-delete">
                        <Text style={s.cancelDeleteBtnText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.deleteBtn, { flex: 1 }, deleting && { opacity: 0.6 }]} onPress={handleDelete} disabled={deleting} testID="v2-confirm-delete">
                        {deleting ? <ActivityIndicator color="#fff" /> : <Text style={s.deleteBtnText}>Yes, delete permanently</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </>
          )}

          {tab === 'lessons' && (
            <>
              <View style={s.statsHero}>
                <View>
                  <Text style={s.heroLabel}>Lessons taught</Text>
                  <Text style={s.heroValue}>{completedCount}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.heroSub}>{totalHours.toFixed(1)}h total</Text>
                </View>
              </View>
              <View style={{ marginTop: 12, gap: 8 }}>
                {lessons.map((l) => (
                  <View key={l.id} style={s.lessonRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                      <Text style={s.lessonTopic} numberOfLines={1}>{l.topic || l.lesson_type}</Text>
                      <Text style={s.lessonDate}>{new Date(`${l.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                      {!!l.grade && (
                        <Text style={[s.tag, { backgroundColor: colorForLessonType(l.lesson_type) }]}>Grade {l.grade}</Text>
                      )}
                      {(l.driving_faults || 0) > 0 && <Text style={s.faultTag}>{l.driving_faults} faults</Text>}
                      <View style={{ flex: 1 }} />
                      <Text style={s.lessonMeta}>{l.duration_hours}h</Text>
                    </View>
                    {!!l.notes && <Text style={s.lessonNote}>{l.notes}</Text>}
                  </View>
                ))}
              </View>
            </>
          )}

          {tab === 'competency' && (
            !pro ? (
              <View style={s.lockedCard}>
                <View style={s.lockedIcon}><Text style={{ fontSize: 20, color: C.warmText }}>✳</Text></View>
                <Text style={s.lockedTitle}>Competency tracker locked</Text>
                <Text style={s.lockedSub}>Track progress against the DVSA syllabus — included from Growth tier (£14.99/mo).</Text>
                <TouchableOpacity style={s.upgradeBtn} onPress={() => router.push('/pricing-screen' as any)} testID="v2-view-plans">
                  <Text style={s.upgradeBtnText}>View plans</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {competencies.length > 0 && (
                  <View style={s.card}>
                    <Text style={[s.sectionLabel, { color: C.warmText }]}>Focus next</Text>
                    <View style={{ marginTop: 10, gap: 10 }}>
                      {[...competencies].sort((a, b) => a.progress - b.progress).slice(0, 3).map((c) => (
                        <View key={c.category_key} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                          <Text style={s.focusPct}>{c.progress}%</Text>
                          <Text style={s.focusName} numberOfLines={1}>{c.category_name}</Text>
                          <Text style={s.focusLevel}>Level {c.level}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
                <View style={{ marginTop: 10, gap: 7 }}>
                  {competencies.map((c) => (
                    <TouchableOpacity
                      key={c.category_key}
                      style={s.compRow}
                      onPress={() => router.push({ pathname: '/competency-detail-screen', params: { id: student.id, key: c.category_key } } as any)}
                      testID={`v2-comp-row-${c.category_key}`}
                    >
                      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                        <Text style={s.compRowName} numberOfLines={1}>{c.category_name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ flexDirection: 'row', gap: 3 }}>
                            {Array.from({ length: 5 }).map((_, i) => (
                              <View key={i} style={[s.pip, i < c.level && { backgroundColor: C.primary }]} />
                            ))}
                          </View>
                          <Text style={s.compRowSub}>Level {c.level}</Text>
                        </View>
                      </View>
                      <Text style={s.compRowPct}>{c.progress}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )
          )}

          {tab === 'earnings' && (
            <>
              <View style={s.statsHero}>
                <View>
                  <Text style={s.heroLabel}>Total billed</Text>
                  <Text style={s.heroValue}>£{totalEarnings.toFixed(0)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.heroSub}>{totalHours.toFixed(1)}h · £{student.hourly_rate || 0}/hr</Text>
                </View>
              </View>
              <View style={s.card}>
                <Text style={s.sectionLabel}>Recent payments</Text>
                <View style={{ marginTop: 11, gap: 9 }}>
                  {lessons.filter((l) => l.amount_paid).slice(0, 8).map((l) => (
                    <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <View style={{ minWidth: 0 }}>
                        <Text style={s.paymentWhat} numberOfLines={1}>{l.topic || l.lesson_type}</Text>
                        <Text style={s.paymentWhen}>{new Date(`${l.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
                      </View>
                      <Text style={s.paymentAmount}>£{(l.amount_paid || 0).toFixed(2)}</Text>
                    </View>
                  ))}
                  {lessons.filter((l) => l.amount_paid).length === 0 && (
                    <Text style={s.emptyMuted}>No payments recorded yet.</Text>
                  )}
                </View>
              </View>

              <TouchableOpacity
                style={[s.invoiceBtn, !pro && { opacity: 0.55 }]}
                onPress={handleGenerateInvoice}
                disabled={generatingInvoice}
                testID="v2-generate-invoice"
              >
                {generatingInvoice ? (
                  <ActivityIndicator color={C.primary} />
                ) : (
                  <>
                    {pro ? <FileText size={18} color={C.primary} /> : <Lock size={16} color={C.textMuted} />}
                    <Text style={[s.invoiceBtnText, !pro && { color: C.textMuted }]}>Generate PDF invoice</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>

      {snack && (
        <View style={s.snack} testID="v2-lifecycle-snack">
          <Text style={s.snackText}>{snack.message}</Text>
          {snack.undoTo && (
            <TouchableOpacity style={s.undoBtn} onPress={handleUndo} testID="v2-undo">
              <Text style={s.undoBtnText}>Undo</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Amend student details */}
      <BottomSheet visible={amendOpen} onClose={() => setAmendOpen(false)} title="Amend student" testID="v2-sheet-amend">
        <Text style={s.fieldLabel}>Full name *</Text>
        <TextInput style={s.fieldInput} value={aName} onChangeText={setAName} placeholderTextColor={C.faint} testID="v2-amend-name" />
        <Text style={s.fieldLabel}>Email</Text>
        <TextInput style={s.fieldInput} value={aEmail} onChangeText={setAEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor={C.faint} testID="v2-amend-email" />
        <Text style={s.fieldLabel}>Phone</Text>
        <TextInput style={s.fieldInput} value={aPhone} onChangeText={setAPhone} keyboardType="phone-pad" placeholderTextColor={C.faint} testID="v2-amend-phone" />
        <Text style={s.fieldLabel}>Address</Text>
        <TextInput style={s.fieldInput} value={aAddress} onChangeText={setAAddress} placeholderTextColor={C.faint} testID="v2-amend-address" />
        <Text style={s.fieldLabel}>Postcode</Text>
        <TextInput style={s.fieldInput} value={aPostcode} onChangeText={setAPostcode} autoCapitalize="characters" placeholderTextColor={C.faint} testID="v2-amend-postcode" />
        <Text style={s.fieldLabel}>Hourly rate (£)</Text>
        <TextInput style={s.fieldInput} value={aHourlyRate} onChangeText={setAHourlyRate} keyboardType="number-pad" placeholderTextColor={C.faint} testID="v2-amend-rate" />
        <Text style={s.fieldLabel}>Test date (YYYY-MM-DD)</Text>
        <TextInput style={s.fieldInput} value={aTestDate} onChangeText={setATestDate} placeholder="Not booked" placeholderTextColor={C.faint} testID="v2-amend-testdate" />
        <Text style={s.fieldLabel}>Provisional licence number *</Text>
        <TextInput style={s.fieldInput} value={aLicence} onChangeText={(v) => setALicence(v.toUpperCase())} autoCapitalize="characters" maxLength={20} placeholderTextColor={C.faint} testID="v2-amend-licence" />
        <TouchableOpacity style={[s.submitBtn, savingAmend && { opacity: 0.6 }]} onPress={saveAmend} disabled={savingAmend} testID="v2-amend-save">
          {savingAmend ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Save changes</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* Instructor notes editor */}
      <BottomSheet visible={notesOpen} onClose={() => setNotesOpen(false)} title="Instructor notes" testID="v2-sheet-notes">
        <TextInput
          style={[s.fieldInput, { minHeight: 120, textAlignVertical: 'top', paddingTop: 12 }]}
          value={notesDraft}
          onChangeText={setNotesDraft}
          placeholder="Anything worth remembering about this student…"
          placeholderTextColor={C.faint}
          multiline
          testID="v2-notes-input"
        />
        <TouchableOpacity style={[s.submitBtn, savingNotes && { opacity: 0.6 }]} onPress={saveNotes} disabled={savingNotes} testID="v2-notes-save">
          {savingNotes ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Save notes</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* Log a test outcome — reuses the existing, already-working
          TestOutcomeModal component rather than rebuilding it. */}
      {student && (
        <TestOutcomeModal
          visible={testOutcomeOpen}
          studentId={student.id}
          onClose={() => setTestOutcomeOpen(false)}
        />
      )}

      <PaywallModal
        visible={routePaywallOpen}
        onClose={() => setRoutePaywallOpen(false)}
        reason="Route recording is available from Growth tier."
      />

      <PaywallModal
        visible={invoicePaywallOpen}
        onClose={() => setInvoicePaywallOpen(false)}
        reason="PDF invoices are available from Growth tier."
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.pageBg },
  surface: { flex: 1, backgroundColor: C.surface },

  navBtn: { width: 38, height: 38, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  amendBtn: { height: 36, paddingHorizontal: 14, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  amendBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: C.primary },
  passedBtn: { height: 36, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  passedBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: '#fff' },

  avatar: { width: 58, height: 58, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 19, color: '#fff' },
  name: { fontFamily: 'Archivo_800ExtraBold', fontSize: 24, letterSpacing: -0.5, color: C.text },
  statusBadge: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 0.9, textTransform: 'uppercase', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  subline: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.textMuted },

  tab: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#EDE8DE' },
  tabActive: { backgroundColor: C.ink },
  tabText: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: C.textMuted },
  tabTextActive: { color: '#fff' },

  readyCard: { borderRadius: 22, backgroundColor: C.primary, padding: 6, shadowColor: '#003A6F', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.35, shadowRadius: 28, elevation: 6 },
  readyInner: { borderWidth: 2, borderColor: 'rgba(255,255,255,.5)', borderRadius: 17, padding: 16 },
  readyLabel: { fontFamily: 'Archivo_800ExtraBold', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#FF9A4D' },
  testFlag: { fontFamily: 'Barlow_700Bold', fontSize: 11, color: '#fff', backgroundColor: 'rgba(255,255,255,.18)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  readyPct: { fontFamily: 'Archivo_800ExtraBold', fontSize: 54, letterSpacing: -1.7, color: '#fff' },
  readyPctSign: { fontFamily: 'Archivo_700Bold', fontSize: 20, color: 'rgba(255,255,255,.6)', paddingBottom: 6 },
  readyLine: { flex: 1, textAlign: 'right', fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: 'rgba(255,255,255,.78)', paddingBottom: 7 },
  readyTrack: { height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,.22)', marginTop: 13, overflow: 'hidden' },
  readyFill: { height: '100%', backgroundColor: '#FF9A4D', borderRadius: 999 },
  criteriaMark: { fontFamily: 'Barlow_700Bold', fontSize: 14, width: 16 },
  criteriaLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, flex: 1 },

  qaBtn: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  qaBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: C.text },
  invoiceBtn: { marginTop: 14, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: C.primary, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  invoiceBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: C.primary },
  reviewBtn: { marginTop: 9, minHeight: 44, backgroundColor: C.warmBg, borderWidth: 1, borderColor: C.accent, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  reviewBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: C.warmText },

  card: { marginTop: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 15 },
  detailKey: { fontFamily: 'Barlow_600SemiBold', fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: C.faint, paddingVertical: 4 },
  detailValue: { flex: 1, textAlign: 'right', fontFamily: 'Barlow_600SemiBold', fontSize: 13.5, color: C.text },

  statTile: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, gap: 1 },
  statValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 22, letterSpacing: -0.4, color: C.text },
  statLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 11.5, color: C.textMuted },

  sectionLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.textMuted },
  editBtn: { height: 30, paddingHorizontal: 11, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  editBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 11.5, color: C.warmText },
  notesText: { fontFamily: 'Barlow_400Regular', fontSize: 13.5, lineHeight: 19, color: C.text, marginTop: 9 },

  lessonNoteQ: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: C.textMuted2 },
  lessonNoteA: { fontFamily: 'Barlow_400Regular', fontSize: 13.5, color: C.text },
  lessonNoteDate: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: C.faint },
  moreText: { fontFamily: 'Barlow_500Medium', fontSize: 11.5, color: C.faint, marginTop: 2 },

  logTestBtn: { height: 30, paddingHorizontal: 11, backgroundColor: C.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  logTestBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 11.5, color: '#fff' },
  emptyMuted: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: C.textMuted, marginTop: 9 },
  pill: { fontFamily: 'Archivo_800ExtraBold', fontSize: 9, letterSpacing: 1.2, color: '#fff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, overflow: 'hidden' },
  pillPass: { backgroundColor: '#10B981' },
  pillFail: { backgroundColor: '#EF4444' },
  outcomeTitle: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: C.text },
  outcomeMeta: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.textMuted2, marginTop: 1 },

  lifecycleHint: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 17.5, color: C.textMuted, marginTop: 8 },
  lifecycleBtn: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lifecycleBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: C.text },

  dangerCard: { marginTop: 10, backgroundColor: C.dangerBg, borderWidth: 1, borderColor: C.dangerBorder, borderRadius: 16, padding: 15, marginBottom: 20 },
  dangerTitle: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.dangerText },
  gdprBanner: { marginTop: 10, backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 12, padding: 11 },
  gdprBannerText: { fontFamily: 'Barlow_500Medium', fontSize: 12, lineHeight: 17, color: '#92400E' },
  dangerHint: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 17.5, color: '#991B1B', marginTop: 8 },
  deleteBtn: { marginTop: 11, minHeight: 46, backgroundColor: '#EF4444', borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: '#fff' },
  cancelDeleteBtn: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cancelDeleteBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: C.textMuted },

  statsHero: { backgroundColor: C.ink, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  heroLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.5)' },
  heroValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 38, letterSpacing: -1, color: '#fff' },
  heroSub: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: 'rgba(255,255,255,.55)' },

  lessonRow: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 13 },
  lessonTopic: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text, flex: 1 },
  lessonDate: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, color: C.textMuted },
  tag: { fontFamily: 'Barlow_700Bold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: '#fff', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 5, overflow: 'hidden' },
  faultTag: { fontFamily: 'Barlow_700Bold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: '#92400E', backgroundColor: '#FEF3C7', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 5, overflow: 'hidden' },
  lessonMeta: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: C.textMuted },
  lessonNote: { fontFamily: 'Barlow_400Regular', fontSize: 13, lineHeight: 18, color: C.textMuted2, marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: C.divider },

  lockedCard: { backgroundColor: C.warmBg, borderWidth: 1, borderColor: C.warmBorder, borderRadius: 18, padding: 26, alignItems: 'center', gap: 7 },
  lockedIcon: { width: 52, height: 52, borderRadius: 999, backgroundColor: C.warmBorder, alignItems: 'center', justifyContent: 'center' },
  lockedTitle: { fontFamily: 'Archivo_700Bold', fontSize: 17, color: C.text, textAlign: 'center' },
  lockedSub: { fontFamily: 'Barlow_400Regular', fontSize: 13, lineHeight: 18.5, color: C.textMuted, textAlign: 'center' },
  upgradeBtn: { marginTop: 6, minHeight: 46, paddingHorizontal: 22, backgroundColor: C.accent, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  upgradeBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: '#fff' },

  focusPct: { fontFamily: 'Archivo_800ExtraBold', fontSize: 18, color: C.warmText, minWidth: 44 },
  focusName: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.text, flex: 1 },
  focusLevel: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, color: C.textMuted },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 13 },
  compRowName: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.text },
  pip: { width: 12, height: 5, borderRadius: 2.5, backgroundColor: C.divider },
  compRowSub: { fontFamily: 'Barlow_500Medium', fontSize: 11.5, color: C.faint },
  compRowPct: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },

  paymentWhat: { fontFamily: 'Barlow_600SemiBold', fontSize: 13.5, color: C.text },
  paymentWhen: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.textMuted },
  paymentAmount: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },

  emptyTitle: { fontFamily: 'Archivo_700Bold', fontSize: 17, color: C.text },

  snack: {
    position: 'absolute', left: 20, right: 20, bottom: 28, backgroundColor: C.ink,
    borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  snackText: { flex: 1, fontFamily: 'Barlow_600SemiBold', fontSize: 13.5, color: '#fff' },
  undoBtn: { height: 34, paddingHorizontal: 14, backgroundColor: C.accent, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  undoBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: '#fff' },

  fieldLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: C.faint, marginTop: 12, marginBottom: 5 },
  fieldInput: { height: 46, paddingHorizontal: 13, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: '#fff', fontFamily: 'Barlow_400Regular', fontSize: 14, color: C.text },
  submitBtn: { marginTop: 18, minHeight: 50, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  submitBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: '#fff' },
});
