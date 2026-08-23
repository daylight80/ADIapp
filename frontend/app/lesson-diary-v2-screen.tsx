import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useLessonsForWeek, useStudents } from '../src/useSupabaseData';
import { BottomNav } from '../src/BottomNav';
import { LessonToolsSheet } from '../src/LessonToolsSheet';
import { Lesson } from '../src/mockDb';
import { startOfWeek, addDays, localDateKey } from '../src/diary/dateUtils';
import { colorForLessonType, LESSON_TYPES } from '../src/diary/lessonTypes';
import { AddLessonSheet } from '../src/diary/AddLessonSheet';

/**
 * TRIAL — a Claude Design handoff (23 Aug 2026), implemented as a separate
 * route rather than replacing lesson-diary-screen.tsx directly, so it can
 * be reviewed and compared without any risk to the current live screen.
 * Real data throughout (useLessonsForWeek, useStudents) — the design
 * file's own hardcoded seed data was reference only, never used here.
 *
 * Visual language: "road-signage blocks on warm paper" — Archivo for
 * numerals/headlines, Barlow for everything else, warm paper background
 * instead of the current cool blue/white. Lesson-type colors are
 * unchanged — they already matched lessonTypes.ts verbatim in the design.
 *
 * Scope note: the Day/Week grid views below got the full visual
 * treatment, since that's what's actually looked at all day. The lesson
 * detail interaction reuses the existing, already-working LessonToolsSheet
 * rather than rebuilding a new bottom sheet from scratch — a deliberate
 * scoping choice to keep this trial focused, not a shortcut hiding
 * unfinished work.
 */

const C = {
  pageBg: '#DCD6CA',
  surface: '#F5F2EC',
  border: '#E4DED2',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  track: '#EAE5DA',
  primary: '#00539F',
  accent: '#FF6B00',
  gapDash: '#D6CFC1',
};

const TOP_MIN = 7 * 60;
const BOTTOM_MIN = 21 * 60;
const HOUR_H = 56;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function hhmm(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function durLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return (h ? `${h}h` : '') + (m ? `${h ? ' ' : ''}${m}m` : '') || '0m';
}

function toMinutesOfDay(hhmmStr: string): number {
  const [h, m] = hhmmStr.split(':').map(Number);
  return h * 60 + m;
}

function getISOWeek(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

export default function LessonDiaryV2Screen() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });
  const [detailLesson, setDetailLesson] = useState<Lesson | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const { lessons } = useLessonsForWeek(weekStart);
  const { students } = useStudents();
  const hourlyRate = 38; // reference rate for the "billable" summary figure only

  const selectedDayIdx = Math.round((selectedDate.getTime() - weekStart.getTime()) / 86400000);
  const todayKey = localDateKey(new Date());

  const lessonsByDay = useMemo(() => {
    const map: Lesson[][] = [[], [], [], [], [], [], []];
    for (const l of lessons) {
      const d = new Date(`${l.date}T00:00:00`);
      const idx = Math.round((d.getTime() - weekStart.getTime()) / 86400000);
      if (idx >= 0 && idx < 7) map[idx].push(l);
    }
    for (const day of map) day.sort((a, b) => toMinutesOfDay(a.start_time) - toMinutesOfDay(b.start_time));
    return map;
  }, [lessons, weekStart]);

  const dayList = lessonsByDay[selectedDayIdx] || [];

  const totalMinutesFor = (idx: number) =>
    (lessonsByDay[idx] || []).reduce((sum, l) => sum + (toMinutesOfDay(l.end_time) - toMinutesOfDay(l.start_time)), 0);
  const weekMinutes = [0, 1, 2, 3, 4, 5, 6].reduce((sum, i) => sum + totalMinutesFor(i), 0);
  const weekGapCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const list = lessonsByDay[i] || [];
      for (let k = 1; k < list.length; k++) {
        if (toMinutesOfDay(list[k].start_time) - toMinutesOfDay(list[k - 1].end_time) >= 60) count++;
      }
    }
    return count;
  }, [lessonsByDay]);

  const studentName = (id: string) => students.find((st) => st.id === id)?.name || 'Student';

  const openAddAt = () => setAddOpen(true);

  const hourLines: number[] = [];
  for (let h = 7; h <= 21; h++) hourLines.push(h);

  return (
    <SafeAreaView style={s.outer} edges={['top']}>
      <View style={s.phoneSurface}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>Week {getISOWeek(weekStart)} · {weekStart.toLocaleDateString('en-GB', { month: 'long' })}</Text>
            <Text style={s.headline} numberOfLines={1}>
              {viewMode === 'day'
                ? `${DOW[selectedDayIdx]} ${selectedDate.getDate()} ${selectedDate.toLocaleDateString('en-GB', { month: 'short' })}`
                : `${weekStart.getDate()} ${weekStart.toLocaleDateString('en-GB', { month: 'short' })} – ${addDays(weekStart, 6).getDate()} ${addDays(weekStart, 6).toLocaleDateString('en-GB', { month: 'short' })}`}
            </Text>
          </View>
          <TouchableOpacity style={s.navBtn} onPress={() => router.back()} testID="btn-back-v2">
            <ArrowLeft size={17} color={C.text} />
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginTop: 4 }}>
          <View style={s.toggleTrack}>
            <TouchableOpacity style={[s.toggleTab, viewMode === 'day' && s.toggleTabActive]} onPress={() => setViewMode('day')} testID="v2-view-day">
              <Text style={[s.toggleText, viewMode === 'day' && s.toggleTextActive]}>Day</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.toggleTab, viewMode === 'week' && s.toggleTabActive]} onPress={() => setViewMode('week')} testID="v2-view-week">
              <Text style={[s.toggleText, viewMode === 'week' && s.toggleTextActive]}>Week</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.periodSummary} numberOfLines={1}>
            {viewMode === 'week'
              ? `${durLabel(weekMinutes)} booked`
              : dayList.length ? `${dayList.length} lessons · ${durLabel(totalMinutesFor(selectedDayIdx))}` : 'Nothing booked'}
          </Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
          {viewMode === 'week' ? (
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {DOW.map((d, i) => {
                  const dayDate = addDays(weekStart, i);
                  const isToday = localDateKey(dayDate) === todayKey;
                  const isSelected = i === selectedDayIdx;
                  const dayLessons = lessonsByDay[i] || [];
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[s.weekCol, isSelected && s.weekColActive]}
                      onPress={() => { setSelectedDate(dayDate); setViewMode('day'); }}
                      testID={`v2-week-col-${i}`}
                    >
                      <Text style={[s.weekColDow, isToday && { color: C.accent }]}>{d}</Text>
                      <Text style={s.weekColDate}>{dayDate.getDate()}</Text>
                      <View style={s.weekColTrack}>
                        {dayLessons.map((l) => {
                          const sMin = toMinutesOfDay(l.start_time);
                          const eMin = toMinutesOfDay(l.end_time);
                          const top = ((sMin - TOP_MIN) / (BOTTOM_MIN - TOP_MIN)) * 260;
                          const height = Math.max(6, ((eMin - sMin) / (BOTTOM_MIN - TOP_MIN)) * 260);
                          return (
                            <View
                              key={l.id}
                              style={{ position: 'absolute', left: 1, right: 1, top, height, backgroundColor: colorForLessonType(l.lesson_type), borderRadius: 4 }}
                            />
                          );
                        })}
                      </View>
                      <Text style={[s.weekColFoot, dayLessons.length ? { color: C.primary } : undefined]}>
                        {dayLessons.length ? `£${Math.round(totalMinutesFor(i) / 60 * hourlyRate)}` : 'Off'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={s.statsCard}>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={s.statValue}>{durLabel(weekMinutes)}</Text>
                  <Text style={s.statLabel}>Taught this week</Text>
                </View>
                <View style={s.statDivider} />
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={[s.statValue, { color: C.primary }]}>£{Math.round(weekMinutes / 60 * hourlyRate)}</Text>
                  <Text style={s.statLabel}>Billable</Text>
                </View>
                <View style={s.statDivider} />
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={[s.statValue, { color: C.accent }]}>{weekGapCount}</Text>
                  <Text style={s.statLabel}>Fillable gaps</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                {LESSON_TYPES.map((t) => (
                  <View key={t.value} style={s.legendChip}>
                    <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: t.color }} />
                    <Text style={s.legendText}>{t.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={{ paddingTop: 12 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 14, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 5 }}>
                  {DOW.map((d, i) => {
                    const dayDate = addDays(weekStart, i);
                    const isToday = localDateKey(dayDate) === todayKey;
                    const isSelected = i === selectedDayIdx;
                    return (
                      <TouchableOpacity
                        key={d}
                        style={[s.dayPill, isSelected && s.dayPillActive]}
                        onPress={() => setSelectedDate(dayDate)}
                        testID={`v2-day-pill-${i}`}
                      >
                        <Text style={[s.dayPillDow, isSelected ? { color: 'rgba(255,255,255,.7)' } : isToday ? { color: C.accent } : undefined]}>{d}</Text>
                        <Text style={[s.dayPillDate, isSelected && { color: '#fff' }]}>{dayDate.getDate()}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <View style={{ paddingHorizontal: 14 }}>
                <View style={{ position: 'relative', height: (BOTTOM_MIN - TOP_MIN) / 60 * HOUR_H }}>
                  {hourLines.map((h) => {
                    const y = (h * 60 - TOP_MIN) / 60 * HOUR_H;
                    return (
                      <React.Fragment key={h}>
                        <View style={{ position: 'absolute', left: 38, right: 0, top: y, height: 1, backgroundColor: 'rgba(15,23,42,0.07)' }} />
                        <Text style={{ position: 'absolute', left: 0, top: y - 7, fontFamily: 'Barlow_600SemiBold', fontSize: 11, color: '#A69C8B' }}>
                          {String(h).padStart(2, '0')}
                        </Text>
                      </React.Fragment>
                    );
                  })}

                  {dayList.length === 0 ? (
                    <TouchableOpacity style={[s.gapSlot, { top: 120, height: 70 }]} onPress={openAddAt} testID="v2-empty-day-slot">
                      <Text style={s.gapMeta}>No lessons booked — rest day</Text>
                      <Text style={s.gapCta}>+ Book</Text>
                    </TouchableOpacity>
                  ) : (
                    dayList.map((l, k) => {
                      const sMin = toMinutesOfDay(l.start_time);
                      const eMin = toMinutesOfDay(l.end_time);
                      const items = [];
                      const prev = k > 0 ? dayList[k - 1] : null;
                      if (prev) {
                        const prevEnd = toMinutesOfDay(prev.end_time);
                        if (sMin - prevEnd >= 60) {
                          const top = (prevEnd - TOP_MIN) / 60 * HOUR_H;
                          const height = (sMin - prevEnd) / 60 * HOUR_H - 4;
                          items.push(
                            <TouchableOpacity key={`gap-${l.id}`} style={[s.gapSlot, { top, height }]} onPress={openAddAt} testID={`v2-gap-${l.id}`}>
                              <Text style={s.gapMeta}>Free · {durLabel(sMin - prevEnd)} · {hhmm(prevEnd)}–{hhmm(sMin)}</Text>
                              <Text style={s.gapCta}>+ Book</Text>
                            </TouchableOpacity>,
                          );
                        }
                      }
                      const top = (sMin - TOP_MIN) / 60 * HOUR_H;
                      const height = (eMin - sMin) / 60 * HOUR_H - 4;
                      items.push(
                        <TouchableOpacity
                          key={l.id}
                          style={[s.lessonBlock, { top, height, backgroundColor: colorForLessonType(l.lesson_type) }]}
                          onPress={() => setDetailLesson(l)}
                          testID={`v2-lesson-${l.id}`}
                        >
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={s.lessonBlockName} numberOfLines={1}>{studentName(l.student_id)}</Text>
                            <Text style={s.lessonBlockMeta} numberOfLines={1}>{hhmm(sMin)}–{hhmm(eMin)} · {l.topic || l.lesson_type}</Text>
                          </View>
                          <Text style={s.lessonBlockTag}>{durLabel(eMin - sMin)}</Text>
                        </TouchableOpacity>,
                      );
                      return items;
                    })
                  )}
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        <TouchableOpacity style={s.fab} onPress={openAddAt} testID="v2-fab-add">
          <Text style={s.fabText}>+ Add lesson</Text>
        </TouchableOpacity>

        <BottomNav role="instructor" />
      </View>

      <LessonToolsSheet
        visible={!!detailLesson}
        onClose={() => setDetailLesson(null)}
        lesson={detailLesson}
        onChanged={() => setSelectedDate(new Date(selectedDate))}
      />
      <AddLessonSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        students={students}
        lessons={lessons}
        availBlocks={[]}
        pro
        onCreated={() => { setAddOpen(false); setSelectedDate(new Date(selectedDate)); }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  outer: { flex: 1, backgroundColor: C.pageBg },
  phoneSurface: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, gap: 10 },
  eyebrow: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: C.textMuted },
  headline: { fontFamily: 'Archivo_800ExtraBold', fontSize: 27, letterSpacing: -0.6, color: C.text, marginTop: 1 },
  navBtn: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  toggleTrack: { flexDirection: 'row', padding: 3, backgroundColor: '#EAE5DA', borderRadius: 11 },
  toggleTab: { minWidth: 62, minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 9 },
  toggleTabActive: { backgroundColor: '#fff' },
  toggleText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: C.textMuted },
  toggleTextActive: { color: C.text },
  periodSummary: { flex: 1, textAlign: 'right', fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.textMuted },
  weekCol: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 3, borderRadius: 13, borderWidth: 1, borderColor: 'transparent' },
  weekColActive: { backgroundColor: '#fff', borderColor: C.text, borderWidth: 1.5 },
  weekColDow: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: C.textMuted },
  weekColDate: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },
  weekColTrack: { position: 'relative', width: '100%', height: 260, marginTop: 4, borderRadius: 6, backgroundColor: C.track },
  weekColFoot: { fontFamily: 'Barlow_600SemiBold', fontSize: 10.5, color: '#B8AF9E', marginTop: 2 },
  statsCard: { marginTop: 14, padding: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, flexDirection: 'row', alignItems: 'center' },
  statValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 24, color: C.text },
  statLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 11.5, color: C.textMuted, marginTop: 1 },
  statDivider: { width: 1, height: 38, backgroundColor: C.border },
  legendChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 999 },
  legendText: { fontFamily: 'Barlow_600SemiBold', fontSize: 11.5, color: C.textMuted2 },
  dayPill: { width: 46, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 1, borderColor: C.border, borderRadius: 13, backgroundColor: '#fff' },
  dayPillActive: { backgroundColor: C.primary, borderWidth: 0 },
  dayPillDow: { fontFamily: 'Barlow_700Bold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: C.textMuted },
  dayPillDate: { fontFamily: 'Archivo_700Bold', fontSize: 16, color: C.text },
  gapSlot: { position: 'absolute', left: 38, right: 0, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.gapDash, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.4)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13 },
  gapMeta: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#A69C8B' },
  gapCta: { fontFamily: 'Barlow_700Bold', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: C.accent },
  lessonBlock: { position: 'absolute', left: 38, right: 0, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 13, shadowColor: '#0F172A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  lessonBlockName: { fontFamily: 'Barlow_700Bold', fontSize: 14.5, color: '#fff' },
  lessonBlockMeta: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: 'rgba(255,255,255,0.78)' },
  lessonBlockTag: { fontFamily: 'Barlow_700Bold', fontSize: 11, letterSpacing: 1, color: 'rgba(255,255,255,0.85)' },
  fab: { position: 'absolute', right: 20, bottom: 96, height: 52, paddingHorizontal: 20, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', shadowColor: C.accent, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 8 },
  fabText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: '#fff' },
});
