import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useLessonsForWeek, useLessonsForMonth, useStudents } from '../src/useSupabaseData';
import { BottomNav } from '../src/BottomNav';
import { LessonToolsSheet } from '../src/LessonToolsSheet';
import { Lesson } from '../src/mockDb';
import { startOfWeek, addDays, localDateKey, startOfMonthGrid, endOfMonthGrid, addMonths, isSameMonth, assignOverlapColumns } from '../src/diary/dateUtils';
import { colorForLessonType, LESSON_TYPES } from '../src/diary/lessonTypes';
import { AddLessonSheet } from '../src/diary/AddLessonSheet';

/**
 * Lesson Diary — redesigned visual direction from the Claude Design
 * handoff (23 Aug 2026), promoted to live on 24 Aug 2026 after review as
 * lesson-diary-v2-screen. This is now the real, live diary screen.
 * Real data throughout (useLessonsForWeek, useLessonsForMonth, useStudents)
 * — the design file's own hardcoded seed data was reference only, never
 * used here.
 *
 * Visual language: "road-signage blocks on warm paper" — Archivo for
 * numerals/headlines, Barlow for everything else, warm paper background
 * instead of the previous cool blue/white. Lesson-type colors are
 * unchanged — they already matched lessonTypes.ts verbatim in the design.
 *
 * Month view was ported in as part of promoting this to live (24 Aug
 * 2026) — the original v2 trial only covered Day/Week, since Month view
 * was added to the old screen later in the same session, after the trial
 * had already been built. The design itself never included a month grid,
 * so this uses the same underlying logic as the old screen's Month view
 * (startOfMonthGrid/endOfMonthGrid, a 42-day fixed grid) with the new
 * visual treatment applied, plus new prev/next month controls — this
 * design has no arrow-based navigation elsewhere (Day/Week rely on
 * tapping day-pills within the current week), so Month needed its own
 * navigation added, not just its own grid.
 *
 * The lesson-tap interaction reuses the existing, already-working
 * LessonToolsSheet rather than a rebuilt bottom sheet — carried over
 * from the trial as a deliberate choice, not a shortcut.
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
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });
  const [detailLesson, setDetailLesson] = useState<Lesson | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Clash-warning snackbar (25 Aug 2026) — surfaces the clash info
  // AddLessonSheet has always computed and passed via onCreated, but which
  // nothing was actually doing anything with. Found via Grant's screen
  // recording: overlapping lessons currently render on top of each other
  // in Day view with zero warning that a clash even happened.
  const [clashSnack, setClashSnack] = useState<{ name: string; start: string; end: string } | null>(null);
  useEffect(() => {
    if (!clashSnack) return;
    const t = setTimeout(() => setClashSnack(null), 6000);
    return () => clearTimeout(t);
  }, [clashSnack]);

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const { lessons } = useLessonsForWeek(weekStart);
  const monthGridStart = useMemo(() => startOfMonthGrid(selectedDate), [selectedDate]);
  const monthGridEnd = useMemo(() => endOfMonthGrid(selectedDate), [selectedDate]);
  const { lessons: monthLessons } = useLessonsForMonth(monthGridStart, monthGridEnd);
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

  // Column assignment for overlapping lessons (25 Aug 2026) — found via a
  // real screen recording: two lessons at the identical time slot were
  // rendering directly on top of each other, with the later one completely
  // hiding the first. See assignOverlapColumns in dateUtils.ts for the
  // actual algorithm and its test coverage.
  const dayColumns = useMemo(
    () => assignOverlapColumns(dayList.map((l) => ({ id: l.id, startMin: toMinutesOfDay(l.start_time), endMin: toMinutesOfDay(l.end_time) }))),
    [dayList],
  );

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
                : viewMode === 'month'
                  ? selectedDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
                  : `${weekStart.getDate()} ${weekStart.toLocaleDateString('en-GB', { month: 'short' })} – ${addDays(weekStart, 6).getDate()} ${addDays(weekStart, 6).toLocaleDateString('en-GB', { month: 'short' })}`}
            </Text>
          </View>
          {viewMode === 'month' && (
            <View style={{ flexDirection: 'row', gap: 6, marginRight: 8 }}>
              <TouchableOpacity style={s.navBtn} onPress={() => setSelectedDate(addMonths(selectedDate, -1))} testID="v2-month-prev">
                <ChevronLeft size={17} color={C.text} />
              </TouchableOpacity>
              <TouchableOpacity style={s.navBtn} onPress={() => setSelectedDate(addMonths(selectedDate, 1))} testID="v2-month-next">
                <ChevronRight size={17} color={C.text} />
              </TouchableOpacity>
            </View>
          )}
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
            <TouchableOpacity style={[s.toggleTab, viewMode === 'month' && s.toggleTabActive]} onPress={() => setViewMode('month')} testID="v2-view-month">
              <Text style={[s.toggleText, viewMode === 'month' && s.toggleTextActive]}>Month</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.periodSummary} numberOfLines={1}>
            {viewMode === 'week'
              ? `${durLabel(weekMinutes)} booked`
              : viewMode === 'month'
                ? `${monthLessons.length} lesson${monthLessons.length === 1 ? '' : 's'}`
                : dayList.length ? `${dayList.length} lessons · ${durLabel(totalMinutesFor(selectedDayIdx))}` : 'Nothing booked'}
          </Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
          {viewMode === 'month' ? (
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                {DOW.map((d) => (
                  <View key={d} style={{ flex: 1, alignItems: 'center', paddingVertical: 6 }}>
                    <Text style={s.monthHeaderText}>{d}</Text>
                  </View>
                ))}
              </View>
              {Array.from({ length: 6 }).map((_, row) => (
                <View key={row} style={{ flexDirection: 'row', minHeight: 78 }}>
                  {Array.from({ length: 7 }).map((__, col) => {
                    const cellDate = addDays(monthGridStart, row * 7 + col);
                    const cellKey = localDateKey(cellDate);
                    const inCurrentMonth = isSameMonth(cellDate, selectedDate);
                    const isToday = cellKey === todayKey;
                    const dayLessons = monthLessons.filter((l) => l.date === cellKey);
                    const visibleLessons = dayLessons.slice(0, 3);
                    const overflowCount = dayLessons.length - visibleLessons.length;
                    return (
                      <TouchableOpacity
                        key={cellKey}
                        style={s.monthCell}
                        onPress={() => { setSelectedDate(cellDate); setViewMode('day'); }}
                        testID={`v2-month-cell-${cellKey}`}
                      >
                        <View style={[s.monthDateBadge, isToday && s.monthDateBadgeToday]}>
                          <Text style={[s.monthDateText, !inCurrentMonth && s.monthDateTextDim, isToday && s.monthDateTextToday]}>
                            {cellDate.getDate()}
                          </Text>
                        </View>
                        <View style={{ marginTop: 3, gap: 2 }}>
                          {visibleLessons.map((l) => (
                            <View key={l.id} style={[s.monthLessonChip, { backgroundColor: colorForLessonType(l.lesson_type) + '33' }]}>
                              <Text style={s.monthLessonChipText} numberOfLines={1}>{l.start_time} {l.topic || l.lesson_type}</Text>
                            </View>
                          ))}
                          {overflowCount > 0 && <Text style={s.monthMoreText}>+{overflowCount} more</Text>}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          ) : viewMode === 'week' ? (
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
                      const colInfo = dayColumns[l.id] || { column: 0, totalColumns: 1 };
                      const colWidthPct = 100 / colInfo.totalColumns;
                      items.push(
                        // Outer wrapper matches the original single-lesson
                        // positioning exactly (left: 38 for the hour-label
                        // gutter, right: 0) — the inner block's percentage
                        // left/width are relative to THIS wrapper, not the
                        // full screen width, so the 38px gutter is still
                        // respected even when a lesson is split into
                        // columns for an overlap.
                        <View key={l.id} style={{ position: 'absolute', top, height, left: 38, right: 0 }}>
                          <TouchableOpacity
                            style={[
                              s.lessonBlock,
                              {
                                position: 'absolute', top: 0, height: '100%',
                                left: `${colInfo.column * colWidthPct}%`,
                                width: colInfo.totalColumns > 1 ? `${colWidthPct}%` : '100%',
                                marginHorizontal: colInfo.totalColumns > 1 ? 2 : 0,
                                right: undefined,
                                backgroundColor: colorForLessonType(l.lesson_type),
                              },
                            ]}
                            onPress={() => setDetailLesson(l)}
                            testID={`v2-lesson-${l.id}`}
                          >
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={s.lessonBlockName} numberOfLines={1}>{studentName(l.student_id)}</Text>
                              <Text style={s.lessonBlockMeta} numberOfLines={1}>{hhmm(sMin)}–{hhmm(eMin)} · {l.topic || l.lesson_type}</Text>
                            </View>
                            {colInfo.totalColumns === 1 && <Text style={s.lessonBlockTag}>{durLabel(eMin - sMin)}</Text>}
                          </TouchableOpacity>
                        </View>,
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
        onCreated={(info) => {
          setAddOpen(false);
          setSelectedDate(new Date(selectedDate));
          if (info.clash) setClashSnack(info.clash);
        }}
      />

      {clashSnack && (
        <View style={s.clashSnack} testID="clash-snack">
          <Text style={s.clashSnackText}>
            Saved, but this overlaps {clashSnack.name}'s lesson ({clashSnack.start}–{clashSnack.end}).
          </Text>
          <TouchableOpacity onPress={() => setClashSnack(null)} testID="clash-snack-dismiss">
            <Text style={s.clashSnackDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}
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

  monthHeaderText: { fontFamily: 'Barlow_700Bold', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: C.textMuted },
  monthCell: { flex: 1, borderWidth: 0.5, borderColor: C.border, padding: 4, alignItems: 'stretch' },
  monthDateBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  monthDateBadgeToday: { backgroundColor: C.primary },
  monthDateText: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: C.text },
  monthDateTextDim: { color: C.gapDash },
  monthDateTextToday: { color: '#fff' },
  monthLessonChip: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  monthLessonChipText: { fontFamily: 'Barlow_500Medium', fontSize: 10, color: C.text },
  monthMoreText: { fontFamily: 'Barlow_700Bold', fontSize: 10, color: C.textMuted },

  clashSnack: {
    position: 'absolute', left: 20, right: 20, bottom: 28, backgroundColor: '#0F172A',
    borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  clashSnackText: { flex: 1, fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: '#fff' },
  clashSnackDismiss: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: C.accent },
});
