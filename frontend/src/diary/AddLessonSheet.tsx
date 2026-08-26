import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, Alert, Modal, ActivityIndicator } from 'react-native';
import { Car, AlertTriangle } from 'lucide-react-native';
import { theme } from '../theme';
import { BottomSheet } from '../BottomSheet';
import { DateField, TimeField } from '../DateTimeFields';
import { supabase } from '../supabaseClient';
import { createLesson, patchLesson } from '../useSupabaseData';
import { overlapsAnyBlock, type AvailabilityBlock } from '../supabaseDb';
import { Lesson, Student } from '../mockDb';
import { getTravelTime, lessonAddress } from '../maps';
import { scheduleLessonReminders } from '../notifications';
import { styles } from './diaryStyles';
import { LESSON_TYPES } from './lessonTypes';

export type AddLessonCreatedInfo = {
  /** YYYY-MM-DD of the first created lesson */
  firstDate: string;
  /** HH:mm — used by the parent to scroll the diary into view */
  startTime: string;
  /** Number of lessons actually created (1 for non-recurring) */
  created: number;
  /** Whether the user toggled the recurring switch */
  recurring: boolean;
};

// Lifted to component scope (25 Aug 2026) so it can be used in state —
// previously declared inline inside handleAdd, which worked when the
// whole save happened in one linear pass, but now the flow pauses for
// confirmation when a clash is found, so the plan needs to survive
// between renders.
export type ClashInfo = { id: string; name: string; start: string; end: string; agreedAmount: number | null };
export type PlanEntry = { date: string; reason?: 'unavailable'; clash?: ClashInfo };

type Props = {
  visible: boolean;
  onClose: () => void;
  students: Student[];
  /** All lessons in the current visible week — used for travel-time auto-suggest. */
  lessons: Lesson[];
  /** Availability blocks for the visible window — used for hard-blocking unavailable slots. */
  availBlocks: AvailabilityBlock[];
  /** Pro users get reminder push notifications scheduled. */
  pro: boolean;
  /** Called after at least one lesson is created. */
  onCreated: (info: AddLessonCreatedInfo) => void;
};

/**
 * Add Lesson bottom-sheet.
 *
 * Owns:
 *  - all the form state (student/date/time/topic/travel-buffer/recurrence)
 *  - the travel-time auto-suggest effect (Google Distance Matrix fallback OK)
 *  - the recurring/clash/unavailability pre-flight check
 *  - the bulk-create + series_id minting
 *  - the recurring-summary alert + Pro reminder scheduling
 *
 * The parent only receives a single `onCreated` callback after a successful
 * save, so it can scroll the diary to the new lesson's start time and jump
 * the visible date if the user picked a different day.
 */
export function AddLessonSheet({ visible, onClose, students, lessons, availBlocks, pro, onCreated }: Props) {
  const [studentId, setStudentId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [topic, setTopic] = useState('');
  const [rate, setRate] = useState('');
  const rateManuallyEdited = useRef(false);
  const [lessonType, setLessonType] = useState<string>('Standard');
  const [travelMinutes, setTravelMinutes] = useState('15');

  // Recurrence — bulk-create across `repeatWeeks` consecutive weeks at the
  // same weekday & time. We stamp a shared `series_id` so the bulk-cancel UX
  // can find the related occurrences.
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState<string>('4');

  // Clash confirmation (25 Aug 2026, per Grant's direction) — a genuine
  // in-app dialog, not window.confirm(), which was removed previously for
  // silently returning false in some embedded/tunnelled preview contexts.
  // Holds the full plan while paused, waiting for the instructor to
  // explicitly confirm or cancel — nothing is saved until they choose.
  const [pendingClashPlan, setPendingClashPlan] = useState<PlanEntry[] | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Charge decision for each cancelled clash (25 Aug 2026, second
  // follow-up) — same full/partial/waive choice as a normal manual
  // cancellation, not a silent no-charge cancellation. A recurring series
  // can clash with several different existing lessons, each potentially
  // needing its own decision, so this steps through them one at a time.
  const [clashStep, setClashStep] = useState<'confirm' | 'decide' | 'partial'>('confirm');
  const [clashDecisionIndex, setClashDecisionIndex] = useState(0);
  const [clashCharges, setClashCharges] = useState<Record<string, number>>({});
  const [clashPartialInput, setClashPartialInput] = useState('');

  // Travel-time auto-suggest banner — populated by the effect below.
  const [travelInfo, setTravelInfo] = useState<string | null>(null);

  const getStudent = (id: string) => students.find((s) => s.id === id);

  // Travel-time auto-suggest when a student is picked for a new lesson.
  useEffect(() => {
    if (!visible || !studentId || !date) return;
    const newStudent = getStudent(studentId);
    if (!newStudent) return;
    const todays = lessons
      .filter((l) => l.date === date && l.status !== 'Cancelled')
      .sort((a, b) => a.end_time.localeCompare(b.end_time));
    const prior = todays.filter((l) => l.end_time <= startTime).pop();
    const newDest = lessonAddress(
      { pickup_address: '', student_id: newStudent.id } as any,
      newStudent,
    );
    const origin = prior ? lessonAddress(prior, getStudent(prior.student_id)) : null;
    if (!origin || !newDest) { setTravelInfo(null); return; }
    let cancelled = false;
    getTravelTime(origin, newDest, new Date(`${date}T${startTime}:00`)).then((t) => {
      if (cancelled || !t) return;
      setTravelMinutes(String(t.duration_in_traffic_minutes));
      setTravelInfo(
        `Predicted ${t.duration_in_traffic_minutes}m via traffic · ${t.distance_km}km · from previous lesson${t.status === 'fallback' ? ' (estimate)' : ''}`,
      );
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, studentId, date, startTime, lessons]);

  // Suggest a lesson rate from the student's own hourly rate × duration —
  // a genuine head start, not a forced value. Only auto-fills while the
  // instructor hasn't typed their own figure; once they do, this stops
  // touching the field so it never overwrites a deliberate override (e.g.
  // a promotional lesson, a block-booking discount).
  useEffect(() => {
    if (!visible || !studentId || rateManuallyEdited.current) return;
    const s = getStudent(studentId);
    if (!s?.hourly_rate) return;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const hours = Math.max(0, (eh + em / 60) - (sh + sm / 60));
    if (hours <= 0) return;
    setRate((s.hourly_rate * hours).toFixed(2));
  }, [visible, studentId, startTime, endTime]);

  // Reset form on close so re-opens start fresh.
  useEffect(() => {
    if (!visible) {
      setTravelInfo(null);
      setRate('');
      rateManuallyEdited.current = false;
      setPendingClashPlan(null);
      setClashStep('confirm');
      setClashDecisionIndex(0);
      setClashCharges({});
      setClashPartialInput('');
    }
  }, [visible]);

  const recurWeeksNum = useMemo(
    () => Math.max(2, Math.min(26, parseInt(repeatWeeks, 10) || 4)),
    [repeatWeeks],
  );

  const handleAdd = async () => {
    // Topic is intentionally optional — many instructors decide the topic
    // on the day based on the student's mood/progress. Student and date are
    // required, and we now surface a visible error rather than silently
    // returning (the previous behaviour made the Save button feel broken).
    if (!studentId) {
      Alert.alert('Choose a student', 'Please pick which student this lesson is for.');
      return;
    }
    if (!date) {
      Alert.alert('Pick a date', 'Please choose the lesson date (YYYY-MM-DD).');
      return;
    }

    // Build the list of target dates. Single lesson → [date]. Recurring →
    // date + N-1 subsequent weeks on the same weekday.
    const weeks = repeatOn ? recurWeeksNum : 1;
    const baseDate = new Date(`${date}T00:00:00`);
    const targetDates: string[] = [];
    for (let i = 0; i < weeks; i += 1) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + i * 7);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      targetDates.push(`${y}-${m}-${dd}`);
    }

    // -------- Pre-flight: resolve instructor + cache day-by-day clash info --
    let instructorId: string | null = null;
    try {
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id;
      if (uid) {
        const { data: instr } = await supabase
          .from('instructors').select('id').eq('auth_user_id', uid).maybeSingle();
        instructorId = instr?.id || null;
      }
    } catch { /* fall through — no overlap check, but allow save */ }

    // For each occurrence, check (a) unavailability overlap, (b) clash.
    const plan: PlanEntry[] = [];
    for (const d of targetDates) {
      try {
        const sIso = new Date(`${d}T${startTime}:00`).toISOString();
        const eIso = new Date(`${d}T${endTime}:00`).toISOString();
        if (overlapsAnyBlock(availBlocks, sIso, eIso)) {
          plan.push({ date: d, reason: 'unavailable' });
          continue;
        }
        if (instructorId) {
          const fromIsoX = `${d}T00:00:00`;
          const toIsoX = `${d}T23:59:59`;
          const { data: dayLessons } = await supabase
            .from('lessons')
            .select('id, start_time, end_time, status, amount_paid, students(full_name)')
            .eq('instructor_id', instructorId)
            .gte('start_time', fromIsoX)
            .lte('start_time', toIsoX);
          const newStartMs = new Date(sIso).getTime();
          const newEndMs = new Date(eIso).getTime();
          let clashed = false;
          let clashId = '';
          let clashName = '';
          let clashStart = '';
          let clashEnd = '';
          let clashAmount: number | null = null;
          for (const L of (dayLessons || []) as any[]) {
            if (L.status === 'Cancelled') continue;
            const lsMs = new Date(L.start_time).getTime();
            const leMs = new Date(L.end_time).getTime();
            if (!Number.isFinite(lsMs) || !Number.isFinite(leMs)) continue;
            if (lsMs < newEndMs && leMs > newStartMs) {
              clashed = true;
              clashId = L.id;
              clashName = (L.students && (L.students as any).full_name) || 'another student';
              const hhmm = (dt: Date) => `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
              clashStart = hhmm(new Date(L.start_time));
              clashEnd = hhmm(new Date(L.end_time));
              clashAmount = L.amount_paid != null ? Number(L.amount_paid) : null;
              break;
            }
          }
          if (clashed) {
            // Both single and recurring attach clash info uniformly — the
            // instructor must explicitly confirm before ANY of them save,
            // per Grant's direction (25 Aug 2026). Confirming cancels the
            // existing lesson and replaces it with the new one — an
            // instructor can only have one lesson at a given time, this
            // isn't a "let both coexist" override (25 Aug 2026, follow-up).
            // Cancelling goes through the same full/partial/waive charge
            // decision as a normal manual cancellation (25 Aug 2026,
            // second follow-up) rather than silently applying no charge.
            plan.push({ date: d, clash: { id: clashId, name: clashName, start: clashStart, end: clashEnd, agreedAmount: clashAmount } });
            continue;
          }
        }
        // No clash and no unavailability.
        plan.push({ date: d });
      } catch {
        plan.push({ date: d }); // be permissive on errors
      }
    }

    // For SINGLE lesson: enforce the hard-block on unavailabilities.
    if (!repeatOn) {
      const first = plan[0];
      if (first && first.reason === 'unavailable') {
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert('This time overlaps one of your unavailabilities. Remove or shrink the block first, then try again.');
        }
        return;
      }
    }

    // A genuine clash anywhere in the plan pauses here — nothing is saved
    // until the instructor explicitly confirms via the in-app dialog below
    // (a real dialog, not window.confirm(), which was removed previously
    // for silently returning false in some embedded/tunnelled preview
    // contexts, making Save look broken even when the slot was fine).
    const hasClash = plan.some((p) => p.clash);
    if (hasClash) {
      setPendingClashPlan(plan);
      return;
    }

    await finishSaving(plan);
  };

  // Everything that actually creates lessons and wraps up — called either
  // immediately (no clash found) or after the instructor explicitly
  // confirms the clash dialog. `plan` here has already been fully vetted:
  // any clash in it has either been confirmed or never existed.
  // `charges` maps each cancelled lesson's id to the charge amount the
  // instructor decided on (full/partial/waive) — see the clash dialog's
  // decide/partial steps below. Empty when there was no clash to confirm.
  const finishSaving = async (plan: PlanEntry[], charges: Record<string, number> = {}) => {
    const toCreate = plan.filter((p) => !p.reason);
    const skipped = plan.length - toCreate.length;

    // Cancel every existing lesson this plan clashes with (25 Aug 2026,
    // per Grant's direction) — an instructor can only have one lesson at
    // a given time, so confirming the dialog replaces the existing
    // booking rather than letting both coexist. Same charge patch shape
    // as a normal manual cancellation (status + amount_paid +
    // cancellation_charge + cancellation_note), not a silent no-charge
    // cancellation. Best-effort: a failure to cancel one clash shouldn't
    // block the others or the new lesson itself from being created.
    const toCancel = toCreate.filter((p) => p.clash).map((p) => p.clash!);
    for (const c of toCancel) {
      const charge = charges[c.id] ?? 0;
      const note = charge > 0
        ? `Cancelled — replaced by a new booking, charge applied (£${charge.toFixed(2)})`
        : 'Cancelled — replaced by a new booking, charge waived';
      try {
        await patchLesson(c.id, {
          status: 'Cancelled',
          amount_paid: charge,
          cancellation_charge: charge,
          cancellation_note: note,
        });
      } catch { /* best-effort — proceed regardless */ }
    }

    // -------- Mint series_id when recurring & we have ≥2 dates to create ----
    let seriesId: string | undefined;
    if (repeatOn && toCreate.length >= 2) {
      const g: any = (typeof globalThis !== 'undefined' ? globalThis : {}) as any;
      if (g.crypto && typeof g.crypto.randomUUID === 'function') {
        seriesId = g.crypto.randomUUID();
      } else {
        seriesId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }
    }

    // -------- Bulk create -------------------------------------------------
    let created = 0;
    let firstCreated: any = null;
    let firstError: any = null;
    for (const p of toCreate) {
      try {
        const row = await createLesson({
          student_id: studentId,
          date: p.date,
          start_time: startTime,
          end_time: endTime,
          travel_minutes: parseInt(travelMinutes, 10) || 0,
          topic,
          lesson_type: lessonType,
          amount_paid: undefined,
          quoted_amount: rate.trim() ? Number(rate.trim()) : undefined,
          series_id: seriesId,
        });
        if (!firstCreated) firstCreated = row;
        created += 1;
      } catch (e: any) {
        if (!firstError) firstError = e;
        // eslint-disable-next-line no-console
        console.warn('[diary] addLesson failed', e);
      }
    }

    // If nothing was created AND we had things to create, the insert(s) all
    // failed. Surface the underlying error loudly so the instructor doesn't
    // think the lesson silently saved when it didn't.
    if (created === 0 && toCreate.length > 0) {
      const detail = firstError?.message
        || firstError?.response?.data?.detail
        || 'Lesson could not be saved. Please try again.';
      // Alert is preferred here (sole user-visible error path); fall back to
      // window.alert in case Alert is not polyfilled.
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(`Could not create lesson: ${detail}`);
      } else {
        Alert.alert('Could not create lesson', detail);
      }
      return; // keep the sheet open so the instructor can adjust and retry
    }

    // -------- Wrap up -----------------------------------------------------
    const submittedDate = date;
    const submittedStart = startTime;
    const wasRecurring = repeatOn;
    setStudentId('');
    setDate('');
    setTopic('');
    setRepeatOn(false);
    onClose();

    // Tell the parent so it can scroll & jump the visible date. Any clash,
    // single or recurring, was already confirmed up-front via the dialog
    // above before anything was saved — there's nothing left to warn about
    // after the fact.
    if (firstCreated) {
      onCreated({
        firstDate: submittedDate,
        startTime: submittedStart,
        created,
        recurring: wasRecurring,
      });
    }

    // Schedule reminders for the first occurrence (Pro only).
    // NOTE: Student-side server-pushed reminders (48h / 25h / 1h) are now handled
    // by the backend scheduler in `dispatch_lesson_reminders()`. We intentionally
    // do NOT schedule local instructor reminders here — per spec, only students
    // receive lesson reminder push notifications.
    void pro; // kept for future use; no-op for now
    void firstCreated;

    // Summary toast — only when recurring, to avoid noise on a single save.
    // Only unavailability skips occurrences silently now — any clash was
    // already surfaced and confirmed up-front, so it's included in
    // `created`, not `skipped`.
    if (wasRecurring) {
      const lines: string[] = [`Created ${created} lesson${created === 1 ? '' : 's'}.`];
      if (skipped > 0) {
        lines.push(`Skipped ${skipped} (time off).`);
      }
      const msg = lines.join(' ');
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(msg);
      } else {
        Alert.alert('Recurring lessons', msg);
      }
    }
  };

  // Derived list of clashes needing a decision, and the one currently
  // being decided. Recomputed from pendingClashPlan each render rather
  // than stored separately, so it can't drift out of sync with it.
  const clashList = (pendingClashPlan || []).filter((p) => p.clash).map((p) => p.clash!);
  const currentClash = clashList[clashDecisionIndex];

  // Moves from the initial warning screen into the first charge decision.
  const beginClashDecisions = () => {
    setClashDecisionIndex(0);
    setClashCharges({});
    setClashStep('decide');
  };

  // Records the charge for the clash currently being decided, then either
  // advances to the next one or — once every clash has a decision —
  // actually cancels them all and saves the new lesson(s).
  const decideCurrentClash = async (charge: number) => {
    if (!currentClash) return;
    const updatedCharges = { ...clashCharges, [currentClash.id]: charge };
    setClashCharges(updatedCharges);
    setClashPartialInput('');
    const nextIndex = clashDecisionIndex + 1;
    if (nextIndex < clashList.length) {
      setClashDecisionIndex(nextIndex);
      setClashStep('decide');
      return;
    }
    // Every clash now has a decision — actually cancel and save.
    if (!pendingClashPlan) return;
    setConfirmBusy(true);
    try {
      await finishSaving(pendingClashPlan, updatedCharges);
    } finally {
      setConfirmBusy(false);
      setPendingClashPlan(null);
      setClashStep('confirm');
      setClashDecisionIndex(0);
      setClashCharges({});
    }
  };

  const cancelClash = () => {
    setPendingClashPlan(null);
    setClashStep('confirm');
    setClashDecisionIndex(0);
    setClashCharges({});
    setClashPartialInput('');
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add Lesson" testID="sheet-add-lesson">
      <Text style={styles.label}>Student</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {students.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.chip, studentId === s.id && styles.chipActive]}
            onPress={() => setStudentId(s.id)}
            testID={`pick-student-${s.id}`}
          >
            <Text style={[styles.chipText, studentId === s.id && styles.chipTextActive]}>{s.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.label}>Date</Text>
      <DateField value={date} onChange={setDate} testID="input-lesson-date" />

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Start</Text>
          <TimeField value={startTime} onChange={setStartTime} testID="input-lesson-start" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>End</Text>
          <TimeField value={endTime} onChange={setEndTime} testID="input-lesson-end" />
        </View>
      </View>

      <Text style={styles.label}>Topic</Text>
      <TextInput
        style={styles.input}
        value={topic}
        onChangeText={setTopic}
        placeholder="e.g. Roundabouts & Junctions"
        placeholderTextColor={theme.colors.textMuted}
        testID="input-lesson-topic"
      />

      <Text style={styles.label}>Lesson type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        {LESSON_TYPES.map((t) => {
          const active = lessonType === t.value;
          return (
            <TouchableOpacity
              key={t.value}
              style={[
                styles.chip,
                active && { backgroundColor: t.color, borderColor: t.color },
              ]}
              onPress={() => setLessonType(t.value)}
              testID={`lesson-type-${t.value}`}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: active ? '#fff' : t.color }} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.value}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={styles.label}>Lesson rate (£)</Text>
      <TextInput
        style={styles.input}
        value={rate}
        onChangeText={(v) => { rateManuallyEdited.current = true; setRate(v); }}
        placeholder="e.g. 36.00"
        placeholderTextColor={theme.colors.textMuted}
        keyboardType="decimal-pad"
        testID="input-lesson-rate"
      />
      {!!studentId && !!getStudent(studentId)?.hourly_rate && (
        <Text style={styles.hint}>
          Suggested from {getStudent(studentId)?.name}&apos;s usual rate — feel free to change it.
        </Text>
      )}

      <Text style={styles.label}>Travel buffer (minutes to next lesson)</Text>
      <TextInput
        style={styles.input}
        value={travelMinutes}
        onChangeText={setTravelMinutes}
        keyboardType="numeric"
        placeholder="15"
        placeholderTextColor={theme.colors.textMuted}
        testID="input-lesson-travel"
      />
      {travelInfo && (
        <View style={styles.travelInfoBox} testID="travel-info">
          <Car size={14} color={theme.colors.primary} />
          <Text style={styles.travelInfoText}>{travelInfo}</Text>
        </View>
      )}

      {/* Recurrence — bulk-create the lesson on the same weekday & time for N weeks */}
      <View style={styles.recurRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Repeat weekly</Text>
          <Text style={styles.recurHint}>
            Same weekday & time. Skips occurrences that clash or hit your time off.
          </Text>
        </View>
        <Switch
          value={repeatOn}
          onValueChange={setRepeatOn}
          trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          testID="switch-repeat"
        />
      </View>
      {repeatOn && (
        <View style={styles.recurWeeksBlock} testID="recur-weeks-block">
          <Text style={styles.label}>Number of weeks (incl. this one)</Text>
          <View style={styles.weekChipsRow}>
            {[2, 4, 8, 12, 26].map((n) => (
              <TouchableOpacity
                key={n}
                style={[styles.weekChip, parseInt(repeatWeeks, 10) === n && styles.weekChipActive]}
                onPress={() => setRepeatWeeks(String(n))}
                testID={`recur-chip-${n}`}
              >
                <Text style={[styles.weekChipText, parseInt(repeatWeeks, 10) === n && styles.weekChipTextActive]}>
                  {n}w
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.input, { marginTop: 8 }]}
            value={repeatWeeks}
            onChangeText={(v) => setRepeatWeeks(v.replace(/[^0-9]/g, '').slice(0, 2))}
            keyboardType="numeric"
            placeholder="4"
            placeholderTextColor={theme.colors.textMuted}
            testID="input-recur-weeks"
          />
        </View>
      )}

      <TouchableOpacity style={styles.submitBtn} onPress={handleAdd} testID="btn-submit-lesson">
        <Text style={styles.submitBtnText}>
          {repeatOn ? `Save ${recurWeeksNum} lessons` : 'Save Lesson'}
        </Text>
      </TouchableOpacity>

      {/* Clash confirmation (25 Aug 2026, updated in a follow-up the same
          day) — the actual missing piece behind this whole flow.
          pendingClashPlan, finishSaving and cancelClash already existed
          and were already correct for detecting clashes for both single
          and recurring lessons; nothing was ever rendering a dialog for
          the instructor to actually see and confirm, so tapping Save on a
          clashing lesson did nothing visible at all. Deliberately an
          in-app Modal, not the native window.confirm() an earlier comment
          describes replacing — that's what got silently suppressed in
          some preview contexts in the first place.

          Three steps, since an instructor can only have one lesson at a
          time (Grant's direction) and cancelling the existing one goes
          through the same real charge decision as a manual cancellation,
          not a silent no-charge one:
            'confirm' — lists every clash, "Don't replace" / "Cancel & replace"
            'decide'  — full/partial/waive for the clash currently being decided
            'partial' — amount entry, same 25/50/75% chips as the manual flow
          A recurring series can clash with several different existing
          lessons, so 'decide' loops through clashList one at a time. */}
      <Modal
        visible={!!pendingClashPlan}
        transparent
        animationType="fade"
        onRequestClose={cancelClash}
      >
        <View style={styles.clashBackdrop}>
          <View style={styles.clashCard} testID="clash-confirm-modal">
            {clashStep === 'confirm' && (
              <>
                <View style={styles.clashIconWrap}>
                  <AlertTriangle size={26} color="#fff" />
                </View>
                <Text style={styles.clashTitle}>Replace the existing booking?</Text>
                <ScrollView style={{ maxHeight: 180, alignSelf: 'stretch' }}>
                  {(pendingClashPlan || []).filter((p) => p.clash).map((p, i) => (
                    <Text key={i} style={styles.clashLine} testID={`clash-line-${i}`}>
                      {new Date(`${p.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' — '}{p.clash!.name}'s lesson ({p.clash!.start}–{p.clash!.end}) is already booked
                    </Text>
                  ))}
                </ScrollView>
                <Text style={styles.clashHint}>
                  An instructor can only have one lesson at a time. Confirming will cancel the existing lesson(s) above and replace them with this new booking — you'll choose how to handle the charge for each one next.
                </Text>
                <View style={{ flexDirection: 'row', gap: 9, marginTop: 14, alignSelf: 'stretch' }}>
                  <TouchableOpacity style={styles.clashCancelBtn} onPress={cancelClash} testID="clash-cancel">
                    <Text style={styles.clashCancelBtnText}>Don't replace</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.clashConfirmBtn} onPress={beginClashDecisions} testID="clash-confirm">
                    <Text style={styles.clashConfirmBtnText}>Cancel & replace</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {clashStep === 'decide' && currentClash && (
              <>
                <Text style={styles.clashTitle}>Cancel {currentClash.name}'s lesson?</Text>
                <Text style={styles.clashHint}>
                  {clashList.length > 1 ? `Clash ${clashDecisionIndex + 1} of ${clashList.length}. ` : ''}
                  Choose how to handle the charge.
                  {currentClash.agreedAmount != null
                    ? ` Agreed price: £${currentClash.agreedAmount.toFixed(2)}.`
                    : ' No agreed price recorded on this lesson.'}
                </Text>
                <View style={{ alignSelf: 'stretch', gap: 9, marginTop: 14 }}>
                  <TouchableOpacity
                    style={[styles.clashConfirmBtn, confirmBusy && { opacity: 0.6 }]}
                    onPress={() => decideCurrentClash(currentClash.agreedAmount ?? 0)}
                    disabled={confirmBusy}
                    testID="clash-charge-full"
                  >
                    {confirmBusy ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.clashConfirmBtnText}>
                        Apply full charge{currentClash.agreedAmount != null ? ` (£${currentClash.agreedAmount.toFixed(2)})` : ''}
                      </Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.clashPartialBtn}
                    onPress={() => setClashStep('partial')}
                    disabled={confirmBusy}
                    testID="clash-charge-partial"
                  >
                    <Text style={styles.clashPartialBtnText}>Apply partial charge…</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.clashCancelBtn}
                    onPress={() => decideCurrentClash(0)}
                    disabled={confirmBusy}
                    testID="clash-charge-waive"
                  >
                    {confirmBusy ? <ActivityIndicator color={theme.colors.textMuted} /> : <Text style={styles.clashCancelBtnText}>Waive charge (£0.00)</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {clashStep === 'partial' && currentClash && (
              <>
                <Text style={styles.clashTitle}>Partial charge</Text>
                <Text style={styles.clashHint}>
                  Enter the amount to charge {currentClash.name.split(' ')[0]} for this cancellation.
                  {currentClash.agreedAmount != null ? ` Agreed price is £${currentClash.agreedAmount.toFixed(2)}.` : ''}
                </Text>
                <View style={styles.clashAmountWrap}>
                  <Text style={styles.clashPoundSign}>£</Text>
                  <TextInput
                    value={clashPartialInput}
                    onChangeText={(v) => setClashPartialInput(v.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    style={styles.clashAmountInput}
                    testID="clash-partial-input"
                    autoFocus
                  />
                </View>
                {currentClash.agreedAmount != null && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    {[25, 50, 75].map((pct) => (
                      <TouchableOpacity
                        key={pct}
                        style={styles.clashChip}
                        onPress={() => setClashPartialInput((currentClash.agreedAmount! * (pct / 100)).toFixed(2))}
                        testID={`clash-partial-chip-${pct}`}
                      >
                        <Text style={styles.clashChipText}>{pct}%</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.clashConfirmBtn, { marginTop: 16, alignSelf: 'stretch' }, confirmBusy && { opacity: 0.6 }]}
                  onPress={() => {
                    const v = parseFloat(clashPartialInput);
                    if (!Number.isFinite(v) || v < 0) {
                      Alert.alert('Invalid amount', 'Please enter a valid amount in pounds.');
                      return;
                    }
                    decideCurrentClash(v);
                  }}
                  disabled={confirmBusy}
                  testID="clash-partial-confirm"
                >
                  {confirmBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.clashConfirmBtnText}>Cancel & charge £{clashPartialInput || '0.00'}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={{ marginTop: 10 }} onPress={() => setClashStep('decide')} disabled={confirmBusy} testID="clash-partial-back">
                  <Text style={styles.clashCancelBtnText}>Back</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </BottomSheet>
  );
}
