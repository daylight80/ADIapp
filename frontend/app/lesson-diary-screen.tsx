import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Plus, ArrowLeft, AlertTriangle, Car, Calendar, CalendarDays } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb, Lesson } from '../src/mockDb';
import { useLessonsForWeek, useStudents, createLesson } from '../src/useSupabaseData';
import { Card, Badge } from '../src/ui';
import { DateField, TimeField } from '../src/DateTimeFields';
import { BottomSheet } from '../src/BottomSheet';
import { BottomNav } from '../src/BottomNav';
import { useAuth } from '../src/AuthContext';
import { isPro } from '../src/proPlan';
import { scheduleLessonReminders } from '../src/notifications';
import { LessonToolsSheet } from '../src/LessonToolsSheet';
import { getTravelTime, addressForStudent, lessonAddress, minutesBetween, formatEta } from '../src/maps';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TOP_HOUR = 5;
const BOTTOM_HOUR = 22;
const HOURS = Array.from({ length: BOTTOM_HOUR - TOP_HOUR + 1 }, (_, i) => i + TOP_HOUR); // 05:00 - 22:00
const HOUR_HEIGHT = 64;
const TOTAL_HEIGHT = (BOTTOM_HOUR - TOP_HOUR) * HOUR_HEIGHT;

function startOfWeek(d: Date): Date {
  const c = new Date(d);
  const day = c.getDay();
  const diff = (day + 6) % 7; // make Monday=0
  c.setDate(c.getDate() - diff);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function formatDateRange(start: Date): string {
  const end = addDays(start, 6);
  const m = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${m(start)} - ${m(end)}`;
}

export default function LessonDiaryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pro = isPro(user?.subscription_status);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [selectedDate, setSelectedDate] = useState<Date>(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const [addOpen, setAddOpen] = useState(false);
  const [detailLesson, setDetailLesson] = useState<Lesson | null>(null);

  // Form state
  const [studentId, setStudentId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [topic, setTopic] = useState('');
  const [travelMinutes, setTravelMinutes] = useState('15');

  // ScrollView ref so we can auto-jump the diary to a newly-added lesson's
  // start-time (otherwise lessons after midday fall below the scroll fold).
  const scrollRef = useRef<ScrollView | null>(null);

  // Scroll the diary so the given HH:mm time lands ~80px from the top.
  const scrollToTime = (hhmm: string) => {
    if (!scrollRef.current) return;
    const [hh, mm] = hhmm.split(':').map(Number);
    const offset = Math.max(0, ((hh - TOP_HOUR) + mm / 60) * HOUR_HEIGHT - 80);
    // Fire on next tick so the lesson block has been laid out first.
    setTimeout(() => scrollRef.current?.scrollTo({ y: offset, animated: true }), 100);
  };

  const { lessons } = useLessonsForWeek(weekStart);
  const { students } = useStudents();

  // Lookup helper (mockDb shape used by callers)
  const getStudent = (id: string) => students.find((s) => s.id === id);

  // Travel-time auto-suggest when a student is picked for a new lesson
  const [travelInfo, setTravelInfo] = useState<string | null>(null);
  useEffect(() => {
    if (!addOpen || !studentId || !date) return;
    const newStudent = getStudent(studentId);
    if (!newStudent) return;
    // Find most recent lesson on this date before the new one
    const todays = lessons
      .filter((l) => l.date === date && l.status !== 'Cancelled')
      .sort((a, b) => a.end_time.localeCompare(b.end_time));
    const prior = todays.filter((l) => l.end_time <= startTime).pop();
    const newDest = lessonAddress(
      { pickup_address: '', student_id: newStudent.id } as any,
      newStudent
    );
    const origin = prior
      ? lessonAddress(prior, getStudent(prior.student_id))
      : null;
    if (!origin || !newDest) {
      setTravelInfo(null);
      return;
    }
    let cancelled = false;
    getTravelTime(origin, newDest, new Date(`${date}T${startTime}:00`)).then((t) => {
      if (cancelled || !t) return;
      setTravelMinutes(String(t.duration_in_traffic_minutes));
      setTravelInfo(`Predicted ${t.duration_in_traffic_minutes}m via traffic · ${t.distance_km}km · from previous lesson${t.status === 'fallback' ? ' (estimate)' : ''}`);
    });
    return () => { cancelled = true; };
  }, [addOpen, studentId, date, startTime, lessons]);

  // On mount, if we're viewing today, scroll to roughly the current hour.
  useEffect(() => {
    const today = new Date();
    if (selectedDate.toDateString() === today.toDateString()) {
      const h = today.getHours();
      const m = today.getMinutes();
      const hhmm = `${String(Math.max(h, TOP_HOUR)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      // Wait for layout — the lessons need to be rendered first.
      setTimeout(() => scrollToTime(hhmm), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goPrev = () => setSelectedDate(addDays(selectedDate, viewMode === 'day' ? -1 : -7));
  const goNext = () => setSelectedDate(addDays(selectedDate, viewMode === 'day' ? 1 : 7));
  const goToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setSelectedDate(d); };
  const navLabel = viewMode === 'day'
    ? selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
    : formatDateRange(weekStart);
  const selectedKey = selectedDate.toISOString().slice(0, 10);
  const todayKey = new Date().toISOString().slice(0, 10);

  const computePos = (l: Lesson) => {
    const [sh, sm] = l.start_time.split(':').map(Number);
    const top = ((sh - TOP_HOUR) + sm / 60) * HOUR_HEIGHT;
    const height = Math.max(28, l.duration_hours * HOUR_HEIGHT - 2);
    return { top, height };
  };

  const prevLessonFor = (l: Lesson) => lessons
    .filter((x) => x.date === l.date && x.end_time <= l.start_time && x.id !== l.id && x.status !== 'Cancelled')
    .sort((a, b) => a.end_time.localeCompare(b.end_time))
    .pop();

  const handleAdd = async () => {
    if (!studentId || !date || !topic) return;
    try {
      const newLesson = await createLesson({
        student_id: studentId,
        date,
        start_time: startTime,
        end_time: endTime,
        travel_minutes: parseInt(travelMinutes, 10) || 0,
        topic,
        amount_paid: undefined,
      });
      setStudentId('');
      setDate('');
      setTopic('');
      setAddOpen(false);
      // Auto-scroll the diary so the new lesson is visible without scrolling.
      scrollToTime(startTime);
      // Also flip the diary's selected day to the lesson's date if different.
      if (newLesson && date) {
        const lessonDate = new Date(`${date}T00:00:00`);
        if (lessonDate.toDateString() !== selectedDate.toDateString()) {
          setSelectedDate(lessonDate);
        }
      }

      // Pro: schedule 24h and 1h reminders
      if (pro) {
        const student = getStudent(studentId);
        if (student) scheduleLessonReminders(newLesson as any, student as any).catch(() => {});
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[diary] addLesson failed', e);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="btn-back" style={styles.iconBtn}>
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Lesson Diary</Text>
        <TouchableOpacity onPress={() => setAddOpen(true)} testID="btn-add-lesson" style={styles.iconBtn}>
          <Plus size={22} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'day' && styles.toggleBtnActive]}
          onPress={() => setViewMode('day')}
          testID="view-day"
        >
          <Calendar size={14} color={viewMode === 'day' ? '#fff' : theme.colors.primary} />
          <Text style={[styles.toggleText, viewMode === 'day' && styles.toggleTextActive]}>Day</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'week' && styles.toggleBtnActive]}
          onPress={() => setViewMode('week')}
          testID="view-week"
        >
          <CalendarDays size={14} color={viewMode === 'week' ? '#fff' : theme.colors.primary} />
          <Text style={[styles.toggleText, viewMode === 'week' && styles.toggleTextActive]}>Week</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.weekNav} testID="week-nav">
        <TouchableOpacity onPress={goPrev} style={styles.weekArrow} testID="week-prev">
          <ChevronLeft size={20} color={theme.colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={goToday} testID="btn-today" style={{ alignItems: 'center' }}>
          <Text style={styles.weekLabel}>{navLabel}</Text>
          {selectedKey !== todayKey && <Text style={styles.todayHint}>Tap to jump to today</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={goNext} style={styles.weekArrow} testID="week-next">
          <ChevronRight size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        {viewMode === 'day' ? (
          <View style={styles.dayGrid} testID="day-grid">
            <View style={styles.dayGridHeader}>
              <View style={{ width: TIME_W }} />
              <View style={styles.dayHeaderCol}>
                <Text style={styles.dayName}>{selectedDate.toLocaleDateString('en-GB', { weekday: 'short' })}</Text>
                <Text style={styles.dayNum}>{selectedDate.getDate()}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ width: TIME_W }}>
                {HOURS.slice(0, -1).map((h) => (
                  <View key={h} style={styles.hourLabelCell}>
                    <Text style={styles.timeText}>{`${h.toString().padStart(2, '0')}:00`}</Text>
                  </View>
                ))}
              </View>
              <View style={[styles.dayLessonCol, { height: TOTAL_HEIGHT }]}>
                <View style={StyleSheet.absoluteFill}>
                  {HOURS.slice(0, -1).map((h) => (
                    <View key={h} style={styles.hourSlot} />
                  ))}
                </View>
                {lessons
                  .filter((l) => l.date === selectedKey && l.status !== 'Cancelled')
                  .map((l) => {
                    const s = getStudent(l.student_id);
                    const { top, height } = computePos(l);
                    const prev = prevLessonFor(l);
                    const gapMin = prev ? minutesBetween(prev.end_time, prev.date, l.start_time, l.date) : null;
                    const needed = l.travel_minutes ?? prev?.travel_minutes ?? 0;
                    const tooTight = gapMin !== null && gapMin < needed;
                    return (
                      <TouchableOpacity
                        key={l.id}
                        style={[styles.lessonBlockDay, tooTight && styles.lessonBlockWarn, { top, height }]}
                        onPress={() => setDetailLesson(l)}
                        testID={`lesson-block-${l.id}`}
                      >
                        <Text style={styles.lessonBlockTimeBig}>
                          {l.start_time}–{l.end_time}
                        </Text>
                        <Text style={styles.lessonBlockNameFull} numberOfLines={2}>
                          {s?.name || 'Student'}
                        </Text>
                        {height >= HOUR_HEIGHT * 1.2 && (
                          <Text style={styles.lessonBlockTopic} numberOfLines={1}>
                            {l.topic}
                          </Text>
                        )}
                        {tooTight && (
                          <View style={styles.warnDot} testID={`gap-warn-${l.id}`}>
                            <AlertTriangle size={10} color="#fff" />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
              </View>
            </View>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.grid} testID="weekly-grid">
              {/* Header row */}
              <View style={styles.gridRow}>
                <View style={[{ width: TIME_W }, styles.headerCell]} />
                {DAYS.map((d, i) => {
                  const date = addDays(weekStart, i);
                  return (
                    <View key={d} style={[styles.dayHeaderCellWeek, styles.headerCell]}>
                      <Text style={styles.dayName}>{d}</Text>
                      <Text style={styles.dayNum}>{date.getDate()}</Text>
                    </View>
                  );
                })}
              </View>
              {/* Body row: hour labels + 7 day columns with absolute-positioned lessons */}
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: TIME_W }}>
                  {HOURS.slice(0, -1).map((h) => (
                    <View key={h} style={styles.hourLabelCell}>
                      <Text style={styles.timeText}>{`${h.toString().padStart(2, '0')}:00`}</Text>
                    </View>
                  ))}
                </View>
                {DAYS.map((_, di) => {
                  const cellDate = addDays(weekStart, di).toISOString().slice(0, 10);
                  const dayLessons = lessons.filter((l) => l.date === cellDate && l.status !== 'Cancelled');
                  return (
                    <View key={di} style={[styles.weekDayCol, { height: TOTAL_HEIGHT }]}>
                      <View style={StyleSheet.absoluteFill}>
                        {HOURS.slice(0, -1).map((h) => (
                          <View key={h} style={styles.hourSlot} />
                        ))}
                      </View>
                      {dayLessons.map((l) => {
                        const s = getStudent(l.student_id);
                        const { top, height } = computePos(l);
                        const prev = prevLessonFor(l);
                        const gapMin = prev ? minutesBetween(prev.end_time, prev.date, l.start_time, l.date) : null;
                        const needed = l.travel_minutes ?? prev?.travel_minutes ?? 0;
                        const tooTight = gapMin !== null && gapMin < needed;
                        return (
                          <TouchableOpacity
                            key={l.id}
                            style={[styles.lessonBlockWeek, tooTight && styles.lessonBlockWarn, { top, height }]}
                            onPress={() => setDetailLesson(l)}
                            testID={`lesson-block-${l.id}`}
                          >
                            <Text style={styles.lessonBlockTime}>
                              {l.start_time}–{l.end_time}
                            </Text>
                            <Text style={styles.lessonBlockNameWeek} numberOfLines={2}>
                              {s?.name || 'Student'}
                            </Text>
                            {tooTight && (
                              <View style={styles.warnDot} testID={`gap-warn-${l.id}`}>
                                <AlertTriangle size={10} color="#fff" />
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        )}
      </ScrollView>

      <BottomNav role="instructor" />

      {/* Add Lesson Sheet */}
      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add Lesson" testID="sheet-add-lesson">
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

        <TouchableOpacity style={styles.submitBtn} onPress={handleAdd} testID="btn-submit-lesson">
          <Text style={styles.submitBtnText}>Save Lesson</Text>
        </TouchableOpacity>
      </BottomSheet>

      {/* Lesson Tools Sheet */}
      <LessonToolsSheet
        visible={!!detailLesson}
        onClose={() => setDetailLesson(null)}
        lesson={detailLesson}
        onChanged={() => setSelectedDate(new Date(selectedDate))}
      />
    </SafeAreaView>
  );
}

function FaultBadge({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <View style={[styles.faultCard, { borderColor: colour }]}>
      <Text style={[styles.faultValue, { color: colour }]}>{value}</Text>
      <Text style={styles.faultLabel}>{label}</Text>
    </View>
  );
}

const CELL_W = 100;
const TIME_W = 50;
const CELL_H = 60;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8 },
  title: { ...theme.font.h2 },
  toggleRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: 4 },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface,
  },
  toggleBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  toggleText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },
  toggleTextActive: { color: '#fff' },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 8 },
  weekArrow: { padding: 8, borderRadius: 8, backgroundColor: theme.colors.primaryLight },
  weekLabel: { ...theme.font.h3 },
  todayHint: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  scroll: { paddingHorizontal: 12, paddingBottom: 96 },
  grid: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  gridRow: { flexDirection: 'row' },
  headerCell: { backgroundColor: theme.colors.primaryLight, borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingVertical: 8 },
  hourLabelCell: {
    height: HOUR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  timeText: { fontSize: 11, color: theme.colors.textMuted, fontWeight: '500' },
  hourSlot: {
    height: HOUR_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  // ---------- Day view ----------
  dayGrid: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  dayGridHeader: { flexDirection: 'row', backgroundColor: theme.colors.primaryLight, borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingVertical: 10 },
  dayHeaderCol: { flex: 1, alignItems: 'center' },
  dayLessonCol: { flex: 1, position: 'relative' },
  lessonBlockDay: {
    position: 'absolute',
    left: 4,
    right: 4,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: 'hidden',
    // Keep lesson blocks above the hour grid lines so taps always land on them.
    zIndex: 2,
    elevation: 2,
  },
  lessonBlockTimeBig: { color: '#fff', fontSize: 13, fontWeight: '700' },
  lessonBlockNameFull: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 2 },
  lessonBlockTopic: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  // ---------- Week view ----------
  dayHeaderCellWeek: {
    width: CELL_W,
    alignItems: 'center',
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  weekDayCol: {
    width: CELL_W,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    position: 'relative',
  },
  lessonBlockWeek: {
    position: 'absolute',
    left: 2,
    right: 2,
    backgroundColor: theme.colors.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  lessonBlockNameWeek: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 2 },
  lessonBlockWarn: { backgroundColor: theme.colors.faultDriving },
  warnDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.faultSerious,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayName: { fontWeight: '600', color: theme.colors.text, fontSize: 12 },
  dayNum: { fontSize: 16, fontWeight: '700', color: theme.colors.primary },
  // ---------- Shared / Form ----------
  travelInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: -6,
    marginBottom: 12,
  },
  travelInfoText: { color: theme.colors.primary, fontSize: 12, fontWeight: '600', flex: 1 },
  lessonBlockTime: { color: '#fff', fontSize: 10, fontWeight: '600' },
  label: { ...theme.font.caption, fontWeight: '600', marginBottom: 6, color: theme.colors.text },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 12,
    backgroundColor: theme.colors.background,
  },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.border, marginRight: 8 },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 14, color: theme.colors.text },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  submitBtn: { backgroundColor: theme.colors.primary, height: 52, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  detailName: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  detailTopic: { fontSize: 15, color: theme.colors.textMuted },
  notes: { fontSize: 14, color: theme.colors.text, lineHeight: 20 },
  faultsRow: { flexDirection: 'row', gap: 10 },
  faultCard: { flex: 1, borderRadius: 12, borderWidth: 2, padding: 12, alignItems: 'center' },
  faultValue: { fontSize: 22, fontWeight: '700' },
  faultLabel: { fontSize: 12, color: theme.colors.textMuted },
});
