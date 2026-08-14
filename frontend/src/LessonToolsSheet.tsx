import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, ScrollView, TextInput, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
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
  MapPin,
  BookOpen,
} from 'lucide-react-native';
import { theme } from './theme';
import { Lesson, Student, mockDb } from './mockDb';
import { patchLesson } from './useSupabaseData';
import { useStudent } from './useSupabaseData';
import { countUpcomingInSeries, cancelSeriesFromDate } from './useSupabaseData';
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
  const router = useRouter();
  const [precheck, setPrecheck] = useState<{ eye: boolean; fit: boolean; lic: boolean }>({ eye: false, fit: false, lic: false });
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  // Local cancel-modal state: 'select' shows the three CTAs; 'partial' shows
  // the £ input + confirm so an instructor can record a custom late-cancellation
  // fee (e.g. 50% of the agreed price).
  const [cancelStep, setCancelStep] = useState<'select' | 'partial'>('select');
  const [partialCharge, setPartialCharge] = useState<string>('');
  const [eta, setEta] = useState<{ traffic: number; normal: number; distance: number; fallback: boolean } | null>(null);

  // ---- Complete-lesson form state -----------------------------------------
  const [completeOpen, setCompleteOpen] = useState(false);
  const [drivingFaults, setDrivingFaults] = useState(0);
  const [seriousFaults, setSeriousFaults] = useState(0);
  const [dangerousFaults, setDangerousFaults] = useState(0);
  const [grade, setGrade] = useState<number | null>(null);
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'card' | 'cash' | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // ---- Series state (Migration 016) --------------------------------------
  // Number of remaining (Scheduled) occurrences in this lesson's series,
  // STARTING FROM and INCLUDING this lesson. So a row of "3 remaining" means
  // tapping the bulk-cancel button will cancel THIS lesson + the next two.
  const [seriesRemaining, setSeriesRemaining] = useState(0);
  const [seriesBusy, setSeriesBusy] = useState(false);

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
    setPaymentMethod((lesson as any).payment_method ?? null);
    setNotes(lesson.notes ?? '');
  }, [visible, lesson?.id]);

  // ---- Series occurrence count -------------------------------------------
  // When the sheet opens for a lesson that belongs to a recurring series,
  // count how many SCHEDULED occurrences (including this one) remain. The
  // CTA only renders when ≥2 — otherwise the regular per-lesson cancel
  // covers it.
  useEffect(() => {
    setSeriesRemaining(0);
    if (!visible || !lesson || !lesson.series_id) return;
    let cancelled = false;
    const sIso = new Date(`${lesson.date}T${lesson.start_time}:00`).toISOString();
    countUpcomingInSeries(lesson.series_id, sIso)
      .then((n) => { if (!cancelled) setSeriesRemaining(n); })
      .catch(() => { /* graceful — missing column / pre-migration */ });
    return () => { cancelled = true; };
  }, [visible, lesson?.id, lesson?.series_id]);

  // Bulk-cancel every remaining occurrence in the series, starting from this
  // lesson. Uses window.confirm on web (single OK is sufficient) and
  // Alert.alert on native.
  const cancelEntireSeries = async () => {
    if (!lesson || !lesson.series_id) return;
    const fromIso = new Date(`${lesson.date}T${lesson.start_time}:00`).toISOString();
    const msg = `This will cancel ${seriesRemaining} lesson${seriesRemaining === 1 ? '' : 's'} in this weekly series for ${student.name.split(' ')[0]} (including this one). Charges will be waived (£0). Continue?`;
    const confirmed = await (async (): Promise<boolean> => {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        return window.confirm(msg);
      }
      return await new Promise((resolve) => {
        Alert.alert('Cancel all remaining?', msg, [
          { text: 'Keep them', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Cancel all', style: 'destructive', onPress: () => resolve(true) },
        ]);
      });
    })();
    if (!confirmed) return;
    setSeriesBusy(true);
    try {
      const n = await cancelSeriesFromDate(lesson.series_id, fromIso, { charge: 0 });
      onChanged?.();
      onClose();
      // Surface a confirmation toast / alert so the instructor knows it worked.
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(`Cancelled ${n} lesson${n === 1 ? '' : 's'} in this series.`);
      } else {
        Alert.alert('Series cancelled', `Cancelled ${n} lesson${n === 1 ? '' : 's'} in this series.`);
      }
    } catch (e: any) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(`Could not cancel series: ${e?.message || 'unknown error'}`);
      } else {
        Alert.alert('Could not cancel series', e?.message || 'unknown error');
      }
    } finally {
      setSeriesBusy(false);
    }
  };

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
    } else {
      // Previously silent — the instructor tapped the button and nothing
      // visibly happened, with no way to tell whether it failed or the
      // student was just notified in the background. Now it says so
      // explicitly and gives the phone number so they can text manually.
      Alert.alert(
        "Couldn't open messages",
        `Your device didn't open a text message to ${student.name}. You can text them directly at ${student.phone}.`,
      );
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
    setCancelStep('select');
    // Default partial input to half the agreed price if known, else blank.
    const agreed = lesson?.amount_paid != null ? Number(lesson.amount_paid) : NaN;
    setPartialCharge(Number.isFinite(agreed) && agreed > 0 ? (agreed / 2).toFixed(2) : '');
    setCancelOpen(true);
  };

  // Unified cancellation handler. Sets status + amount_paid + cancellation_charge
  // + a short human-readable cancellation_note so the audit trail survives.
  const applyCancellation = async (mode: 'full' | 'partial' | 'waive', overrideAmount?: number) => {
    if (!lesson) return;
    const agreed = lesson.amount_paid != null ? Number(lesson.amount_paid) : 0;
    let charge = 0;
    let note = '';
    if (mode === 'full') {
      charge = agreed;
      note = agreed > 0 ? `Cancelled — full charge applied (£${charge.toFixed(2)})` : 'Cancelled — full charge applied';
    } else if (mode === 'partial') {
      charge = Number.isFinite(overrideAmount ?? NaN) ? Math.max(0, Number(overrideAmount)) : 0;
      note = `Cancelled — partial charge (£${charge.toFixed(2)})`;
    } else {
      charge = 0;
      note = 'Cancelled — charge waived';
    }

    setCancelBusy(true);
    try {
      const patch: any = {
        status: 'Cancelled',
        amount_paid: charge,
        cancellation_charge: charge,
        cancellation_note: note,
      };
      try {
        await patchLesson(lesson.id, patch);
      } catch (e: any) {
        // Fallback to mockDb (legacy demo data + offline path)
        mockDb.updateLesson(lesson.id, patch);
      }
      setCancelOpen(false);
      setBroadcastOpen(true);
      onChanged?.();
    } finally {
      setCancelBusy(false);
    }
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
        payment_method: paymentMethod ?? undefined,
        notes: notes.trim() || undefined,
        status: 'Completed',
      } as any);
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
              {lesson.travel_minutes && <Badge label={`${lesson.travel_minutes}m travel`} bg={theme.colors.lockedBg} color={theme.colors.accent} />}
              {lesson.pre_check_completed_at && <Badge label="Pre-check ✓" bg={theme.colors.successLight} color={theme.colors.success} />}
            </View>

            {/* Cancellation summary — only shown when the lesson was cancelled.
                Surfaces the recorded charge + audit note from Migration 011. */}
            {lesson.status === 'Cancelled' && (lesson.cancellation_note || lesson.cancellation_charge != null) && (
              <View style={styles.cancelInfoBox} testID="cancellation-summary">
                <Text style={styles.cancelInfoTitle}>Cancellation record</Text>
                {lesson.cancellation_charge != null && (
                  <Text style={styles.cancelInfoLine}>
                    Charge retained:{' '}
                    <Text style={styles.cancelInfoStrong}>£{Number(lesson.cancellation_charge).toFixed(2)}</Text>
                  </Text>
                )}
                {lesson.cancellation_note ? (
                  <Text style={styles.cancelInfoLine}>{lesson.cancellation_note}</Text>
                ) : null}
              </View>
            )}

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

            {/* Record route — tags the recording with this lesson + student
                so it shows up linked instead of as a generic unnamed trip. */}
            <TouchableOpacity
              style={styles.recordRouteBtn}
              onPress={() => {
                onClose();
                router.push({
                  pathname: '/route-recorder-screen',
                  params: { lessonId: lesson.id, studentId: student.id, studentName: student.name },
                } as any);
              }}
              testID="btn-record-route"
            >
              <MapPin size={18} color={theme.colors.primary} />
              <Text style={styles.recordRouteText}>Record route for this lesson</Text>
            </TouchableOpacity>

            {/* Show Me, Tell Me quick reference — for glancing at during the
                lesson, e.g. before running a practice question with the student. */}
            <TouchableOpacity
              style={styles.smtmLinkBtn}
              onPress={() => {
                onClose();
                router.push('/show-me-tell-me-screen');
              }}
              testID="btn-show-me-tell-me"
            >
              <BookOpen size={16} color={theme.colors.textMuted} />
              <Text style={styles.smtmLinkText}>Show Me, Tell Me question reference</Text>
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

            {/* Bulk-cancel — only visible when this lesson belongs to a
                recurring series AND there's MORE THAN one remaining
                (otherwise the regular cancel above is the right tool). */}
            {lesson.series_id && seriesRemaining > 1 && (
              <TouchableOpacity
                style={[styles.seriesCancelBtn, seriesBusy && styles.btnDisabled]}
                onPress={cancelEntireSeries}
                disabled={seriesBusy}
                testID="btn-cancel-series"
              >
                {seriesBusy ? (
                  <ActivityIndicator color={theme.colors.danger} />
                ) : (
                  <>
                    <Megaphone size={16} color={theme.colors.danger} />
                    <Text style={styles.seriesCancelText}>
                      Cancel all {seriesRemaining} remaining in this series
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

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

      {/* Cancel-lesson confirmation — 3 options: full charge / partial / waive */}
      <Modal
        visible={cancelOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !cancelBusy && setCancelOpen(false)}
      >
        <View style={cancelModalStyles.backdrop}>
          <View style={cancelModalStyles.card}>
            {cancelStep === 'select' ? (
              <>
                <Text style={cancelModalStyles.title}>Cancel this lesson?</Text>
                <Text style={cancelModalStyles.body}>
                  Choose how to handle the charge for {student.name.split(' ')[0]}'s lesson.
                  {lesson?.amount_paid
                    ? `\n\nAgreed price: £${Number(lesson.amount_paid).toFixed(2)}.`
                    : '\n\nNo agreed price recorded on this lesson.'}
                </Text>

                <TouchableOpacity
                  style={[cancelModalStyles.btn, cancelModalStyles.btnDanger]}
                  onPress={() => applyCancellation('full')}
                  disabled={cancelBusy}
                  testID="btn-cancel-full-charge"
                >
                  {cancelBusy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={cancelModalStyles.btnText}>
                      Apply full charge{lesson?.amount_paid ? ` (£${Number(lesson.amount_paid).toFixed(2)})` : ''}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[cancelModalStyles.btn, cancelModalStyles.btnPartial]}
                  onPress={() => setCancelStep('partial')}
                  disabled={cancelBusy}
                  testID="btn-cancel-partial-charge"
                >
                  <Text style={cancelModalStyles.btnText}>Apply partial charge…</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[cancelModalStyles.btn, cancelModalStyles.btnWarn]}
                  onPress={() => applyCancellation('waive')}
                  disabled={cancelBusy}
                  testID="btn-cancel-waive-charge"
                >
                  {cancelBusy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={cancelModalStyles.btnText}>Waive charge (£0.00)</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={cancelModalStyles.btnGhost}
                  onPress={() => !cancelBusy && setCancelOpen(false)}
                  disabled={cancelBusy}
                  testID="btn-cancel-keep-lesson"
                >
                  <Text style={cancelModalStyles.btnGhostText}>Keep lesson</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={cancelModalStyles.title}>Partial charge</Text>
                <Text style={cancelModalStyles.body}>
                  Enter the amount to charge {student.name.split(' ')[0]} for this late cancellation.
                  {lesson?.amount_paid
                    ? ` Agreed price is £${Number(lesson.amount_paid).toFixed(2)}.`
                    : ''}
                </Text>

                <View style={cancelModalStyles.amountWrap}>
                  <Text style={cancelModalStyles.poundSign}>£</Text>
                  <TextInput
                    value={partialCharge}
                    onChangeText={(v) => setPartialCharge(v.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    style={cancelModalStyles.amountInput}
                    testID="input-partial-amount"
                    autoFocus
                  />
                </View>

                {/* Quick % chips relative to the agreed price */}
                {lesson?.amount_paid ? (
                  <View style={cancelModalStyles.chipRow}>
                    {[25, 50, 75].map((pct) => (
                      <TouchableOpacity
                        key={pct}
                        style={cancelModalStyles.chip}
                        onPress={() => setPartialCharge((Number(lesson!.amount_paid) * (pct / 100)).toFixed(2))}
                        testID={`partial-chip-${pct}`}
                      >
                        <Text style={cancelModalStyles.chipText}>{pct}%</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[cancelModalStyles.btn, cancelModalStyles.btnDanger]}
                  onPress={() => {
                    const v = parseFloat(partialCharge);
                    if (!Number.isFinite(v) || v < 0) {
                      Alert.alert('Invalid amount', 'Please enter a valid amount in pounds.');
                      return;
                    }
                    applyCancellation('partial', v);
                  }}
                  disabled={cancelBusy}
                  testID="btn-confirm-partial"
                >
                  {cancelBusy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={cancelModalStyles.btnText}>Cancel & charge £{partialCharge || '0.00'}</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={cancelModalStyles.btnGhost}
                  onPress={() => !cancelBusy && setCancelStep('select')}
                  disabled={cancelBusy}
                  testID="btn-partial-back"
                >
                  <Text style={cancelModalStyles.btnGhostText}>Back</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

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
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
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
  paymentMethod: 'bank_transfer' | 'card' | 'cash' | null;
  setPaymentMethod: (m: 'bank_transfer' | 'card' | 'cash' | null) => void;
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
            <Stepper label="Driving faults"     value={p.drivingFaults}   setter={p.setDrivingFaults}   colour={theme.colors.warning ?? theme.colors.warning} testID="step-driving" />
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

            <Text style={styles.section}>Payment method</Text>
            <View style={styles.pmRow}>
              {([
                { key: 'bank_transfer', label: 'Bank Transfer' },
                { key: 'card',          label: 'Card' },
                { key: 'cash',          label: 'Cash' },
              ] as const).map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.pmChip, p.paymentMethod === m.key && styles.pmChipActive]}
                  onPress={() => p.setPaymentMethod(p.paymentMethod === m.key ? null : m.key)}
                  testID={`pm-${m.key}`}
                >
                  <Text style={[styles.pmChipText, p.paymentMethod === m.key && { color: '#fff', fontWeight: '700' }]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
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
  recordRouteBtn: { marginTop: 10, height: 46, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: theme.colors.primary },
  recordRouteText: { color: theme.colors.primary, fontWeight: '700', fontSize: 14 },
  smtmLinkBtn: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  smtmLinkText: { color: theme.colors.textMuted, fontWeight: '600', fontSize: 13, textDecorationLine: 'underline' },
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
  seriesCancelBtn: { marginTop: 8, height: 42, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.danger, backgroundColor: 'transparent' },
  seriesCancelText: { color: theme.colors.danger, fontWeight: '700', fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 400, backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, alignItems: 'center', gap: 10 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.text },
  modalSub: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center' },
  modalCta: { backgroundColor: theme.colors.accent, height: 50, borderRadius: 12, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  modalCtaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.successLight, padding: 12, borderRadius: 10, alignSelf: 'stretch' },
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
  pmRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  pmChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  pmChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  pmChipText: { fontSize: 13, color: theme.colors.text },
  amountInput: { flex: 1, fontSize: 15, color: theme.colors.text },
  notesInput: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 10, minHeight: 70, fontSize: 14, color: theme.colors.text, textAlignVertical: 'top' },
  // Cancellation summary box — appears above the navigation section whenever a
  // cancelled lesson is re-opened so instructors can see the audit trail.
  cancelInfoBox: {
    backgroundColor: '#F3F4F6',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.danger,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  cancelInfoTitle: { fontSize: 13, fontWeight: '800', color: theme.colors.danger, marginBottom: 4 },
  cancelInfoLine: { fontSize: 13, color: theme.colors.text, lineHeight: 18 },
  cancelInfoStrong: { fontWeight: '800', color: theme.colors.text },
});

// =============================================================================
// Cancel-lesson modal styles (full / partial / waive)
// =============================================================================
const cancelModalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: theme.colors.surface,
    borderRadius: 18,
    padding: 22,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '800', color: theme.colors.text },
  body: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 19, marginBottom: 6 },
  btn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 6,
  },
  btnDanger: { backgroundColor: theme.colors.danger },
  btnPartial: { backgroundColor: theme.colors.primary },
  btnWarn: { backgroundColor: theme.colors.accent ?? '#EA580C' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnGhost: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: 4 },
  btnGhostText: { color: theme.colors.textMuted, fontWeight: '600', fontSize: 14 },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 56,
    marginTop: 4,
    backgroundColor: theme.colors.background,
  },
  poundSign: { fontSize: 22, fontWeight: '700', color: theme.colors.text, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 22, fontWeight: '700', color: theme.colors.text, padding: 0 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  chip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  chipText: { fontSize: 13, fontWeight: '700', color: theme.colors.primary },
});

