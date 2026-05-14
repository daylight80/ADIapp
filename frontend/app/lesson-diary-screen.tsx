import React, { useState, useMemo } from 'react';
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
import { ChevronLeft, ChevronRight, Plus, ArrowLeft } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb, Lesson } from '../src/mockDb';
import { Card, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import { BottomNav } from '../src/BottomNav';
import { useAuth } from '../src/AuthContext';
import { isPro } from '../src/proPlan';
import { scheduleLessonReminders } from '../src/notifications';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 08:00 - 19:00

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
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date()));
  const [addOpen, setAddOpen] = useState(false);
  const [detailLesson, setDetailLesson] = useState<Lesson | null>(null);

  // Form state
  const [studentId, setStudentId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [topic, setTopic] = useState('');

  const lessons = useMemo(() => mockDb.listLessonsForWeek(weekStart), [weekStart, addOpen]);
  const students = mockDb.listStudents();

  const goPrev = () => setWeekStart(addDays(weekStart, -7));
  const goNext = () => setWeekStart(addDays(weekStart, 7));

  const handleAdd = () => {
    if (!studentId || !date || !topic) return;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const duration = (eh + em / 60) - (sh + sm / 60);
    const newLesson = mockDb.addLesson({
      student_id: studentId,
      date,
      start_time: startTime,
      end_time: endTime,
      duration_hours: duration,
      topic,
      amount_paid: Math.round(duration * 36),
    });
    setStudentId('');
    setDate('');
    setTopic('');
    setAddOpen(false);

    // Pro: schedule 24h and 1h reminders
    if (pro) {
      const student = mockDb.getStudent(studentId);
      if (student) scheduleLessonReminders(newLesson, student).catch(() => {});
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

      <View style={styles.weekNav} testID="week-nav">
        <TouchableOpacity onPress={goPrev} style={styles.weekArrow} testID="week-prev">
          <ChevronLeft size={20} color={theme.colors.primary} />
        </TouchableOpacity>
        <Text style={styles.weekLabel}>{formatDateRange(weekStart)}</Text>
        <TouchableOpacity onPress={goNext} style={styles.weekArrow} testID="week-next">
          <ChevronRight size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.grid} testID="weekly-grid">
            {/* Header row */}
            <View style={styles.gridRow}>
              <View style={[styles.timeCell, styles.headerCell]} />
              {DAYS.map((d, i) => {
                const date = addDays(weekStart, i);
                return (
                  <View key={d} style={[styles.dayCell, styles.headerCell]}>
                    <Text style={styles.dayName}>{d}</Text>
                    <Text style={styles.dayNum}>{date.getDate()}</Text>
                  </View>
                );
              })}
            </View>
            {/* Time rows */}
            {HOURS.map((h) => (
              <View key={h} style={styles.gridRow}>
                <View style={styles.timeCell}>
                  <Text style={styles.timeText}>{`${h.toString().padStart(2, '0')}:00`}</Text>
                </View>
                {DAYS.map((_, di) => {
                  const cellDate = addDays(weekStart, di).toISOString().slice(0, 10);
                  const cellLessons = lessons.filter(
                    (l) => l.date === cellDate && parseInt(l.start_time.split(':')[0], 10) === h
                  );
                  return (
                    <View key={di} style={styles.dayCell}>
                      {cellLessons.map((l) => {
                        const s = mockDb.getStudent(l.student_id);
                        return (
                          <TouchableOpacity
                            key={l.id}
                            style={styles.lessonBlock}
                            onPress={() => setDetailLesson(l)}
                            testID={`lesson-block-${l.id}`}
                          >
                            <Text style={styles.lessonBlockTime}>
                              {l.start_time}-{l.end_time}
                            </Text>
                            <Text style={styles.lessonBlockName} numberOfLines={1}>
                              {s?.name?.split(' ')[0] || 'Student'}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
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

        <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={date}
          onChangeText={setDate}
          placeholder={new Date().toISOString().slice(0, 10)}
          placeholderTextColor={theme.colors.textMuted}
          testID="input-lesson-date"
        />

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Start</Text>
            <TextInput
              style={styles.input}
              value={startTime}
              onChangeText={setStartTime}
              testID="input-lesson-start"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>End</Text>
            <TextInput
              style={styles.input}
              value={endTime}
              onChangeText={setEndTime}
              testID="input-lesson-end"
            />
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

        <TouchableOpacity style={styles.submitBtn} onPress={handleAdd} testID="btn-submit-lesson">
          <Text style={styles.submitBtnText}>Save Lesson</Text>
        </TouchableOpacity>
      </BottomSheet>

      {/* Lesson Detail Sheet */}
      <BottomSheet
        visible={!!detailLesson}
        onClose={() => setDetailLesson(null)}
        title="Lesson Details"
        testID="sheet-lesson-detail"
      >
        {detailLesson && (() => {
          const s = mockDb.getStudent(detailLesson.student_id);
          return (
            <View style={{ gap: 12 }}>
              <Text style={styles.detailName}>{s?.name}</Text>
              <Text style={styles.detailTopic}>{detailLesson.topic}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Badge label={detailLesson.status} />
                <Badge label={`${detailLesson.start_time} - ${detailLesson.end_time}`} />
                <Badge label={`${detailLesson.duration_hours}h`} />
              </View>
              {detailLesson.notes && (
                <View>
                  <Text style={styles.label}>Notes</Text>
                  <Text style={styles.notes}>{detailLesson.notes}</Text>
                </View>
              )}
              <View style={styles.faultsRow}>
                <FaultBadge label="Driving" value={detailLesson.driving_faults} colour={theme.colors.faultDriving} />
                <FaultBadge label="Serious" value={detailLesson.serious_faults} colour={theme.colors.faultSerious} />
                <FaultBadge label="Dangerous" value={detailLesson.dangerous_faults} colour={theme.colors.faultDangerous} />
              </View>
            </View>
          );
        })()}
      </BottomSheet>
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

const CELL_W = 90;
const TIME_W = 60;
const CELL_H = 60;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8 },
  title: { ...theme.font.h2 },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 8 },
  weekArrow: { padding: 8, borderRadius: 8, backgroundColor: theme.colors.primaryLight },
  weekLabel: { ...theme.font.h3 },
  scroll: { paddingHorizontal: 12, paddingBottom: 96 },
  grid: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  gridRow: { flexDirection: 'row' },
  headerCell: { backgroundColor: theme.colors.primaryLight, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  timeCell: {
    width: TIME_W,
    height: CELL_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  timeText: { fontSize: 12, color: theme.colors.textMuted },
  dayCell: {
    width: CELL_W,
    height: CELL_H,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    padding: 2,
    gap: 2,
  },
  dayName: { fontWeight: '600', color: theme.colors.text, fontSize: 12 },
  dayNum: { fontSize: 16, fontWeight: '700', color: theme.colors.primary },
  lessonBlock: {
    backgroundColor: theme.colors.primary,
    borderRadius: 6,
    padding: 4,
    flex: 1,
    justifyContent: 'center',
  },
  lessonBlockTime: { color: '#fff', fontSize: 10, fontWeight: '600' },
  lessonBlockName: { color: '#fff', fontSize: 11 },
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
