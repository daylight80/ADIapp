import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Mail, Phone, MapPin, CalendarDays, PoundSterling, Download, Crown, Pencil, Trash2, Trophy, CircleX, Plus, UserCheck, UserX, UserPlus, AlertTriangle, CreditCard } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb } from '../src/mockDb';
import {
  useStudent,
  patchStudent,
  passStudent,
  removeStudent,
  useLessonsForStudent,
  useCompetencies,
  useTestOutcomesForStudent,
  removeTestOutcome,
  setStudentStatusAsync,
  removeStudentViaApi,
} from '../src/useSupabaseData';
import { Card, ProgressBar, StatusBadge, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import { SimpleBarChart } from '../src/SimpleBarChart';
import { useAuth } from '../src/AuthContext';
import { isPro } from '../src/proPlan';
import { isPaidTier } from '../src/tiers';
import { PaywallModal } from '../src/PaywallModal';
import { buildInvoiceHtml, generateAndShareInvoicePdf } from '../src/invoice';
import { TestOutcomeModal } from '../src/TestOutcomeModal';
import { OpenInMapsButton } from '../src/OpenInMapsButton';

type Tab = 'overview' | 'lessons' | 'competency' | 'earnings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'competency', label: 'Competency' },
  { key: 'earnings', label: 'Earnings' },
];

// Human-friendly British-English relative time. Falls back to an absolute
// date once we're more than a week out, so "Updated 14 Jun 2026, 09:30"
// always wins for very old notes.
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 30) return 'just now';
  if (diffSec < 60) return `${diffSec} seconds ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin === 1) return '1 minute ago';
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr === 1) return '1 hour ago';
  if (diffHr < 24) return `${diffHr} hours ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function StudentLifecycleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { user } = useAuth();
  const pro = isPaidTier(user?.tier);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [busyInvoice, setBusyInvoice] = useState(false);
  const [testOutcomeOpen, setTestOutcomeOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const id = (params.id as string) || '';
  const { student: sbStudent, loading: studentLoading } = useStudent(id);
  // Fall back to mockDb until lessons + competencies are migrated in the next slice.
  const student = sbStudent || (mockDb.getStudent(id) || mockDb.listStudents()[0]);
  const { lessons: sbLessons } = useLessonsForStudent(student?.id);
  const lessons = useMemo(() => (sbLessons && sbLessons.length > 0 ? sbLessons : (student ? mockDb.listLessonsForStudent(student.id) : [])), [sbLessons, student?.id]);
  // DVSA Competency Tracker — live from Supabase (dvsa_syllabus_tracking)
  const { competencies: sbCompetencies, loading: compLoading } = useCompetencies(student?.id);
  const { rows: testOutcomes } = useTestOutcomesForStudent(student?.id);
  const competencies = useMemo(
    () => (sbCompetencies && sbCompetencies.length > 0
      ? sbCompetencies
      : (student ? mockDb.getCompetencies(student.id) : [])),
    [sbCompetencies, student?.id]
  );

  const [tab, setTab] = useState<Tab>('overview');

  // Amend (edit) sheet state
  const [amendOpen, setAmendOpen] = useState(false);
  const [aName, setAName] = useState(student.name);
  const [aEmail, setAEmail] = useState(student.email);
  const [aPhone, setAPhone] = useState(student.phone);
  const [aAddress, setAAddress] = useState(student.address);
  const [aPostcode, setAPostcode] = useState(student.postcode);
  const [aHourlyRate, setAHourlyRate] = useState(String(student.hourly_rate));
  const [aTestDate, setATestDate] = useState(student.test_date ? student.test_date.slice(0, 10) : '');
  const [aLicence, setALicence] = useState(student.provisional_licence || '');

  // Instructor notes editor sheet
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string>((student as any).notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const openNotesEditor = () => {
    setNotesDraft((student as any).notes || '');
    setNotesOpen(true);
  };
  const saveNotes = async () => {
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

  const openAmend = () => {
    setAName(student.name);
    setAEmail(student.email);
    setAPhone(student.phone);
    setAAddress(student.address);
    setAPostcode(student.postcode);
    setAHourlyRate(String(student.hourly_rate));
    setATestDate(student.test_date ? student.test_date.slice(0, 10) : '');
    setALicence(student.provisional_licence || '');
    setAmendOpen(true);
  };

  const saveAmend = async () => {
    const rate = parseInt(aHourlyRate, 10);
    if (!aName.trim()) {
      Alert.alert('Name required', 'Please enter the student\u2019s full name.');
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
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save changes');
      return;
    }
    setAmendOpen(false);
  };

  const confirmAndRun = (title: string, message: string, confirmLabel: string, onConfirm: () => void, destructive = false) => {
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
    ]);
  };

  const handleMarkPassed = () => {
    if (student.status === 'Passed') {
      Alert.alert('Already passed', `${student.name} is already marked as Passed on ${student.test_passed_at ? new Date(student.test_passed_at).toLocaleDateString('en-GB') : ''}.`);
      return;
    }
    confirmAndRun(
      'Mark as Passed?',
      `Confirm that ${student.name} has passed their practical test. Progress will be set to 100%.`,
      'Mark as Passed',
      async () => {
        try {
          await passStudent(student.id);
        } catch (e: any) {
          Alert.alert('Update failed', e?.message || 'Could not mark passed');
        }
      },
    );
  };

  const handleDelete = () => {
    setDeleteConfirmOpen(true);
  };

  const performHardDelete = async () => {
    setDeleting(true);
    try {
      await removeStudentViaApi(student.id);
      setDeleteConfirmOpen(false);
      // Tiny delay so the sheet closes cleanly before navigation.
      setTimeout(() => router.back(), 80);
    } catch (e: any) {
      setDeleting(false);
      Alert.alert('Delete failed', e?.response?.data?.detail || e?.message || 'Could not delete student');
    }
  };

  /**
   * Lifecycle transitions — Deactivate / Reactivate / Move to Waitlist.
   *
   * We optimistically reflect the change in local state so the UI updates
   * the moment the user taps; on failure we surface a polite alert and the
   * cache invalidation on success keeps everything in sync.
   */
  const handleSetLifecycleStatus = (next: 'Active' | 'Inactive' | 'Waitlist', verb: string) => {
    confirmAndRun(
      `${verb} ${student.name}?`,
      next === 'Inactive'
        ? `${student.name} will be marked as inactive. Their lessons and records are preserved — you can reactivate them later.`
        : next === 'Waitlist'
          ? `${student.name} will be moved to the waiting list. They will appear under the Waitlist tab on the Students screen.`
          : `${student.name} will be reactivated and returned to your active list.`,
      verb,
      async () => {
        try {
          await setStudentStatusAsync(student.id, next);
        } catch (e: any) {
          Alert.alert('Update failed', e?.response?.data?.detail || e?.message || 'Could not update status');
        }
      },
    );
  };

  const totalEarnings = lessons.reduce((sum, l) => sum + (l.amount_paid || 0), 0);
  const totalHours = lessons.reduce((sum, l) => sum + l.duration_hours, 0);

  const handleDownloadInvoice = async () => {
    if (!pro) {
      setPaywallOpen(true);
      return;
    }
    const paidLessons = lessons.filter((l) => l.amount_paid && l.status === 'Completed');
    if (paidLessons.length === 0) {
      return;
    }
    setBusyInvoice(true);
    const invoiceNo = `INV-${new Date().getFullYear()}-${student.id.toUpperCase()}-${Date.now().toString().slice(-4)}`;
    const html = buildInvoiceHtml({
      invoiceNo,
      instructorName: user?.name || 'Instructor',
      instructorEmail: user?.email || '',
      student,
      lessons: paidLessons,
      issuedAt: new Date(),
    });
    await generateAndShareInvoicePdf(html, `${invoiceNo}.pdf`);
    setBusyInvoice(false);
  };

  const monthlyEarnings = useMemo(() => {
    const map: Record<string, number> = {};
    lessons.forEach((l) => {
      const m = l.date.slice(0, 7);
      map[m] = (map[m] || 0) + (l.amount_paid || 0);
    });
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([m, v]) => ({ month: m.slice(5), value: v }));
  }, [lessons]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{student.name}</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.tabBar} testID="lifecycle-tabs">
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => setTab(t.key)}
            testID={`tab-${t.key}`}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === 'overview' && (
          <View style={{ gap: 12 }} testID="tab-overview-content">
            <Card>
              <View style={styles.row}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {student.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{student.name}</Text>
                  <StatusBadge status={student.status} />
                </View>
              </View>
              <View style={styles.contactList}>
                <ContactRow icon={<Mail size={16} color={theme.colors.textMuted} />} text={student.email} />
                <ContactRow icon={<Phone size={16} color={theme.colors.textMuted} />} text={student.phone} />
                <View style={styles.contactRow}>
                  <CreditCard size={16} color={theme.colors.textMuted} />
                  {student.provisional_licence && student.provisional_licence !== 'PENDING' ? (
                    <Text style={[styles.contactText, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 0.5 }]}>
                      {student.provisional_licence}
                    </Text>
                  ) : (
                    <TouchableOpacity onPress={openAmend} activeOpacity={0.7} testID="link-add-licence">
                      <Text style={[styles.contactText, { color: theme.colors.danger, fontStyle: 'italic' }]}>
                        Provisional licence number — tap Amend to add
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.contactRow}>
                  <MapPin size={16} color={theme.colors.textMuted} />
                  <Text style={[styles.contactText, { flex: 1 }]} numberOfLines={2}>
                    {`${student.address || ''}, ${student.postcode || ''}`.replace(/^,\s*|,\s*$/g, '')}
                  </Text>
                  <OpenInMapsButton
                    address={`${student.address || ''}, ${student.postcode || ''}`}
                    variant="pill"
                    label="Maps"
                    testID={`btn-open-maps-student-${student.id}`}
                  />
                </View>
              </View>
            </Card>

            <View style={styles.actionRow} testID="student-actions">
              <TouchableOpacity style={[styles.actionBtn, styles.actionAmend]} onPress={openAmend} testID="btn-amend-student">
                <Pencil size={16} color={theme.colors.primary} />
                <Text style={[styles.actionText, { color: theme.colors.primary }]}>Amend</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionPassed, student.status === 'Passed' && styles.actionDisabled]}
                onPress={handleMarkPassed}
                testID="btn-passed-student"
              >
                <Trophy size={16} color={'#fff'} />
                <Text style={[styles.actionText, { color: '#fff' }]}>Passed</Text>
              </TouchableOpacity>
            </View>

            {/* ---- Lifecycle status management ---- */}
            <Card style={styles.lifecycleCard} testID="card-lifecycle">
              <View style={styles.lifecycleHeaderRow}>
                <Text style={styles.cardTitle}>Lifecycle status</Text>
                <StatusBadge status={student.status as any} />
              </View>
              <Text style={styles.lifecycleHint}>
                Pause a student without losing their records, or move them onto the waiting list until a slot becomes available.
              </Text>
              <View style={styles.lifecycleBtnRow}>
                {student.status === 'Inactive' || student.status === 'Waitlist' ? (
                  <TouchableOpacity
                    style={[styles.lifecycleBtn, styles.lifecycleBtnPrimary]}
                    onPress={() => handleSetLifecycleStatus('Active', 'Reactivate')}
                    testID="btn-lifecycle-reactivate"
                    accessibilityLabel="Reactivate student"
                  >
                    <UserCheck size={16} color="#fff" />
                    <Text style={styles.lifecycleBtnTextPrimary}>Reactivate student</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.lifecycleBtn, styles.lifecycleBtnNeutral]}
                    onPress={() => handleSetLifecycleStatus('Inactive', 'Deactivate')}
                    testID="btn-lifecycle-deactivate"
                    accessibilityLabel="Deactivate student"
                  >
                    <UserX size={16} color={theme.colors.text} />
                    <Text style={styles.lifecycleBtnText}>Deactivate</Text>
                  </TouchableOpacity>
                )}
                {student.status !== 'Waitlist' && (
                  <TouchableOpacity
                    style={[styles.lifecycleBtn, styles.lifecycleBtnNeutral]}
                    onPress={() => handleSetLifecycleStatus('Waitlist', 'Move')}
                    testID="btn-lifecycle-waitlist"
                    accessibilityLabel="Move student to waiting list"
                  >
                    <UserPlus size={16} color={theme.colors.text} />
                    <Text style={styles.lifecycleBtnText}>Move to waitlist</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>

            <View style={styles.statsRow}>
              <StatCard label="Lessons" value={student.lessons_count.toString()} />
              <StatCard label="Hours" value={totalHours.toFixed(1)} />
              <StatCard label="Rate" value={`£${student.hourly_rate}`} />
            </View>

            <Card>
              <Text style={styles.cardTitle}>Driving readiness</Text>
              <View style={styles.readyRow}>
                <ProgressBar progress={student.progress} height={10} />
                <Text style={styles.readyPct}>{student.progress}%</Text>
              </View>
              {student.test_date && (
                <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <CalendarDays size={16} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                    Test booked: {new Date(student.test_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                </View>
              )}
            </Card>

            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={styles.cardTitle}>Instructor notes</Text>
                <TouchableOpacity
                  onPress={openNotesEditor}
                  style={styles.notesEditBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Edit instructor notes"
                  testID="btn-edit-notes"
                >
                  <Pencil size={16} color={theme.colors.accent} />
                </TouchableOpacity>
              </View>
              {((student as any).notes && String((student as any).notes).trim()) ? (
                <>
                  <Text style={styles.notes}>{(student as any).notes}</Text>
                  {(student as any).notes_updated_at ? (
                    <Text style={styles.notesTimestamp} testID="text-notes-updated">
                      {(student as any).notes_updated_by_name
                        ? `Updated by ${(student as any).notes_updated_by_name}, ${formatRelativeTime((student as any).notes_updated_at)}`
                        : `Updated ${formatRelativeTime((student as any).notes_updated_at)}`}
                    </Text>
                  ) : null}
                </>
              ) : (
                <TouchableOpacity onPress={openNotesEditor} activeOpacity={0.7}>
                  <Text style={[styles.notes, { color: theme.colors.textMuted, fontStyle: 'italic' }]}>
                    No notes yet. Tap the pencil to add your first lesson note for {student.name.split(' ')[0]}.
                  </Text>
                </TouchableOpacity>
              )}
            </Card>

            <Card style={{ gap: 10 }} testID="card-test-outcomes">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.cardTitle}>Test outcomes</Text>
                <TouchableOpacity
                  onPress={() => setTestOutcomeOpen(true)}
                  style={styles.logTestBtn}
                  testID="btn-log-test"
                >
                  <Plus size={14} color="#fff" />
                  <Text style={styles.logTestText}>Log test</Text>
                </TouchableOpacity>
              </View>
              {testOutcomes.length === 0 ? (
                <Text style={styles.empty}>No tests recorded yet.</Text>
              ) : testOutcomes.map((o) => {
                const passed = o.result === 'pass';
                const dateLabel = new Date(o.test_date + 'T12:00:00').toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                });
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={styles.outcomeRow}
                    onLongPress={async () => {
                      const yes = typeof window !== 'undefined' && typeof window.confirm === 'function'
                        ? window.confirm('Delete this test outcome?')
                        : true;
                      if (yes) await removeTestOutcome(o.id);
                    }}
                    testID={`outcome-row-${o.id}`}
                  >
                    <View style={[styles.outcomeBadge, passed ? styles.outcomePass : styles.outcomeFail]}>
                      {passed ? <Trophy size={14} color="#fff" /> : <CircleX size={14} color="#fff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.outcomeTitle}>
                        {o.test_type === 'practical' ? 'Practical' : 'Theory'} · {passed ? 'Pass' : 'Fail'}
                      </Text>
                      <Text style={styles.outcomeMeta} numberOfLines={1}>
                        {dateLabel}
                        {o.test_centre ? ` · ${o.test_centre}` : ''}
                        {o.test_type === 'practical' && o.driving_faults != null ? ` · ${o.driving_faults} faults` : ''}
                        {o.test_type === 'theory' && o.theory_mc_score != null ? ` · ${o.theory_mc_score}/50 MC` : ''}
                      </Text>
                      {o.retest_reasons && o.retest_reasons.length > 0 && (
                        <Text style={styles.outcomeMeta} numberOfLines={2}>
                          {o.retest_reasons.join(' · ')}
                        </Text>
                      )}
                    </View>
                    {o.test_centre ? (
                      <OpenInMapsButton
                        address={`${o.test_centre} test centre, UK`}
                        variant="icon"
                        testID={`btn-open-maps-centre-${o.id}`}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
              {testOutcomes.length > 0 && (
                <Text style={[styles.empty, { fontStyle: 'italic' }]}>Long-press a row to delete.</Text>
              )}
            </Card>

            {/* ---- Danger zone ---- */}
            <Card style={styles.dangerCard} testID="card-danger-zone">
              <View style={styles.dangerHeaderRow}>
                <AlertTriangle size={18} color={theme.colors.danger} />
                <Text style={styles.dangerTitle}>Danger zone</Text>
              </View>
              <Text style={styles.dangerHint}>
                Deleting {student.name} permanently removes every lesson, competency record and test outcome attached to them. This cannot be undone.
              </Text>
              <TouchableOpacity
                style={styles.dangerBtn}
                onPress={handleDelete}
                testID="btn-delete-student"
                accessibilityLabel="Delete student"
              >
                <Trash2 size={16} color="#fff" />
                <Text style={styles.dangerBtnText}>Delete student permanently</Text>
              </TouchableOpacity>
            </Card>
          </View>
        )}

        {tab === 'lessons' && (
          <View style={{ gap: 12 }} testID="tab-lessons-content">
            {lessons.length === 0 ? (
              <Card><Text style={styles.emptyText}>No lessons recorded yet.</Text></Card>
            ) : (
              lessons.map((l) => (
                <Card key={l.id} style={{ gap: 8 }} testID={`lesson-row-${l.id}`}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lessonDate}>
                        {new Date(l.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                      <Text style={styles.lessonTopic}>{l.topic}</Text>
                    </View>
                    <Badge label={l.status} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Badge label={`${l.start_time}-${l.end_time}`} />
                    {l.grade && <Badge label={`Grade ${l.grade}/5`} bg="#D1FAE5" color={theme.colors.success} />}
                    <Badge label={`${l.driving_faults + l.serious_faults + l.dangerous_faults} faults`} bg="#FEF3C7" color={theme.colors.faultDriving} />
                  </View>
                  {l.notes && <Text style={styles.notes}>{l.notes}</Text>}
                </Card>
              ))
            )}
          </View>
        )}

        {tab === 'competency' && (
          <View style={{ gap: 10 }} testID="tab-competency-content">
            {compLoading && competencies.length === 0 && (
              <Card><ActivityIndicator size="small" color={theme.colors.primary} /></Card>
            )}
            {competencies.map((c) => (
              <TouchableOpacity
                key={c.key}
                onPress={() => router.push({ pathname: '/competency-detail-screen', params: { id: student.id, key: c.key } })}
                testID={`competency-${c.key}`}
              >
                <Card style={{ gap: 8 }}>
                  <View style={styles.row}>
                    <Text style={styles.compName}>{c.name}</Text>
                    <Badge label={`Level ${c.level}`} />
                  </View>
                  <ProgressBar progress={c.progress} />
                  <Text style={styles.compMeta}>{c.progress}% complete</Text>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {tab === 'earnings' && (
          <View style={{ gap: 12 }} testID="tab-earnings-content">
            <View style={styles.statsRow}>
              <StatCard label="Total" value={`£${totalEarnings}`} color={theme.colors.accent} />
              <StatCard label="Hours" value={totalHours.toFixed(1)} />
              <StatCard label="Rate" value={`£${student.hourly_rate}`} />
            </View>

            <Card>
              <Text style={styles.cardTitle}>Monthly earnings</Text>
              {monthlyEarnings.length > 0 ? (
                <SimpleBarChart
                  data={monthlyEarnings.map((e) => ({ label: e.month, value: e.value }))}
                  color={theme.colors.accent}
                  height={180}
                />
              ) : (
                <Text style={styles.emptyText}>No earnings recorded yet.</Text>
              )}
            </Card>

            <Card>
              <View style={styles.invoiceHeaderRow}>
                <Text style={styles.cardTitle}>Payment history</Text>
                <TouchableOpacity
                  style={[styles.invoiceBtn, !pro && styles.invoiceBtnLocked]}
                  onPress={handleDownloadInvoice}
                  disabled={busyInvoice}
                  testID="btn-download-invoice"
                >
                  {busyInvoice ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      {pro ? <Download size={14} color="#fff" /> : <Crown size={14} color="#fff" />}
                      <Text style={styles.invoiceBtnText}>{pro ? 'Invoice PDF' : 'Pro'}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
              <View style={{ gap: 8, marginTop: 8 }}>
                {lessons.filter((l) => l.amount_paid).map((l) => (
                  <View key={l.id} style={styles.payRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '600', color: theme.colors.text }}>{l.topic}</Text>
                      <Text style={styles.payDate}>{new Date(l.date).toLocaleDateString('en-GB')}</Text>
                    </View>
                    <Text style={styles.payAmount}>£{l.amount_paid}</Text>
                  </View>
                ))}
              </View>
            </Card>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="Invoice PDF download is a Pro feature. Upgrade to generate UK-compliant invoices in one tap."
      />

      <BottomSheet visible={amendOpen} onClose={() => setAmendOpen(false)} title="Amend student" testID="sheet-amend-student">
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.fieldLabel}>Full name</Text>
          <TextInput style={styles.input} value={aName} onChangeText={setAName} placeholder="Full name" placeholderTextColor={theme.colors.textMuted} testID="amend-name" />

          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput style={styles.input} value={aEmail} onChangeText={setAEmail} keyboardType="email-address" autoCapitalize="none" placeholder="name@example.com" placeholderTextColor={theme.colors.textMuted} testID="amend-email" />

          <Text style={styles.fieldLabel}>Phone</Text>
          <TextInput style={styles.input} value={aPhone} onChangeText={setAPhone} keyboardType="phone-pad" placeholder="07xxx xxxxxx" placeholderTextColor={theme.colors.textMuted} testID="amend-phone" />

          <Text style={styles.fieldLabel}>Address</Text>
          <TextInput style={styles.input} value={aAddress} onChangeText={setAAddress} placeholder="Street address" placeholderTextColor={theme.colors.textMuted} testID="amend-address" />

          <Text style={styles.fieldLabel}>Postcode</Text>
          <TextInput style={styles.input} value={aPostcode} onChangeText={setAPostcode} autoCapitalize="characters" placeholder="e.g. SW1A 1AA" placeholderTextColor={theme.colors.textMuted} testID="amend-postcode" />

          <Text style={styles.fieldLabel}>
            Provisional licence number <Text style={{ color: theme.colors.danger }}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={aLicence}
            onChangeText={(v) => setALicence(v.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
            placeholder="SMITH911206 23A6L 79"
            placeholderTextColor={theme.colors.textMuted}
            testID="amend-licence"
          />
          <Text style={{ ...theme.font.caption, color: theme.colors.textMuted, marginTop: -8, marginBottom: 8 }}>
            16-character DVLA driver number from the front of the pink licence (DD1).
          </Text>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Hourly rate (£)</Text>
              <TextInput style={styles.input} value={aHourlyRate} onChangeText={setAHourlyRate} keyboardType="numeric" placeholder="36" placeholderTextColor={theme.colors.textMuted} testID="amend-rate" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Test date (YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={aTestDate} onChangeText={setATestDate} placeholder="2026-06-01" placeholderTextColor={theme.colors.textMuted} testID="amend-test-date" />
            </View>
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={saveAmend} testID="btn-save-amend">
            <Text style={styles.saveBtnText}>Save changes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setAmendOpen(false)} testID="btn-cancel-amend">
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </BottomSheet>

      {/* Test outcome modal */}
      {student && (
        <TestOutcomeModal
          visible={testOutcomeOpen}
          studentId={student.id}
          onClose={() => setTestOutcomeOpen(false)}
        />
      )}

      {/* Delete confirmation bottom sheet — permanent action with bold UK-English warning */}
      <BottomSheet
        visible={deleteConfirmOpen}
        onClose={() => !deleting && setDeleteConfirmOpen(false)}
        title="Delete student?"
        testID="sheet-delete-student"
      >
        <View style={{ gap: 12 }}>
          <View style={styles.deleteWarnIcon}>
            <AlertTriangle size={32} color={theme.colors.danger} />
          </View>
          <Text style={styles.deleteHeadline}>
            This permanently deletes {student.name}
          </Text>
          <Text style={styles.deleteBody}>
            All of their lessons, competency tracking and test outcomes will be removed. This cannot be undone.
          </Text>
          <Text style={styles.deleteBodyBold}>
            Consider deactivating them instead if you might work with them again in future.
          </Text>
          <TouchableOpacity
            style={[styles.deleteConfirmBtn, deleting && { opacity: 0.6 }]}
            onPress={performHardDelete}
            disabled={deleting}
            testID="btn-confirm-delete"
            accessibilityLabel="Permanently delete student"
          >
            <Trash2 size={18} color="#fff" />
            <Text style={styles.deleteConfirmBtnText}>
              {deleting ? 'Deleting…' : 'Yes, delete permanently'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteCancelBtn}
            onPress={() => !deleting && setDeleteConfirmOpen(false)}
            disabled={deleting}
            testID="btn-cancel-delete"
          >
            <Text style={styles.deleteCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Instructor notes editor */}
      <BottomSheet
        visible={notesOpen}
        onClose={() => !savingNotes && setNotesOpen(false)}
        title="Instructor notes"
        testID="sheet-edit-notes"
      >
        <View style={{ gap: 12 }}>
          <Text style={[styles.fieldLabel, { marginTop: 0 }]}>
            Lesson notes for {student.name.split(' ')[0]}
          </Text>
          <TextInput
            style={styles.notesInput}
            value={notesDraft}
            onChangeText={setNotesDraft}
            placeholder={`Add private notes about ${student.name.split(' ')[0]}'s progress, areas to focus on, manoeuvres to practise…`}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            numberOfLines={8}
            textAlignVertical="top"
            autoFocus
            testID="input-notes"
          />
          <Text style={styles.notesHint}>
            {notesDraft.length}/2000 characters · Only you can see these notes.
          </Text>
          <TouchableOpacity
            style={[styles.saveBtn, savingNotes && { opacity: 0.6 }]}
            onPress={saveNotes}
            disabled={savingNotes}
            testID="btn-save-notes"
          >
            {savingNotes
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.saveBtnText}>Save notes</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => !savingNotes && setNotesOpen(false)}
            disabled={savingNotes}
            testID="btn-cancel-notes"
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

function ContactRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.contactRow}>
      {icon}
      <Text style={styles.contactText}>{text}</Text>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, gap: 8 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },
  tabBar: { flexDirection: 'row', paddingHorizontal: 16, gap: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  tabBtn: { paddingVertical: 12, paddingHorizontal: 4, flex: 1, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: theme.colors.primary },
  tabText: { color: theme.colors.textMuted, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: theme.colors.primary },
  scroll: { padding: 16, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: theme.colors.primary, fontSize: 18 },
  studentName: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginBottom: 4 },
  contactList: { gap: 8, marginTop: 12 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contactText: { color: theme.colors.text, fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '700', color: theme.colors.primary },
  statLabel: { fontSize: 12, color: theme.colors.textMuted, marginTop: 4 },
  cardTitle: { ...theme.font.h3, marginBottom: 8 },
  readyRow: { gap: 8 },
  readyPct: { fontWeight: '700', color: theme.colors.primary },
  notes: { color: theme.colors.text, lineHeight: 20, fontSize: 14 },
  notesEditBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.primaryLight,
  },
  notesInput: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 12, paddingTop: 12,
    color: theme.colors.text, fontSize: 15, lineHeight: 22,
    minHeight: 160,
  },
  notesHint: { color: theme.colors.textMuted, fontSize: 12 },
  notesTimestamp: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  lessonDate: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 2 },
  lessonTopic: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  compName: { fontSize: 15, fontWeight: '600', color: theme.colors.text, flex: 1 },
  compMeta: { fontSize: 12, color: theme.colors.textMuted },
  payRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  payDate: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  payAmount: { fontWeight: '700', color: theme.colors.accent, fontSize: 15 },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', padding: 12 },
  invoiceHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  invoiceBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  invoiceBtnLocked: { backgroundColor: theme.colors.accent },
  invoiceBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  actionRow: { flexDirection: 'row', gap: 8 },
  // ---- Lifecycle card (Deactivate / Reactivate / Waitlist) ----
  lifecycleCard: { padding: 14, gap: 10, marginTop: 6 },
  lifecycleHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lifecycleHint: { fontSize: 12, color: theme.colors.textMuted, lineHeight: 17 },
  lifecycleBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  lifecycleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 14, minHeight: 44, borderRadius: 999, borderWidth: 1,
    flexGrow: 1, flexBasis: '46%',
  },
  lifecycleBtnPrimary: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  lifecycleBtnNeutral: { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
  lifecycleBtnText: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
  lifecycleBtnTextPrimary: { fontSize: 13, fontWeight: '700', color: '#fff' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusBadgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  // ---- Danger zone ----
  dangerCard: {
    padding: 14, gap: 12, marginTop: 16,
    borderWidth: 1, borderColor: theme.colors.danger + '55', backgroundColor: theme.colors.danger + '08',
  },
  dangerHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dangerTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.danger, letterSpacing: 0.3, textTransform: 'uppercase' },
  dangerHint: { fontSize: 13, color: theme.colors.text, lineHeight: 18 },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 48, paddingHorizontal: 16, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger,
  },
  dangerBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  // ---- Delete confirm sheet ----
  deleteWarnIcon: {
    width: 64, height: 64, borderRadius: 32, alignSelf: 'center',
    backgroundColor: theme.colors.danger + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteHeadline: { fontSize: 18, fontWeight: '800', color: theme.colors.text, textAlign: 'center' },
  deleteBody: { fontSize: 14, color: theme.colors.text, textAlign: 'center', lineHeight: 20 },
  deleteBodyBold: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center', fontStyle: 'italic', lineHeight: 18 },
  deleteConfirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 52, paddingHorizontal: 16, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger, marginTop: 4,
  },
  deleteConfirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  deleteCancelBtn: {
    alignItems: 'center', justifyContent: 'center',
    minHeight: 44, borderRadius: theme.radius.md,
  },
  deleteCancelText: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  actionText: { fontWeight: '700', fontSize: 13 },
  actionAmend: { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary },
  actionPassed: { backgroundColor: theme.colors.success, borderColor: theme.colors.success },
  actionDelete: { backgroundColor: theme.colors.surface, borderColor: theme.colors.danger },
  actionDisabled: { opacity: 0.55 },
  fieldLabel: { ...theme.font.caption, fontWeight: '600', marginBottom: 6, color: theme.colors.text },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 12,
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
  },
  saveBtn: { backgroundColor: theme.colors.primary, height: 52, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { height: 44, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 8 },
  cancelBtnText: { color: theme.colors.textMuted, fontWeight: '600', fontSize: 14 },
  // Test outcomes card
  logTestBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: theme.colors.primary, borderRadius: 8,
  },
  logTestText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  outcomeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  outcomeBadge: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  outcomePass: { backgroundColor: theme.colors.success },
  outcomeFail: { backgroundColor: theme.colors.danger },
  outcomeTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  outcomeMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  empty: { fontSize: 12, color: theme.colors.textMuted, paddingVertical: 4 },
});
