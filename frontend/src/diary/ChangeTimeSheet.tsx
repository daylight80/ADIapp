import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { BottomSheet } from '../BottomSheet';
import { DateField, TimeField } from '../DateTimeFields';
import { theme } from '../theme';
import { supabase } from '../supabaseClient';
import { listAvailabilityBlocks, type Lesson } from '../supabaseDb';
import { patchLessonOfflineAware } from '../offlineSync';
import { checkMove, endTimeFor, toMinutes, type DayLesson, type MoveCheck, type TimeBlock } from './moveLesson';

type Props = {
  visible: boolean;
  onClose: () => void;
  lesson: Lesson;
  studentName: string;
  /** Called once the new date and time are saved (or queued, with no signal). */
  onMoved: (change: { date: string; startTime: string; endTime: string; queued: boolean }) => void;
};

const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

/** The other lessons of this lesson's instructor on a day, with local times as minutes after midnight. */
async function loadDay(instructorId: string, date: string): Promise<{ lessons: DayLesson[]; blocks: TimeBlock[] }> {
  const from = new Date(`${date}T00:00:00`).toISOString();
  const to = new Date(`${date}T23:59:59`).toISOString();
  const { data, error } = await supabase
    .from('lessons')
    .select('id, start_time, end_time, status, travel_minutes, students(full_name)')
    .eq('instructor_id', instructorId)
    .gte('start_time', from)
    .lte('start_time', to);
  if (error) throw error;
  const minOfDay = (ts: string) => { const t = new Date(ts); return t.getHours() * 60 + t.getMinutes(); };
  const lessons = ((data || []) as any[]).map((l) => ({
    id: l.id as string,
    startMin: minOfDay(l.start_time),
    endMin: minOfDay(l.end_time),
    status: l.status as string,
    travel_minutes: l.travel_minutes as number | null,
    studentName: ((l.students as any)?.full_name as string) || '',
  }));
  const blocks = await listAvailabilityBlocks(from, to);
  return { lessons, blocks };
}

/**
 * "Change date or time" for one lesson, for the teacher. The lesson keeps its length, so the end time follows the
 * start. Clashes and marked time off stop the move; a time in the past or too little travel time only warn.
 */
export function ChangeTimeSheet({ visible, onClose, lesson, studentName, onMoved }: Props) {
  const [date, setDate] = useState(lesson.date);
  const [startTime, setStartTime] = useState(lesson.start_time);
  const [result, setResult] = useState<MoveCheck | null>(null);
  const [couldNotCheck, setCouldNotCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationMinutes = Math.max(15, Math.round(toMinutes(lesson.end_time) - toMinutes(lesson.start_time)) || Math.round((lesson.duration_hours || 1) * 60));
  const endTime = endTimeFor(startTime, durationMinutes);

  // Each time it opens: start from the lesson's own date and time.
  useEffect(() => {
    if (!visible) return;
    setDate(lesson.date); setStartTime(lesson.start_time); setResult(null); setCouldNotCheck(false); setError(null); setBusy(false);
  }, [visible, lesson.id, lesson.date, lesson.start_time]);

  const edited = (fn: () => void) => { fn(); setResult(null); setCouldNotCheck(false); setError(null); };

  const hasBlockers = !!result && result.blockers.length > 0;
  const needsOk = !!result && !hasBlockers && (result.warnings.length > 0 || couldNotCheck);

  const submit = async () => {
    setError(null);
    // A second press on "Move anyway": the teacher has read the warnings.
    if (needsOk) { await save(); return; }
    setBusy(true);
    let checked: MoveCheck;
    let unchecked = false;
    try {
      const day = await loadDay(lesson.instructor_id, date);
      checked = checkMove({
        lessonId: lesson.id, from: { date: lesson.date, startTime: lesson.start_time }, date, startTime, durationMinutes,
        travelMinutes: lesson.travel_minutes, dayLessons: day.lessons, blocks: day.blocks,
      });
    } catch {
      // No signal, or the diary could not be read: say so, and let the teacher decide.
      unchecked = true;
      checked = checkMove({
        lessonId: lesson.id, from: { date: lesson.date, startTime: lesson.start_time }, date, startTime, durationMinutes,
        travelMinutes: lesson.travel_minutes, dayLessons: [], blocks: [],
      });
    }
    setCouldNotCheck(unchecked);
    setResult(checked);
    setBusy(false);
    if (checked.blockers.length === 0 && checked.warnings.length === 0 && !unchecked) await save(checked);
  };

  const save = async (checked: MoveCheck | null = result) => {
    const end = checked?.endTime || endTime;
    setBusy(true);
    try {
      const { queued } = await patchLessonOfflineAware(
        lesson.id,
        { date, start_time: startTime, end_time: end },
        `Move lesson ${lesson.date} ${lesson.start_time} to ${date} ${startTime}`,
      );
      onMoved({ date, startTime, endTime: end, queued });
    } catch (e: any) {
      setError(e?.message || 'Could not move the lesson. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const buttonText = needsOk ? 'Move anyway' : 'Move lesson';

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Change ${studentName.split(' ')[0]}'s lesson`} testID="sheet-change-time">
      <View style={{ gap: 12 }}>
        <View style={s.now} testID="change-time-now">
          <Text style={s.nowLabel}>Now</Text>
          <Text style={s.nowText}>{dayLabel(lesson.date)}, {lesson.start_time}–{lesson.end_time}</Text>
        </View>

        <Text style={s.label}>New date</Text>
        <DateField value={date} onChange={(v) => edited(() => setDate(v))} testID="change-time-date" />
        <Text style={s.label}>New start time</Text>
        <TimeField value={startTime} onChange={(v) => edited(() => setStartTime(v))} testID="change-time-start" />

        <Text style={s.hint} testID="change-time-summary">
          {endTime
            ? `${dayLabel(date)}, ${startTime}–${endTime} (the lesson stays ${durationMinutes % 60 === 0 ? `${durationMinutes / 60}h` : `${durationMinutes} min`} long)`
            : 'Choose a start time that lets the lesson finish before midnight.'}
        </Text>

        {result?.blockers.map((b) => <Text key={b} style={s.blocker} testID="change-time-blocker">{b}</Text>)}
        {result?.warnings.map((w) => <Text key={w} style={s.warning} testID="change-time-warning">{w}</Text>)}
        {couldNotCheck && !hasBlockers && (
          <Text style={s.warning} testID="change-time-unchecked">
            Could not check your diary for clashes or time off (no signal?). You can still move the lesson.
          </Text>
        )}
        {!!error && <Text style={s.blocker} testID="change-time-error">{error}</Text>}

        <TouchableOpacity
          style={[s.primary, (busy || hasBlockers) && s.disabled]}
          onPress={submit}
          disabled={busy || hasBlockers}
          testID="btn-change-time-save"
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{buttonText}</Text>}
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  now: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: theme.colors.background, borderRadius: 10, padding: 12 },
  nowLabel: { color: theme.colors.textMuted, fontWeight: '700', fontSize: 12 },
  nowText: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  label: { fontSize: 12.5, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 18 },
  blocker: { fontSize: 13.5, color: theme.colors.danger, lineHeight: 19 },
  warning: { fontSize: 13.5, color: theme.colors.accent, lineHeight: 19 },
  primary: { height: 50, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.45 },
});
