import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Pressable, StyleSheet, useWindowDimensions, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ChevronLeft, ChevronRight, Plus, ArrowLeft, AlertTriangle,
  Calendar, CalendarDays, Ban, Navigation as NavIcon, Route as RouteIcon,
  PoundSterling, Trophy,
} from 'lucide-react-native';
import { theme } from '../src/theme';
import { Lesson } from '../src/mockDb';
import {
  useLessonsForWeek, useStudents, useInstructorProfile, useAvailabilityBlocks,
  patchLesson,
} from '../src/useSupabaseData';
import { type AvailabilityBlock } from '../src/supabaseDb';
import { BottomNav } from '../src/BottomNav';
import { useAuth } from '../src/AuthContext';
import { isPaidTier } from '../src/tiers';
import { LessonToolsSheet } from '../src/LessonToolsSheet';
import { UnavailabilityModal } from '../src/UnavailabilityModal';
import { minutesBetween } from '../src/maps';
import { openNavigation } from '../src/tools';

// Diary-specific extractions
import {
  DAYS, TOP_HOUR, BOTTOM_HOUR, HOURS, HOUR_HEIGHT, TOTAL_HEIGHT, TIME_W, CELL_W,
} from '../src/diary/constants';
import { startOfWeek, addDays, formatDateRange, localDateKey, toMin, minutesToTime, snapMinutes } from '../src/diary/dateUtils';
import { styles } from '../src/diary/diaryStyles';
import { AddLessonSheet } from '../src/diary/AddLessonSheet';
import { DraggableLessonBlock } from '../src/diary/DraggableLessonBlock';

export default function LessonDiaryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pro = isPaidTier(user?.tier);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });

  // On a real phone, this always resolves to CELL_W (the computed available
  // space is smaller than that), so mobile keeps its existing horizontal-
  // scroll behavior exactly as before. On a wide desktop browser, columns
  // grow to fill the window instead of leaving dead space on the right —
  // capped at 200px so they don't stretch absurdly wide on an ultrawide
  // monitor.
  const { width: winWidth } = useWindowDimensions();
  const weekColWidth = useMemo(() => {
    const available = winWidth - TIME_W - 32; // minus time gutter + screen padding
    return Math.min(200, Math.max(CELL_W, Math.floor(available / 7)));
  }, [winWidth]);
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const [addOpen, setAddOpen] = useState(false);
  const [detailLesson, setDetailLesson] = useState<Lesson | null>(null);

  // Instructor's preferred navigation app — drives the one-tap 🧭 button.
  const { profile: instructorProfile } = useInstructorProfile();
  const preferredNav = (instructorProfile?.preferred_nav_app || 'google') as 'google' | 'waze' | 'apple';

  // ScrollView ref — used to jump the diary to a newly-added lesson's start
  // time so it's always visible after a save.
  const scrollRef = useRef<ScrollView | null>(null);

  /** Scroll the diary so the given HH:mm time lands ~80px from the top. */
  const scrollToTime = (hhmm: string) => {
    if (!scrollRef.current) return;
    const [hh, mm] = hhmm.split(':').map(Number);
    const offset = Math.max(0, ((hh - TOP_HOUR) + mm / 60) * HOUR_HEIGHT - 80);
    setTimeout(() => scrollRef.current?.scrollTo({ y: offset, animated: true }), 100);
  };

  const { lessons } = useLessonsForWeek(weekStart);
  const { students } = useStudents();

  // Availability blocks for the visible window (week start → +7 days).
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const { blocks: availBlocks } = useAvailabilityBlocks(weekStart, weekEnd);

  // Unavailability modal state.
  const [unavailOpen, setUnavailOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<AvailabilityBlock | null>(null);
  const openUnavailNew = () => { setEditingBlock(null); setUnavailOpen(true); };
  const openUnavailEdit = (b: AvailabilityBlock) => { setEditingBlock(b); setUnavailOpen(true); };

  /**
   * Project an availability block into the diary's pixel coordinates for a
   * given visible date. Returns null when the block doesn't intersect that day.
   */
  const projectBlock = (b: AvailabilityBlock, dateKey: string): { top: number; height: number; isAllDayBand: boolean } | null => {
    const dayStart = new Date(`${dateKey}T00:00:00`);
    const dayEnd = new Date(`${dateKey}T23:59:59`);
    const bStart = new Date(b.starts_at);
    const bEnd = new Date(b.ends_at);
    if (bEnd <= dayStart || bStart >= dayEnd) return null;
    const visStart = bStart > dayStart ? bStart : dayStart;
    const visEnd = bEnd < dayEnd ? bEnd : dayEnd;
    const startMin = visStart.getHours() * 60 + visStart.getMinutes();
    const endMin = visEnd.getHours() * 60 + visEnd.getMinutes() || 24 * 60;
    const topHr = Math.max(startMin / 60, TOP_HOUR);
    const botHr = Math.min(endMin / 60, BOTTOM_HOUR + 1);
    if (botHr <= topHr) return null;
    const top = (topHr - TOP_HOUR) * HOUR_HEIGHT;
    const height = Math.max(20, (botHr - topHr) * HOUR_HEIGHT - 2);
    return { top, height, isAllDayBand: !!b.all_day };
  };

  const getStudent = (id: string) => students.find((s) => s.id === id);

  // Visual indicators on the diary grid: a lesson is "paid" if it has any
  // amount recorded against it, and a "test day" lesson if it falls on the
  // same calendar date as that student's booked test_date (students table,
  // Migration 002) — a lesson isn't itself flagged as a test, so this is
  // the only signal available to spot test-day lessons on the grid.
  const isLessonPaid = (l: Lesson) => (l.amount_paid ?? 0) > 0;
  const isLessonTestDay = (l: Lesson, s: ReturnType<typeof getStudent>) =>
    !!s?.test_date && s.test_date.slice(0, 10) === l.date;

  // Icon-only toolbar buttons have no visible label — fine on mobile where
  // nothing hovers, but on desktop web a native tooltip on hover is a
  // near-free usability win. Native mobile ignores an unknown `title` prop.
  const webTitle = (text: string) => (Platform.OS === 'web' ? { title: text } : {});

  // Scroll to roughly the current hour whenever today is actually visible in
  // the current view — on mount, and again if the user toggles Day/Week.
  // (Deliberately NOT re-triggered by selectedDate changes from Prev/Next —
  // that would yank the scroll position out from under someone browsing.)
  useEffect(() => {
    const today = new Date();
    const isTodayVisible = viewMode === 'day'
      ? selectedDate.toDateString() === today.toDateString()
      : today >= weekStart && today < weekEnd;
    if (isTodayVisible) {
      const h = today.getHours();
      const m = today.getMinutes();
      const hhmm = `${String(Math.max(h, TOP_HOUR)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      setTimeout(() => scrollToTime(hhmm), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const goPrev = () => setSelectedDate(addDays(selectedDate, viewMode === 'day' ? -1 : -7));
  const goNext = () => setSelectedDate(addDays(selectedDate, viewMode === 'day' ? 1 : 7));
  const goToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setSelectedDate(d); };
  const navLabel = viewMode === 'day'
    ? selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
    : formatDateRange(weekStart);
  const selectedKey = localDateKey(selectedDate);
  const todayKey = localDateKey(new Date());

  const computePos = (l: Lesson) => {
    const [sh, sm] = l.start_time.split(':').map(Number);
    const top = ((sh - TOP_HOUR) + sm / 60) * HOUR_HEIGHT;
    const height = Math.max(28, l.duration_hours * HOUR_HEIGHT - 2);
    return { top, height };
  };

  // ---------------------------------------------------------------------------
  // Drag-and-drop rescheduling. Both ScrollViews (the outer vertical one via
  // `scrollRef`, and the horizontal week one) are disabled for the duration
  // of a drag so gesture-handler has exclusive control of the touch — without
  // this, dragging vertically fights the vertical scroll, and horizontally
  // in week view fights the horizontal scroll.
  // ---------------------------------------------------------------------------
  const [dragScrollLocked, setDragScrollLocked] = useState(false);

  const workingDayMinutes = (BOTTOM_HOUR - TOP_HOUR) * 60;

  /**
   * Converts a drag's raw pixel translation into a candidate new date/time,
   * checks it against working hours and existing lessons for a collision,
   * and — if clear — persists it. Returns whether the drop was accepted;
   * the DraggableLessonBlock uses this to decide whether to spring back.
   */
  const handleLessonDrop = async (l: Lesson, translationX: number, translationY: number): Promise<boolean> => {
    const deltaMinutes = snapMinutes((translationY / HOUR_HEIGHT) * 60);
    const durationMinutes = Math.round(l.duration_hours * 60);
    const currentStartMin = toMin(l.start_time);
    const newStartMin = currentStartMin + deltaMinutes;

    if (newStartMin < 0 || newStartMin + durationMinutes > workingDayMinutes) {
      Alert.alert('Outside diary hours', `That would put the lesson outside the ${TOP_HOUR}:00–${BOTTOM_HOUR}:00 diary window.`);
      return false;
    }

    // Day change only applies in week view — deltaDays stays 0 in day view
    // since DraggableLessonBlock is told allowDayChange=false there, which
    // already forces translationX to 0 before this function is even called.
    const deltaDays = weekColWidth > 0 ? Math.round(translationX / weekColWidth) : 0;
    const originalDate = new Date(`${l.date}T00:00:00`);
    const newDateObj = deltaDays !== 0 ? addDays(originalDate, deltaDays) : originalDate;
    const newDateKey = localDateKey(newDateObj);

    // Clamp to the currently visible week — dragging further than that
    // would move it somewhere the user can't currently see land, which is
    // more confusing than useful for a first version of this.
    const dayIndexInWeek = Math.round((newDateObj.getTime() - weekStart.getTime()) / 86400000);
    if (dayIndexInWeek < 0 || dayIndexInWeek > 6) {
      Alert.alert('Stay within the visible week', 'Scroll to next/previous week first, then drag within it.');
      return false;
    }

    const newStartTime = minutesToTime(newStartMin);
    const newEndTime = minutesToTime(newStartMin + durationMinutes);

    const collision = lessons.some((other) =>
      other.id !== l.id &&
      other.status !== 'Cancelled' &&
      other.date === newDateKey &&
      toMin(other.start_time) < newStartMin + durationMinutes &&
      toMin(other.end_time) > newStartMin
    );
    if (collision) {
      Alert.alert('Time slot taken', 'Another lesson already occupies that time — pick a different slot.');
      return false;
    }

    if (deltaMinutes === 0 && deltaDays === 0) {
      // Dropped back where it started (e.g. a long-press with no real
      // movement) — nothing to save, treat as accepted with no-op.
      return true;
    }

    try {
      await patchLesson(l.id, { date: newDateKey, start_time: newStartTime, end_time: newEndTime });
      return true;
    } catch (e: any) {
      Alert.alert('Could not reschedule', e?.message || 'Please try again.');
      return false;
    }
  };

  const prevLessonFor = (l: Lesson) => lessons
    .filter((x) => x.date === l.date && x.end_time <= l.start_time && x.id !== l.id && x.status !== 'Cancelled')
    .sort((a, b) => a.end_time.localeCompare(b.end_time))
    .pop();

  /** Called by the AddLessonSheet after a successful create. */
  const handleLessonCreated = (info: { firstDate: string; startTime: string; created: number; recurring: boolean }) => {
    const lessonDate = new Date(`${info.firstDate}T00:00:00`);
    if (lessonDate.toDateString() !== selectedDate.toDateString()) {
      setSelectedDate(lessonDate);
    }
    scrollToTime(info.startTime);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="btn-back" style={styles.iconBtn}>
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Lesson Diary</Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <TouchableOpacity
            onPress={() => router.push('/route-recorder-screen' as any)}
            testID="btn-route-recorder"
            style={styles.iconBtn}
            accessibilityLabel="Record lesson route"
            {...webTitle('Record lesson route')}
          >
            <RouteIcon size={22} color={theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={openUnavailNew}
            testID="btn-add-unavailability"
            style={styles.iconBtn}
            accessibilityLabel="Add unavailability"
            {...webTitle('Add unavailability')}
          >
            <Ban size={22} color={theme.colors.danger} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAddOpen(true)}
            testID="btn-add-lesson"
            style={styles.iconBtn}
            accessibilityLabel="Add lesson"
            {...webTitle('Add lesson')}
          >
            <Plus size={22} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
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

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} scrollEnabled={!dragScrollLocked}>
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
                <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
                  {HOURS.slice(0, -1).map((h) => (
                    <View key={h} style={styles.hourSlot} />
                  ))}
                </View>
                {/* Availability bands behind lessons */}
                {availBlocks.map((b) => {
                  const p = projectBlock(b, selectedKey);
                  if (!p) return null;
                  return (
                    <Pressable
                      key={`block-${b.id}`}
                      style={[styles.unavailBand, { top: p.top, height: p.height }]}
                      onPress={() => openUnavailEdit(b)}
                      testID={`unavail-band-${b.id}`}
                      accessibilityLabel={`Unavailable — ${b.category}${b.reason ? `: ${b.reason}` : ''}`}
                    >
                      <Text style={styles.unavailBandText} numberOfLines={2}>
                        🚫 {b.reason || b.category.charAt(0).toUpperCase() + b.category.slice(1)}
                      </Text>
                    </Pressable>
                  );
                })}
                {lessons
                  .filter((l) => l.date === selectedKey)
                  .map((l) => {
                    const s = getStudent(l.student_id);
                    const { top, height } = computePos(l);
                    const isCancelled = l.status === 'Cancelled';
                    const prev = isCancelled ? null : prevLessonFor(l);
                    const gapMin = prev ? minutesBetween(prev.end_time, prev.date, l.start_time, l.date) : null;
                    const needed = l.travel_minutes ?? prev?.travel_minutes ?? 0;
                    const tooTight = !isCancelled && gapMin !== null && gapMin < needed;
                    return (
                      <DraggableLessonBlock
                        key={l.id}
                        disabled={isCancelled}
                        allowDayChange={false}
                        resetKey={`${l.id}-${l.date}-${l.start_time}`}
                        onDragStart={() => setDragScrollLocked(true)}
                        onDragEnd={() => setDragScrollLocked(false)}
                        onDrop={(tx, ty) => handleLessonDrop(l, tx, ty)}
                        style={[
                          styles.lessonBlockDay,
                          tooTight && styles.lessonBlockWarn,
                          isCancelled && styles.lessonBlockCancelled,
                          { top, height },
                        ]}
                        testID={`lesson-block-${l.id}`}
                      >
                        <Pressable
                          style={{ flex: 1 }}
                          onPress={() => setDetailLesson(l)}
                        >
                        <Text style={[styles.lessonBlockTimeBig, isCancelled && styles.lessonTextCancelled]}>
                          {l.start_time}–{l.end_time}
                        </Text>
                        <Text style={[styles.lessonBlockNameFull, isCancelled && styles.lessonTextCancelled]} numberOfLines={2}>
                          {s?.name || 'Student'}
                        </Text>
                        {height >= HOUR_HEIGHT * 1.2 && (
                          <Text style={[styles.lessonBlockTopic, isCancelled && styles.lessonTextCancelled]} numberOfLines={1}>
                            {isCancelled ? (l.cancellation_note || 'Cancelled') : l.topic}
                          </Text>
                        )}
                        {tooTight && (
                          <View style={styles.warnDot} testID={`gap-warn-${l.id}`}>
                            <AlertTriangle size={10} color="#fff" />
                          </View>
                        )}
                        {!isCancelled && isLessonTestDay(l, s) && (
                          <View style={styles.testDayBadge} testID={`test-day-badge-${l.id}`} {...webTitle(`${s?.name || 'Student'}'s test is today`)}>
                            <Trophy size={10} color="#fff" />
                          </View>
                        )}
                        {!isCancelled && isLessonPaid(l) && (
                          <View style={styles.paidBadge} testID={`paid-badge-${l.id}`} {...webTitle('Lesson paid')}>
                            <PoundSterling size={9} color="#fff" />
                          </View>
                        )}
                        {isCancelled && (
                          <View style={styles.cancelledTag} testID={`cancelled-tag-${l.id}`}>
                            <Text style={styles.cancelledTagText}>Cancelled</Text>
                          </View>
                        )}
                        {/* One-tap 🧭 — hidden on cancelled lessons */}
                        {!isCancelled && (
                          <Pressable
                            style={styles.navQuickBtn}
                            onPress={(e: any) => {
                              if (e?.stopPropagation) e.stopPropagation();
                              const addr = l.pickup_address || (s ? `${s.address || ''}, ${s.postcode || ''}` : '');
                              openNavigation(preferredNav, addr);
                            }}
                            hitSlop={6}
                            testID={`nav-quick-${l.id}`}
                            accessibilityLabel={`Navigate to ${s?.name || 'student'}`}
                          >
                            <NavIcon size={14} color="#fff" />
                          </Pressable>
                        )}
                        </Pressable>
                      </DraggableLessonBlock>
                    );
                  })}
              </View>
            </View>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={!dragScrollLocked}>
            <View style={styles.grid} testID="weekly-grid">
              {/* Header row */}
              <View style={styles.gridRow}>
                <View style={[{ width: TIME_W }, styles.headerCell]} />
                {DAYS.map((d, i) => {
                  const date = addDays(weekStart, i);
                  return (
                    <View key={d} style={[styles.dayHeaderCellWeek, styles.headerCell, { width: weekColWidth }]}>
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
                  const cellDate = localDateKey(addDays(weekStart, di));
                  const dayLessons = lessons.filter((l) => l.date === cellDate);
                  const dayBands = availBlocks
                    .map((b) => ({ b, p: projectBlock(b, cellDate) }))
                    .filter((x) => !!x.p) as { b: AvailabilityBlock; p: { top: number; height: number } }[];
                  return (
                    <View key={di} style={[styles.weekDayCol, { height: TOTAL_HEIGHT, width: weekColWidth }]}>
                      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
                        {HOURS.slice(0, -1).map((h) => (
                          <View key={h} style={styles.hourSlot} />
                        ))}
                      </View>
                      {/* Grey unavailability bands for this column */}
                      {dayBands.map(({ b, p }) => (
                        <Pressable
                          key={`block-${b.id}-${cellDate}`}
                          style={[styles.unavailBandWeek, { top: p.top, height: p.height }]}
                          onPress={() => openUnavailEdit(b)}
                          testID={`unavail-band-${b.id}-${cellDate}`}
                        >
                          <Text style={styles.unavailBandTextWeek} numberOfLines={1}>🚫</Text>
                        </Pressable>
                      ))}
                      {dayLessons.map((l) => {
                        const s = getStudent(l.student_id);
                        const { top, height } = computePos(l);
                        const isCancelled = l.status === 'Cancelled';
                        const prev = isCancelled ? null : prevLessonFor(l);
                        const gapMin = prev ? minutesBetween(prev.end_time, prev.date, l.start_time, l.date) : null;
                        const needed = l.travel_minutes ?? prev?.travel_minutes ?? 0;
                        const tooTight = !isCancelled && gapMin !== null && gapMin < needed;
                        return (
                          <DraggableLessonBlock
                            key={l.id}
                            disabled={isCancelled}
                            allowDayChange
                            resetKey={`${l.id}-${l.date}-${l.start_time}`}
                            onDragStart={() => setDragScrollLocked(true)}
                            onDragEnd={() => setDragScrollLocked(false)}
                            onDrop={(tx, ty) => handleLessonDrop(l, tx, ty)}
                            style={[
                              styles.lessonBlockWeek,
                              tooTight && styles.lessonBlockWarn,
                              isCancelled && styles.lessonBlockCancelled,
                              { top, height },
                            ]}
                            testID={`lesson-block-${l.id}`}
                          >
                            <Pressable
                              style={{ flex: 1 }}
                              onPress={() => setDetailLesson(l)}
                            >
                            <Text style={[styles.lessonBlockTime, isCancelled && styles.lessonTextCancelled]}>
                              {l.start_time}–{l.end_time}
                            </Text>
                            <Text
                              style={[styles.lessonBlockNameWeek, isCancelled && styles.lessonTextCancelled]}
                              numberOfLines={2}
                            >
                              {s?.name || 'Student'}
                            </Text>
                            {tooTight && (
                              <View style={styles.warnDot} testID={`gap-warn-${l.id}`}>
                                <AlertTriangle size={10} color="#fff" />
                              </View>
                            )}
                            {!isCancelled && isLessonTestDay(l, s) && (
                              <View style={styles.testDayBadgeWeek} testID={`test-day-badge-${l.id}`} {...webTitle(`${s?.name || 'Student'}'s test is today`)}>
                                <Trophy size={8} color="#fff" />
                              </View>
                            )}
                            {!isCancelled && isLessonPaid(l) && (
                              <View style={styles.paidBadgeWeek} testID={`paid-badge-${l.id}`} {...webTitle('Lesson paid')}>
                                <PoundSterling size={7} color="#fff" />
                              </View>
                            )}
                            {/* One-tap 🧭 navigation — hidden when cancelled */}
                            {!isCancelled && (
                              <Pressable
                                style={styles.navQuickBtnWeek}
                                onPress={(e: any) => {
                                  if (e?.stopPropagation) e.stopPropagation();
                                  const addr = l.pickup_address || (s ? `${s.address || ''}, ${s.postcode || ''}` : '');
                                  openNavigation(preferredNav, addr);
                                }}
                                hitSlop={6}
                                testID={`nav-quick-${l.id}`}
                              >
                                <NavIcon size={11} color="#fff" />
                              </Pressable>
                            )}
                            </Pressable>
                          </DraggableLessonBlock>
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

      {/* Add Lesson Sheet — extracted to its own module to keep this screen lean. */}
      <AddLessonSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        students={students}
        lessons={lessons}
        availBlocks={availBlocks}
        pro={pro}
        onCreated={handleLessonCreated}
      />

      {/* Lesson Tools Sheet */}
      <LessonToolsSheet
        visible={!!detailLesson}
        onClose={() => setDetailLesson(null)}
        lesson={detailLesson}
        onChanged={() => setSelectedDate(new Date(selectedDate))}
      />

      {/* Add / Edit Unavailability */}
      <UnavailabilityModal
        visible={unavailOpen}
        block={editingBlock}
        initialDate={selectedKey}
        onClose={() => setUnavailOpen(false)}
        onSaved={() => { /* hook auto-refreshes via bump() */ }}
      />
    </SafeAreaView>
  );
}
