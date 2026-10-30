import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { BottomSheet } from '../BottomSheet';
import { DateField, TimeField } from '../DateTimeFields';
import { theme } from '../theme';
import { supabase } from '../supabaseClient';
import { listAvailabilityBlocks, type Lesson } from '../supabaseDb';
import { patchLessonOfflineAware } from '../offlineSync';
import {
  checkMove, checkSeriesMove, dayLabel, endTimeFor, toMinutes,
  type DayLesson, type SeriesItem, type SeriesLesson, type TimeBlock,
} from './moveLesson';

type Props = {
  visible: boolean;
  onClose: () => void;
  lesson: Lesson;
  studentName: string;
  /** Called once the new date and time are saved (or queued, with no signal). `count` is how many lessons moved. */
  onMoved: (change: { date: string; startTime: string; endTime: string; queued: boolean; count: number }) => void;
};

/** What a check found, for one lesson or for a whole series. */
type Outcome = { blockers: string[]; warnings: string[]; endTime: string; items?: SeriesItem[] };

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (ts: string) => { const t = new Date(ts); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const localMinutes = (ts: string) => { const t = new Date(ts); return t.getHours() * 60 + t.getMinutes(); };
const localTime = (ts: string) => `${pad(Math.floor(localMinutes(ts) / 60))}:${pad(localMinutes(ts) % 60)}`;

/** The other lessons of this lesson's instructor between two days, keyed by day, and the time marked as unavailable. */
async function loadRange(instructorId: string, fromDate: string, toDate: string): Promise<{ byDate: Record<string, DayLesson[]>; blocks: TimeBlock[] }> {
  const from = new Date(`${fromDate}T00:00:00`).toISOString();
  const to = new Date(`${toDate}T23:59:59`).toISOString();
  const { data, error } = await supabase
    .from('lessons')
    .select('id, start_time, end_time, status, travel_minutes, students(full_name)')
    .eq('instructor_id', instructorId)
    .gte('start_time', from)
    .lte('start_time', to);
  if (error) throw error;
  const byDate: Record<string, DayLesson[]> = {};
  for (const l of (data || []) as any[]) {
    (byDate[localDate(l.start_time)] ||= []).push({
      id: l.id as string,
      startMin: localMinutes(l.start_time),
      endMin: localMinutes(l.end_time),
      status: l.status as string,
      travel_minutes: l.travel_minutes as number | null,
      studentName: ((l.students as any)?.full_name as string) || '',
    });
  }
  return { byDate, blocks: await listAvailabilityBlocks(from, to) };
}

/** This lesson and the Scheduled ones after it in its repeating series, in date order. */
async function loadSeries(seriesId: string, fromIso: string): Promise<SeriesLesson[]> {
  const { data, error } = await supabase
    .from('lessons')
    .select('id, start_time, end_time, travel_minutes')
    .eq('series_id', seriesId)
    .eq('status', 'Scheduled')
    .gte('start_time', fromIso)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return ((data || []) as any[]).map((l) => ({
    id: l.id as string,
    date: localDate(l.start_time),
    startTime: localTime(l.start_time),
    durationMinutes: Math.round((new Date(l.end_time).getTime() - new Date(l.start_time).getTime()) / 60000),
    travelMinutes: l.travel_minutes as number | null,
  }));
}

/**
 * "Change date or time" for the teacher. A lesson keeps its length, so the end time follows the start. Clashes and
 * marked time off stop the move; a time in the past or too little travel time only warn. A lesson in a repeating
 * series can move on its own, or with every lesson after it by the same amount.
 */
export function ChangeTimeSheet({ visible, onClose, lesson, studentName, onMoved }: Props) {
  const [date, setDate] = useState(lesson.date);
  const [startTime, setStartTime] = useState(lesson.start_time);
  const [scope, setScope] = useState<'one' | 'following'>('one');
  const [seriesLessons, setSeriesLessons] = useState<SeriesLesson[] | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [couldNotCheck, setCouldNotCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationMinutes = Math.max(15, Math.round(toMinutes(lesson.end_time) - toMinutes(lesson.start_time)) || Math.round((lesson.duration_hours || 1) * 60));
  const endTime = endTimeFor(startTime, durationMinutes);
  const followingCount = seriesLessons ? seriesLessons.length - 1 : 0;
  const movingSeries = scope === 'following' && followingCount > 0;

  // Each time it opens: start from the lesson's own date and time, and see whether it is part of a series.
  useEffect(() => {
    if (!visible) return;
    setDate(lesson.date); setStartTime(lesson.start_time); setScope('one'); setResult(null); setCouldNotCheck(false); setError(null); setBusy(false);
    setSeriesLessons(null);
    if (!lesson.series_id) return;
    let alive = true;
    loadSeries(lesson.series_id, new Date(`${lesson.date}T${lesson.start_time}:00`).toISOString())
      .then((rows) => { if (alive && rows.length > 1) setSeriesLessons(rows); })
      .catch(() => { /* no signal: it can still be moved on its own */ });
    return () => { alive = false; };
  }, [visible, lesson.id, lesson.date, lesson.start_time, lesson.series_id]);

  const edited = (fn: () => void) => { fn(); setResult(null); setCouldNotCheck(false); setError(null); };

  const hasBlockers = !!result && result.blockers.length > 0;
  const needsOk = !!result && !hasBlockers && (result.warnings.length > 0 || couldNotCheck);

  const runCheck = async (): Promise<{ outcome: Outcome; unchecked: boolean }> => {
    const from = { date: lesson.date, startTime: lesson.start_time };
    if (movingSeries && seriesLessons) {
      const dates = seriesLessons.map((l) => l.date);
      const range = async () => {
        // The days they are moving to: the same shift for each lesson, so the earliest and latest cover them all.
        const first = checkSeriesMove({ lessons: seriesLessons, date, startTime, dayLessonsByDate: {}, blocks: [] });
        const days = first.items.map((i) => i.date).concat(dates).sort();
        return loadRange(lesson.instructor_id, days[0], days[days.length - 1]);
      };
      let byDate: Record<string, DayLesson[]> = {};
      let blocks: TimeBlock[] = [];
      let unchecked = false;
      try { ({ byDate, blocks } = await range()); } catch { unchecked = true; }
      const c = checkSeriesMove({ lessons: seriesLessons, date, startTime, dayLessonsByDate: byDate, blocks });
      return { outcome: { blockers: c.blockers, warnings: c.warnings, endTime: c.items[0]?.endTime || '', items: c.items }, unchecked };
    }
    let day: { byDate: Record<string, DayLesson[]>; blocks: TimeBlock[] } = { byDate: {}, blocks: [] };
    let unchecked = false;
    try { day = await loadRange(lesson.instructor_id, date, date); } catch { unchecked = true; }
    const c = checkMove({
      lessonId: lesson.id, from, date, startTime, durationMinutes, travelMinutes: lesson.travel_minutes,
      dayLessons: day.byDate[date] || [], blocks: day.blocks,
    });
    return { outcome: { blockers: c.blockers, warnings: c.warnings, endTime: c.endTime }, unchecked };
  };

  const submit = async () => {
    setError(null);
    // A second press on "Move anyway": the teacher has read the warnings.
    if (needsOk) { await save(); return; }
    setBusy(true);
    const { outcome, unchecked } = await runCheck();
    setCouldNotCheck(unchecked);
    setResult(outcome);
    setBusy(false);
    if (outcome.blockers.length === 0 && outcome.warnings.length === 0 && !unchecked) await save(outcome);
  };

  const save = async (checked: Outcome | null = result) => {
    setBusy(true);
    try {
      if (checked?.items) {
        // One lesson after another. If one fails, say how far it got: the diary shows where things stand.
        let done = 0;
        let queued = false;
        for (const it of checked.items) {
          try {
            const r = await patchLessonOfflineAware(it.id, { date: it.date, start_time: it.startTime, end_time: it.endTime }, `Move lesson to ${it.date} ${it.startTime}`);
            done += 1;
            if (r.queued) queued = true;
          } catch (e: any) {
            setError(`Moved ${done} of ${checked.items.length} lessons, then it stopped: ${e?.message || 'please try again'}. Check the diary.`);
            return;
          }
        }
        const first = checked.items[0];
        onMoved({ date: first.date, startTime: first.startTime, endTime: first.endTime, queued, count: checked.items.length });
        return;
      }
      const end = checked?.endTime || endTime;
      const { queued } = await patchLessonOfflineAware(
        lesson.id,
        { date, start_time: startTime, end_time: end },
        `Move lesson ${lesson.date} ${lesson.start_time} to ${date} ${startTime}`,
      );
      onMoved({ date, startTime, endTime: end, queued, count: 1 });
    } catch (e: any) {
      setError(e?.message || 'Could not move the lesson. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const buttonText = needsOk ? 'Move anyway' : movingSeries ? `Move ${seriesLessons!.length} lessons` : 'Move lesson';
  const length = durationMinutes % 60 === 0 ? `${durationMinutes / 60}h` : `${durationMinutes} min`;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Change ${studentName.split(' ')[0]}'s lesson`} testID="sheet-change-time">
      <View style={{ gap: 12 }}>
        <View style={s.now} testID="change-time-now">
          <Text style={s.nowLabel}>Now</Text>
          <Text style={s.nowText}>{dayLabel(lesson.date)}, {lesson.start_time}–{lesson.end_time}</Text>
        </View>

        {followingCount > 0 && (
          <View style={s.scopeRow} testID="change-time-scope">
            <TouchableOpacity
              style={[s.scopeBtn, scope === 'one' && s.scopeOn]}
              onPress={() => edited(() => setScope('one'))}
              accessibilityRole="radio" accessibilityState={{ selected: scope === 'one' }}
              testID="scope-one"
            >
              <Text style={[s.scopeText, scope === 'one' && s.scopeTextOn]}>Just this lesson</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.scopeBtn, scope === 'following' && s.scopeOn]}
              onPress={() => edited(() => setScope('following'))}
              accessibilityRole="radio" accessibilityState={{ selected: scope === 'following' }}
              testID="scope-following"
            >
              <Text style={[s.scopeText, scope === 'following' && s.scopeTextOn]}>This and the {followingCount} after it</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={s.label}>New date</Text>
        <DateField value={date} onChange={(v) => edited(() => setDate(v))} testID="change-time-date" />
        <Text style={s.label}>New start time</Text>
        <TimeField value={startTime} onChange={(v) => edited(() => setStartTime(v))} testID="change-time-start" />

        <Text style={s.hint} testID="change-time-summary">
          {!endTime
            ? 'Choose a start time that lets the lesson finish before midnight.'
            : movingSeries
              ? `${seriesLessons!.length} lessons. The first becomes ${dayLabel(date)}, ${startTime}–${endTime}; each one after it moves by the same amount.`
              : `${dayLabel(date)}, ${startTime}–${endTime} (the lesson stays ${length} long)`}
        </Text>

        {result?.blockers.map((b) => <Text key={b} style={s.blocker} testID="change-time-blocker">{b}</Text>)}
        {result?.warnings.map((w) => <Text key={w} style={s.warning} testID="change-time-warning">{w}</Text>)}
        {couldNotCheck && !hasBlockers && (
          <Text style={s.warning} testID="change-time-unchecked">
            Could not check your diary for clashes or time off (no signal?). You can still move the lesson{movingSeries ? 's' : ''}.
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
  scopeRow: { flexDirection: 'row', gap: 8 },
  scopeBtn: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1.5, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  scopeOn: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight },
  scopeText: { fontSize: 13.5, fontWeight: '700', color: theme.colors.textMuted, textAlign: 'center' },
  scopeTextOn: { color: theme.colors.primary },
  label: { fontSize: 12.5, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 18 },
  blocker: { fontSize: 13.5, color: theme.colors.danger, lineHeight: 19 },
  warning: { fontSize: 13.5, color: theme.colors.accent, lineHeight: 19 },
  primary: { height: 50, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.45 },
});
