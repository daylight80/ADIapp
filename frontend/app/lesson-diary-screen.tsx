import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ChevronLeft, ChevronRight, Plus, ArrowLeft, AlertTriangle,
  Calendar, CalendarDays, Ban, Navigation as NavIcon, Route as RouteIcon,
} from 'lucide-react-native';
import { theme } from '../src/theme';
import { Lesson } from '../src/mockDb';
import {
  useLessonsForWeek, useStudents, useInstructorProfile, useAvailabilityBlocks,
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
  DAYS, TOP_HOUR, BOTTOM_HOUR, HOURS, HOUR_HEIGHT, TOTAL_HEIGHT, TIME_W,
} from '../src/diary/constants';
import { startOfWeek, addDays, formatDateRange, localDateKey } from '../src/diary/dateUtils';
import { styles } from '../src/diary/diaryStyles';
import { AddLessonSheet } from '../src/diary/AddLessonSheet';

export default function LessonDiaryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pro = isPaidTier(user?.tier);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  });
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

  // On mount, if we're viewing today, scroll to roughly the current hour.
  useEffect(() => {
    const today = new Date();
    if (selectedDate.toDateString() === today.toDateString()) {
      const h = today.getHours();
      const m = today.getMinutes();
      const hhmm = `${String(Math.max(h, TOP_HOUR)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
  const selectedKey = localDateKey(selectedDate);
  const todayKey = localDateKey(new Date());

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
          >
            <RouteIcon size={22} color={theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={openUnavailNew} testID="btn-add-unavailability" style={styles.iconBtn} accessibilityLabel="Add unavailability">
            <Ban size={22} color={theme.colors.danger} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAddOpen(true)} testID="btn-add-lesson" style={styles.iconBtn}>
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
                      <Pressable
                        key={l.id}
                        style={[
                          styles.lessonBlockDay,
                          tooTight && styles.lessonBlockWarn,
                          isCancelled && styles.lessonBlockCancelled,
                          { top, height },
                        ]}
                        onPress={() => setDetailLesson(l)}
                        testID={`lesson-block-${l.id}`}
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
                  const cellDate = localDateKey(addDays(weekStart, di));
                  const dayLessons = lessons.filter((l) => l.date === cellDate);
                  const dayBands = availBlocks
                    .map((b) => ({ b, p: projectBlock(b, cellDate) }))
                    .filter((x) => !!x.p) as { b: AvailabilityBlock; p: { top: number; height: number } }[];
                  return (
                    <View key={di} style={[styles.weekDayCol, { height: TOTAL_HEIGHT }]}>
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
                          <Pressable
                            key={l.id}
                            style={[
                              styles.lessonBlockWeek,
                              tooTight && styles.lessonBlockWarn,
                              isCancelled && styles.lessonBlockCancelled,
                              { top, height },
                            ]}
                            onPress={() => setDetailLesson(l)}
                            testID={`lesson-block-${l.id}`}
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
