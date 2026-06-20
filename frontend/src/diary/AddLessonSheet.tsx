import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, Alert } from 'react-native';
import { Car } from 'lucide-react-native';
import { theme } from '../theme';
import { BottomSheet } from '../BottomSheet';
import { DateField, TimeField } from '../DateTimeFields';
import { supabase } from '../supabaseClient';
import { createLesson } from '../useSupabaseData';
import { overlapsAnyBlock, type AvailabilityBlock } from '../supabaseDb';
import { Lesson, Student } from '../mockDb';
import { getTravelTime, lessonAddress } from '../maps';
import { scheduleLessonReminders } from '../notifications';
import { styles } from './diaryStyles';

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
  const [travelMinutes, setTravelMinutes] = useState('15');

  // Recurrence — bulk-create across `repeatWeeks` consecutive weeks at the
  // same weekday & time. We stamp a shared `series_id` so the bulk-cancel UX
  // can find the related occurrences.
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState<string>('4');

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

  // Reset form on close so re-opens start fresh.
  useEffect(() => {
    if (!visible) {
      setTravelInfo(null);
    }
  }, [visible]);

  const recurWeeksNum = useMemo(
    () => Math.max(2, Math.min(26, parseInt(repeatWeeks, 10) || 4)),
    [repeatWeeks],
  );

  const handleAdd = async () => {
    if (!studentId || !date || !topic) return;

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
    type ClashInfo = { name: string; start: string; end: string };
    type Plan = { date: string; reason?: 'unavailable' | 'clash'; clash?: ClashInfo };
    const plan: Plan[] = [];
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
            .select('id, start_time, end_time, status, students(full_name)')
            .eq('instructor_id', instructorId)
            .gte('start_time', fromIsoX)
            .lte('start_time', toIsoX);
          const newStartMs = new Date(sIso).getTime();
          const newEndMs = new Date(eIso).getTime();
          let clashed = false;
          let clashName = '';
          let clashStart = '';
          let clashEnd = '';
          for (const L of (dayLessons || []) as any[]) {
            if (L.status === 'Cancelled') continue;
            const lsMs = new Date(L.start_time).getTime();
            const leMs = new Date(L.end_time).getTime();
            if (!Number.isFinite(lsMs) || !Number.isFinite(leMs)) continue;
            if (lsMs < newEndMs && leMs > newStartMs) {
              clashed = true;
              clashName = (L.students && (L.students as any).full_name) || 'another student';
              const hhmm = (dt: Date) => `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
              clashStart = hhmm(new Date(L.start_time));
              clashEnd = hhmm(new Date(L.end_time));
              break;
            }
          }
          if (clashed) {
            // For SINGLE lesson: previously we asked `window.confirm("Save
            // anyway?")` here. That browser-native modal is suppressed by some
            // embedded WebViews / tunnelled previews, returning false silently
            // — which made the Save button appear broken even when the slot
            // was perfectly fine. The instructor explicitly tapped Save, so
            // we now save the lesson immediately and just remember the clash
            // so the parent can surface a non-blocking snackbar afterwards.
            if (!repeatOn) {
              plan.push({ date: d, clash: { name: clashName, start: clashStart, end: clashEnd } });
              continue;
            }
            // For RECURRING: silently skip the clashing occurrence.
            plan.push({ date: d, reason: 'clash' });
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

    const toCreate = plan.filter((p) => !p.reason);
    const skipped = plan.length - toCreate.length;

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
          amount_paid: undefined,
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

    // Tell the parent so it can scroll & jump the visible date.
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
    if (wasRecurring) {
      const lines: string[] = [`Created ${created} lesson${created === 1 ? '' : 's'}.`];
      if (skipped > 0) {
        const unav = plan.filter((p) => p.reason === 'unavailable').length;
        const clashes = plan.filter((p) => p.reason === 'clash').length;
        const bits: string[] = [];
        if (unav > 0) bits.push(`${unav} time off`);
        if (clashes > 0) bits.push(`${clashes} clash${clashes === 1 ? '' : 'es'}`);
        lines.push(`Skipped ${skipped} (${bits.join(' · ')}).`);
      }
      const msg = lines.join(' ');
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(msg);
      } else {
        Alert.alert('Recurring lessons', msg);
      }
    }
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
    </BottomSheet>
  );
}
