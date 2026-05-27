import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import {
  X,
  Navigation,
  MessageSquare,
  Check,
  Eye,
  Activity,
  FileCheck,
  Megaphone,
  Car,
  Minus,
  Plus,
  Trophy,
  PoundSterling,
} from 'lucide-react-native';
import { theme } from './theme';
import { Lesson, Student, mockDb } from './mockDb';
import { patchLesson } from './useSupabaseData';
import { useStudent } from './useSupabaseData';
import { openNavigation, openSmsComposer } from './tools';
import { fireInstantNotification } from './notifications';
import { Badge } from './ui';
import { getTravelTime, lessonAddress } from './maps';

type Props = {
  visible: boolean;
  onClose: () => void;
  lesson: Lesson | null;
  onChanged?: () => void;
};

export function LessonToolsSheet({ visible, onClose, lesson, onChanged }: Props) {
  const [precheck, setPrecheck] = useState<{ eye: boolean; fit: boolean; lic: boolean }>({ eye: false, fit: false, lic: false });
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [eta, setEta] = useState<{ traffic: number; normal: number; distance: number; fallback: boolean } | null>(null);

  // ---- Complete-lesson form state -----------------------------------------
  const [completeOpen, setCompleteOpen] = useState(false);
  const [drivingFaults, setDrivingFaults] = useState(0);
  const [seriousFaults, setSeriousFaults] = useState(0);
  const [dangerousFaults, setDangerousFaults] = useState(0);
  const [grade, setGrade] = useState<number | null>(null);
  const [amountPaid, setAmountPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEta(null);
    if (!visible || !lesson) return;
    const student = mockDb.getStudent(lesson.student_id);
    const dest = lessonAddress(lesson, student);
    if (!dest) return;
    // Find previous lesson today as the origin; otherwise use student address as both (returns ~0; skip)
    const prior = mockDb
      .listLessons()
      .filter((x) => x.date === lesson.date && x.end_time <= lesson.start_time && x.id !== lesson.id && x.status !== 'Cancelled')
      .sort((a, b) => a.end_time.localeCompare(b.end_time))
      .pop();
    const origin = prior ? lessonAddress(prior, mockDb.getStudent(prior.student_id)) : null;
    if (!origin) return;
    let cancelled = false;
    getTravelTime(origin, dest, new Date(`${lesson.date}T${lesson.start_time}:00`)).then((t) => {
      if (cancelled || !t) return;
      setEta({
        traffic: t.duration_in_traffic_minutes,
        normal: t.duration_minutes,
        distance: t.distance_km,
        fallback: t.status === 'fallback',
      });
    });
    return () => { cancelled = true; };
  }, [visible, lesson]);

  // Hydrate completion-form fields from the current lesson row each time the sheet opens.
  useEffect(() => {
    if (!visible || !lesson) return;
    setDrivingFaults(lesson.driving_faults ?? 0);
    setSeriousFaults(lesson.serious_faults ?? 0);
    setDangerousFaults(lesson.dangerous_faults ?? 0);
    setGrade(lesson.grade ?? null);
    setAmountPaid(lesson.amount_paid != null ? String(lesson.amount_paid) : '');
    setNotes(lesson.notes ?? '');
  }, [visible, lesson?.id]);

  // ----- Student resolution (hooks must run unconditionally) ----------------
  // Try Supabase first when student_id looks like a UUID; otherwise mockDb.
  const sbStudentId = lesson && /^[0-9a-f-]{36}$/i.test(lesson.student_id) ? lesson.student_id : undefined;
  const { student: sbStudent } = useStudent(sbStudentId);

  if (!lesson) return null;

  const mockStudent = mockDb.getStudent(lesson.student_id);
  // Build a minimal Student-shaped record so downstream code doesn't crash.
  const student: any = sbStudent
    ? {
        id: sbStudent.id,
        name: sbStudent.name,
        phone: sbStudent.phone || '',
        email: sbStudent.email || '',
        address: sbStudent.address || '',
        postcode: sbStudent.postcode || '',
      }
    : mockStudent;
  if (!student) {
    // Show a spinner whilst the Supabase student fetch resolves rather than
    // returning null (which would prevent the sheet from opening at all).
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={{ marginTop: 12, color: theme.colors.textMuted }}>Loading lesson details…</Text>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  const allChecks = precheck.eye && precheck.fit && precheck.lic;

  const onArrived = async () => {
    const body = `Hi ${student.name.split(' ')[0]}, I've arrived for your ${lesson.start_time} lesson. See you in a moment! — Your instructor.`;
    const ok = await openSmsComposer(student.phone, body);
    if (ok) {
      await fireInstantNotification('Arrival message sent', `Notified ${student.name}`);
      onClose();
    }
  };

  const completePrecheck = async () => {
    if (!allChecks) {
      Alert.alert('Complete all checks', 'All three pre-lesson checks must be confirmed before the lesson starts.');
      return;
    }
    try {
      await patchLesson(lesson.id, { pre_check_completed_at: new Date().toISOString() });
    } catch (e: any) {
      // Fallback to mockDb if Supabase write fails (e.g. legacy lesson id).
      mockDb.updateLesson(lesson.id, { pre_check_completed_at: new Date().toISOString() });
    }
    Alert.alert('Pre-lesson check complete', 'Logged with timestamp. Drive safe!');
    onChanged?.();
  };

  const cancelLesson = () => {
    const proceed = async () => {
      try {
        await patchLesson(lesson.id, { status: 'Cancelled' });
      } catch (e: any) {
        mockDb.updateLesson(lesson.id, { status: 'Cancelled' });
      }
      setBroadcastOpen(true);
      onChanged?.();
    };
    // Alert.alert with destructive buttons doesn't render reliably on RN-Web
    // (it polyfills to window.alert with a single OK button). Use window.confirm
    // there; native iOS/Android keep the rich Alert.
    if (Platform.OS === 'web') {
      const ok = typeof window !== 'undefined'
        ? window.confirm('Cancel this lesson? You can broadcast the freed slot to other students.')
        : true;
      if (ok) proceed();
      return;
    }
    Alert.alert('Cancel this lesson?', 'You can broadcast the freed slot to other students.', [
      { text: 'Keep lesson', style: 'cancel' },
      { text: 'Cancel & broadcast', style: 'destructive', onPress: proceed },
    ]);
  };

  // Direct broadcast (without re-cancelling) — visible when the lesson is
  // already cancelled, so instructors can re-fan-out to the waiting list.
  const broadcastOnly = () => {
    setBroadcastOpen(true);
  };

  // Mark Complete: persists faults / grade / amount / notes + status to Supabase.
  const saveCompletion = async () => {
    if (grade == null) {
      Alert.alert('Pick a grade', 'Choose a grade from 1 to 5 before completing the lesson.');
      return;
    }
    const amount = amountPaid.trim() ? parseFloat(amountPaid.trim()) : undefined;
    if (amountPaid.trim() && (!Number.isFinite(amount) || (amount ?? 0) < 0)) {
      Alert.alert('Invalid amount', 'Amount paid must be a positive number, in pounds.');
      return;
    }
    setSaving(true);
    try {
      await patchLesson(lesson.id, {
        driving_faults: drivingFaults,
        serious_faults: seriousFaults,
        dangerous_faults: dangerousFaults,
        grade: grade ?? undefined,
        amount_paid: amount,
        notes: notes.trim() || undefined,
        status: 'Completed',
      });
    } catch (e: any) {
      // Fallback to mockDb for legacy lessons not in Supabase.
      mockDb.updateLesson(lesson.id, {
        driving_faults: drivingFaults,
        serious_faults: seriousFaults,
        dangerous_faults: dangerousFaults,
        grade: grade ?? undefined,
        amount_paid: amount,
        notes: notes.trim() || undefined,
        status: 'Completed',
      });
    } finally {
      setSaving(false);
    }
    Alert.alert('Lesson saved', `${student.name.split(' ')[0]}'s lesson recorded. Faults & grade synced.`);
    setCompleteOpen(false);
    onChanged?.();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{student.name}</Text>
              <Text style={styles.sub}>
                {lesson.start_time}-{lesson.end_time} · {lesson.topic}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} testID="lesson-tools-close">
              <X size={22} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 560 }}>
            <View style={styles.badgeRow}>
              <Badge label={lesson.status} />
              <Badge label={`${lesson.duration_hours}h`} />
              {lesson.travel_minutes && <Badge label={`${lesson.travel_minutes}m travel`} bg="#FFF7ED" color={theme.colors.accent} />}
              {lesson.pre_check_completed_at && <Badge label="Pre-check ✓" bg="#D1FAE5" color={theme.colors.success} />}
            </View>

            {/* Navigation */}
            <Text style={styles.section}>Navigate to pickup</Text>
            <Text style={styles.address}>
              {lesson.pickup_address || `${student.address}, ${student.postcode}`}
            </Text>
            {eta && (
              <View style={styles.etaCard} testID="live-eta">
                <Car size={16} color={theme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.etaPrimary}>
                    {eta.traffic} min via traffic{eta.fallback ? ' (estimate)' : ''}
                  </Text>
                  <Text style={styles.etaSecondary}>
                    {eta.normal} min normally · {eta.distance} km from previous lesson
                  </Text>
                </View>
              </View>
            )}
            <View style={styles.navRow}>
              <NavBtn
                label="Google"
                onPress={() => openNavigation('google', lesson.pickup_address || `${student.address}, ${student.postcode}`)}
                testID="nav-google"
              />
              <NavBtn
                label="Waze"
                onPress={() => openNavigation('waze', lesson.pickup_address || `${student.address}, ${student.postcode}`)}
                testID="nav-waze"
              />
              <NavBtn
                label="Apple"
                onPress={() => openNavigation('apple', lesson.pickup_address || `${student.address}, ${student.postcode}`)}
                testID="nav-apple"
              />
            </View>

            {/* I'm Here */}
            <TouchableOpacity style={styles.imHereBtn} onPress={onArrived} testID="btn-im-here">
              <MessageSquare size={18} color="#fff" />
              <Text style={styles.imHereText}>I've arrived — Text {student.name.split(' ')[0]}</Text>
            </TouchableOpacity>

            {/* Pre-lesson check */}
            <Text style={styles.section}>Pre-lesson check</Text>
            <CheckRow
              icon={<Eye size={18} color={precheck.eye ? '#fff' : theme.colors.text} />}
              label="Eyesight: number plate readable at 20m"
              checked={precheck.eye}
              onToggle={() => setPrecheck((p) => ({ ...p, eye: !p.eye }))}
              testID="precheck-eye"
            />
            <CheckRow
              icon={<Activity size={18} color={precheck.fit ? '#fff' : theme.colors.text} />}
              label="Fit to drive (no alcohol, medication, fatigue)"
              checked={precheck.fit}
              onToggle={() => setPrecheck((p) => ({ ...p, fit: !p.fit }))}
              testID="precheck-fit"
            />
            <CheckRow
              icon={<FileCheck size={18} color={precheck.lic ? '#fff' : theme.colors.text} />}
              label="Valid provisional/full driving licence in hand"
              checked={precheck.lic}
              onToggle={() => setPrecheck((p) => ({ ...p, lic: !p.lic }))}
              testID="precheck-lic"
            />
            <TouchableOpacity
              style={[styles.confirmBtn, !allChecks && styles.btnDisabled]}
              onPress={completePrecheck}
              disabled={!allChecks}
              testID="btn-confirm-precheck"
            >
              <Check size={18} color="#fff" />
              <Text style={styles.confirmText}>Confirm pre-check</Text>
            </TouchableOpacity>

            {/* Complete lesson — Slice 7 write-back to Supabase */}
            <TouchableOpacity
              style={styles.completeBtn}
              onPress={() => setCompleteOpen(true)}
              testID="btn-open-complete"
            >
              <Trophy size={18} color="#fff" />
              <Text style={styles.confirmText}>
                {lesson.status === 'Completed' ? 'Edit lesson outcome' : 'Complete lesson'}
              </Text>
            </TouchableOpacity>

            {/* Cancel + broadcast */}
            <TouchableOpacity style={styles.cancelBtn} onPress={cancelLesson} testID="btn-cancel-lesson">
              <Megaphone size={18} color={theme.colors.danger} />
              <Text style={styles.cancelText}>Cancel lesson & broadcast gap</Text>
            </TouchableOpacity>

            <View style={{ height: 12 }} />
          </ScrollView>
        </View>
      </View>

      <GapBroadcastModal
        visible={broadcastOpen}
        onClose={() => {
          setBroadcastOpen(false);
          onClose();
        }}
        lesson={lesson}
      />

      <CompleteLessonModal
        visible={completeOpen}
        onClose={() => setCompleteOpen(false)}
        studentName={student.name}
        drivingFaults={drivingFaults}
        setDrivingFaults={setDrivingFaults}
        seriousFaults={seriousFaults}
        setSeriousFaults={setSeriousFaults}
        dangerousFaults={dangerousFaults}
        setDangerousFaults={setDangerousFaults}
        grade={grade}
        setGrade={setGrade}
        amountPaid={amountPaid}
        setAmountPaid={setAmountPaid}
        notes={notes}
        setNotes={setNotes}
        saving={saving}
        onSave={saveCompletion}
      />
    </Modal>
  );
}

function NavBtn({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity style={styles.navBtn} onPress={onPress} testID={testID}>
      <Navigation size={16} color={theme.colors.primary} />
      <Text style={styles.navBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function CheckRow({ icon, label, checked, onToggle, testID }: any) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onToggle} testID={testID} activeOpacity={0.7}>
      <View style={[styles.checkIcon, checked && styles.checkIconActive]}>{icon}</View>
      <Text style={styles.checkLabel}>{label}</Text>
      {checked && <Check size={18} color={theme.colors.success} />}
    </TouchableOpacity>
  );
}

function GapBroadcastModal({ visible, onClose, lesson }: { visible: boolean; onClose: () => void; lesson: Lesson | null }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [resultDetail, setResultDetail] = useState<string>('');

  if (!lesson) return null;

  const broadcast = async () => {
    setBusy(true);
    try {
      // Fetch the active session token for backend auth.
      const { supabase: sbClient } = require('./supabaseClient') as typeof import('./supabaseClient');
      const { data: sess } = await sbClient.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error('Not signed in');

      // Backend URL is exposed via EXPO_PUBLIC_BACKEND_URL (or the dev proxy
      // strips /api at the ingress). The /api prefix is always required.
      const base = (process as any).env?.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base.replace(/\/+$/, '')}/api/broadcasts/gap`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lesson_id: lesson.id,
          title: 'Lesson slot just opened!',
          body: `A ${lesson.start_time}–${lesson.end_time} slot has just freed up on ${new Date(lesson.date).toLocaleDateString('en-GB')}. Open ADI Pro to grab it before it's gone.`,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        // Pre-Migration-007 environments will get a 500 here — show a useful message.
        if ((json.detail || '').toLowerCase().includes('waiting_list')) {
          throw new Error('Please apply Migration 007 first (waiting_list + push_tokens).');
        }
        throw new Error(json.detail || `Broadcast failed (HTTP ${resp.status})`);
      }
      const sentCount: number = json.sent ?? 0;
      setResultCount(sentCount);
      setResultDetail(json.detail || `Notified ${sentCount} learner(s).`);
      // Also fire a local toast for the instructor.
      await fireInstantNotification(
        'Slot broadcast sent',
        json.detail || `Notified ${sentCount} learner(s).`,
      );
      setSent(true);
    } catch (e: any) {
      Alert.alert('Broadcast failed', e?.message || 'Could not send broadcast.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} testID="gap-broadcast-modal">
          <Megaphone size={32} color={theme.colors.accent} />
          <Text style={styles.modalTitle}>Broadcast the gap</Text>
          <Text style={styles.modalSub}>
            Notify everyone on the waiting list about the freed{' '}
            {new Date(lesson.date).toLocaleDateString('en-GB')} {lesson.start_time}–{lesson.end_time} slot. First to respond gets the slot.
          </Text>
          {!sent ? (
            <TouchableOpacity
              style={[styles.modalCta, busy && styles.btnDisabled]}
              onPress={broadcast}
              disabled={busy}
              testID="btn-broadcast"
            >
              {busy
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.modalCtaText}>Broadcast now</Text>}
            </TouchableOpacity>
          ) : (
            <View style={styles.sentRow}>
              <Check size={18} color={theme.colors.success} />
              <Text style={styles.sentText}>
                {resultCount !== null ? `Sent to ${resultCount} learner(s). ` : ''}
                {resultDetail || 'First to respond wins the slot.'}
              </Text>
            </View>
          )}
          <TouchableOpacity onPress={onClose} testID="gap-close">
            <Text style={styles.modalClose}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// =============================================================================
// CompleteLessonModal — Slice 7 write-back UI
// =============================================================================
type CompleteProps = {
  visible: boolean;
  onClose: () => void;
  studentName: string;
  drivingFaults: number;     setDrivingFaults: (n: number) => void;
  seriousFaults: number;     setSeriousFaults: (n: number) => void;
  dangerousFaults: number;   setDangerousFaults: (n: number) => void;
  grade: number | null;      setGrade: (n: number) => void;
  amountPaid: string;        setAmountPaid: (s: string) => void;
  notes: string;             setNotes: (s: string) => void;
  saving: boolean;
  onSave: () => void;
};

function CompleteLessonModal(p: CompleteProps) {
  const Stepper = ({ label, value, setter, colour, testID }: { label: string; value: number; setter: (n: number) => void; colour: string; testID: string }) => (
    <View style={styles.stepperRow} testID={testID}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperGroup}>
        <TouchableOpacity
          style={[styles.stepBtn, value === 0 && styles.btnDisabled]}
          onPress={() => setter(Math.max(0, value - 1))}
          disabled={value === 0}
          testID={`${testID}-dec`}
        >
          <Minus size={16} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={[styles.stepperValue, { backgroundColor: value > 0 ? colour : theme.colors.surface, borderColor: value > 0 ? colour : theme.colors.border }]}>
          <Text style={[styles.stepperValueText, value > 0 && { color: '#fff' }]}>{value}</Text>
        </View>
        <TouchableOpacity style={styles.stepBtn} onPress={() => setter(value + 1)} testID={`${testID}-inc`}>
          <Plus size={16} color={theme.colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Modal visible={p.visible} transparent animationType="slide" onRequestClose={p.onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={p.onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Complete lesson</Text>
              <Text style={styles.sub}>{p.studentName} — log outcome to records</Text>
            </View>
            <TouchableOpacity onPress={p.onClose} testID="btn-close-complete">
              <X size={22} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={styles.section}>Faults recorded</Text>
            <Stepper label="Driving faults"     value={p.drivingFaults}   setter={p.setDrivingFaults}   colour={theme.colors.warning ?? '#F59E0B'} testID="step-driving" />
            <Stepper label="Serious faults"     value={p.seriousFaults}   setter={p.setSeriousFaults}   colour="#EA580C"                          testID="step-serious" />
            <Stepper label="Dangerous faults"   value={p.dangerousFaults} setter={p.setDangerousFaults} colour={theme.colors.danger}              testID="step-dangerous" />

            <Text style={styles.section}>Lesson grade</Text>
            <View style={styles.gradeRow}>
              {[1, 2, 3, 4, 5].map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.gradeChip, p.grade === g && styles.gradeChipActive]}
                  onPress={() => p.setGrade(g)}
                  testID={`grade-${g}`}
                >
                  <Text style={[styles.gradeChipText, p.grade === g && { color: '#fff' }]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.section}>Amount paid (£)</Text>
            <View style={styles.amountRow}>
              <PoundSterling size={18} color={theme.colors.textMuted} />
              <TextInput
                value={p.amountPaid}
                onChangeText={p.setAmountPaid}
                placeholder="e.g. 38.00"
                keyboardType="decimal-pad"
                style={styles.amountInput}
                testID="input-amount-paid"
              />
            </View>

            <Text style={styles.section}>Notes</Text>
            <TextInput
              value={p.notes}
              onChangeText={p.setNotes}
              placeholder="What went well, what to work on next..."
              multiline
              numberOfLines={3}
              style={styles.notesInput}
              testID="input-notes"
            />
          </ScrollView>

          <TouchableOpacity
            style={[styles.confirmBtn, p.saving && styles.btnDisabled]}
            onPress={p.onSave}
            disabled={p.saving}
            testID="btn-save-complete"
          >
            {p.saving
              ? <ActivityIndicator color="#fff" />
              : <><Check size={18} color="#fff" /><Text style={styles.confirmText}>Save & mark complete</Text></>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24, paddingTop: 12 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 4, backgroundColor: theme.colors.border, marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  sub: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  section: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginTop: 8, marginBottom: 8 },
  address: { fontSize: 14, color: theme.colors.text, marginBottom: 10 },
  etaCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.primaryLight, borderRadius: 10, padding: 12, marginBottom: 10 },
  etaPrimary: { color: theme.colors.primary, fontWeight: '700', fontSize: 14 },
  etaSecondary: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  navRow: { flexDirection: 'row', gap: 8 },
  navBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: theme.colors.primary, borderRadius: 10, paddingVertical: 12 },
  navBtnText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },
  imHereBtn: { marginTop: 12, backgroundColor: theme.colors.accent, height: 50, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  imHereText: { color: '#fff', fontWeight: '700' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  checkIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background },
  checkIconActive: { backgroundColor: theme.colors.success },
  checkLabel: { fontSize: 13, color: theme.colors.text, flex: 1 },
  confirmBtn: { marginTop: 10, backgroundColor: theme.colors.primary, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  completeBtn: { marginTop: 10, backgroundColor: theme.colors.success, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnDisabled: { opacity: 0.4 },
  confirmText: { color: '#fff', fontWeight: '700' },
  cancelBtn: { marginTop: 14, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: theme.colors.danger },
  cancelText: { color: theme.colors.danger, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 400, backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, alignItems: 'center', gap: 10 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.text },
  modalSub: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center' },
  modalCta: { backgroundColor: theme.colors.accent, height: 50, borderRadius: 12, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  modalCtaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#D1FAE5', padding: 12, borderRadius: 10, alignSelf: 'stretch' },
  sentText: { color: theme.colors.success, fontWeight: '600', flex: 1, fontSize: 13 },
  modalClose: { color: theme.colors.textMuted, marginTop: 8, fontWeight: '600' },
  // Complete-lesson modal
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  stepperLabel: { fontSize: 14, color: theme.colors.text, flex: 1, fontWeight: '500' },
  stepperGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  stepperValue: { minWidth: 44, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  stepperValueText: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  gradeRow: { flexDirection: 'row', gap: 6 },
  gradeChip: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  gradeChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  gradeChipText: { fontSize: 16, fontWeight: '800', color: theme.colors.text },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, height: 44 },
  amountInput: { flex: 1, fontSize: 15, color: theme.colors.text },
  notesInput: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 10, minHeight: 70, fontSize: 14, color: theme.colors.text, textAlignVertical: 'top' },
});
