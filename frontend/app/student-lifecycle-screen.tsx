import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Mail, Phone, MapPin, CalendarDays, PoundSterling } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb } from '../src/mockDb';
import { Card, ProgressBar, StatusBadge, Badge } from '../src/ui';
import { SimpleBarChart } from '../src/SimpleBarChart';

type Tab = 'overview' | 'lessons' | 'competency' | 'earnings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'competency', label: 'Competency' },
  { key: 'earnings', label: 'Earnings' },
];

export default function StudentLifecycleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = (params.id as string) || 's1';
  const student = mockDb.getStudent(id) || mockDb.listStudents()[0];
  const lessons = useMemo(() => mockDb.listLessonsForStudent(student.id), [student.id]);
  const competencies = useMemo(() => mockDb.getCompetencies(student.id), [student.id]);

  const [tab, setTab] = useState<Tab>('overview');

  const totalEarnings = lessons.reduce((sum, l) => sum + (l.amount_paid || 0), 0);
  const totalHours = lessons.reduce((sum, l) => sum + l.duration_hours, 0);

  const monthlyEarnings = useMemo(() => {
    const map: Record<string, number> = {};
    lessons.forEach((l) => {
      const m = l.date.slice(0, 7);
      map[m] = (map[m] || 0) + (l.amount_paid || 0);
    });
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([m, v]) => ({ month: m.slice(5), value: v }));
  }, [lessons]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{student.name}</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.tabBar} testID="lifecycle-tabs">
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => setTab(t.key)}
            testID={`tab-${t.key}`}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === 'overview' && (
          <View style={{ gap: 12 }} testID="tab-overview-content">
            <Card>
              <View style={styles.row}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {student.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{student.name}</Text>
                  <StatusBadge status={student.status} />
                </View>
              </View>
              <View style={styles.contactList}>
                <ContactRow icon={<Mail size={16} color={theme.colors.textMuted} />} text={student.email} />
                <ContactRow icon={<Phone size={16} color={theme.colors.textMuted} />} text={student.phone} />
                <ContactRow icon={<MapPin size={16} color={theme.colors.textMuted} />} text={`${student.address}, ${student.postcode}`} />
              </View>
            </Card>

            <View style={styles.statsRow}>
              <StatCard label="Lessons" value={student.lessons_count.toString()} />
              <StatCard label="Hours" value={totalHours.toFixed(1)} />
              <StatCard label="Rate" value={`£${student.hourly_rate}`} />
            </View>

            <Card>
              <Text style={styles.cardTitle}>Driving readiness</Text>
              <View style={styles.readyRow}>
                <ProgressBar progress={student.progress} height={10} />
                <Text style={styles.readyPct}>{student.progress}%</Text>
              </View>
              {student.test_date && (
                <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <CalendarDays size={16} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                    Test booked: {new Date(student.test_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                </View>
              )}
            </Card>

            <Card>
              <Text style={styles.cardTitle}>Instructor notes</Text>
              <Text style={styles.notes}>
                {student.name.split(' ')[0]} continues to make strong progress. Focus on independent
                driving for the next two lessons and review manoeuvres before the test.
              </Text>
            </Card>
          </View>
        )}

        {tab === 'lessons' && (
          <View style={{ gap: 12 }} testID="tab-lessons-content">
            {lessons.length === 0 ? (
              <Card><Text style={styles.emptyText}>No lessons recorded yet.</Text></Card>
            ) : (
              lessons.map((l) => (
                <Card key={l.id} style={{ gap: 8 }} testID={`lesson-row-${l.id}`}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lessonDate}>
                        {new Date(l.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                      <Text style={styles.lessonTopic}>{l.topic}</Text>
                    </View>
                    <Badge label={l.status} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Badge label={`${l.start_time}-${l.end_time}`} />
                    {l.grade && <Badge label={`Grade ${l.grade}/5`} bg="#D1FAE5" color={theme.colors.success} />}
                    <Badge label={`${l.driving_faults + l.serious_faults + l.dangerous_faults} faults`} bg="#FEF3C7" color={theme.colors.faultDriving} />
                  </View>
                  {l.notes && <Text style={styles.notes}>{l.notes}</Text>}
                </Card>
              ))
            )}
          </View>
        )}

        {tab === 'competency' && (
          <View style={{ gap: 10 }} testID="tab-competency-content">
            {competencies.map((c) => (
              <TouchableOpacity
                key={c.key}
                onPress={() => router.push({ pathname: '/competency-detail-screen', params: { id: student.id, key: c.key } })}
                testID={`competency-${c.key}`}
              >
                <Card style={{ gap: 8 }}>
                  <View style={styles.row}>
                    <Text style={styles.compName}>{c.name}</Text>
                    <Badge label={`Level ${c.level}`} />
                  </View>
                  <ProgressBar progress={c.progress} />
                  <Text style={styles.compMeta}>{c.progress}% complete</Text>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {tab === 'earnings' && (
          <View style={{ gap: 12 }} testID="tab-earnings-content">
            <View style={styles.statsRow}>
              <StatCard label="Total" value={`£${totalEarnings}`} color={theme.colors.accent} />
              <StatCard label="Hours" value={totalHours.toFixed(1)} />
              <StatCard label="Rate" value={`£${student.hourly_rate}`} />
            </View>

            <Card>
              <Text style={styles.cardTitle}>Monthly earnings</Text>
              {monthlyEarnings.length > 0 ? (
                <SimpleBarChart
                  data={monthlyEarnings.map((e) => ({ label: e.month, value: e.value }))}
                  color={theme.colors.accent}
                  height={180}
                />
              ) : (
                <Text style={styles.emptyText}>No earnings recorded yet.</Text>
              )}
            </Card>

            <Card>
              <Text style={styles.cardTitle}>Payment history</Text>
              <View style={{ gap: 8, marginTop: 8 }}>
                {lessons.filter((l) => l.amount_paid).map((l) => (
                  <View key={l.id} style={styles.payRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '600', color: theme.colors.text }}>{l.topic}</Text>
                      <Text style={styles.payDate}>{new Date(l.date).toLocaleDateString('en-GB')}</Text>
                    </View>
                    <Text style={styles.payAmount}>£{l.amount_paid}</Text>
                  </View>
                ))}
              </View>
            </Card>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ContactRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.contactRow}>
      {icon}
      <Text style={styles.contactText}>{text}</Text>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, gap: 8 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },
  tabBar: { flexDirection: 'row', paddingHorizontal: 16, gap: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  tabBtn: { paddingVertical: 12, paddingHorizontal: 4, flex: 1, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: theme.colors.primary },
  tabText: { color: theme.colors.textMuted, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: theme.colors.primary },
  scroll: { padding: 16, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: theme.colors.primary, fontSize: 18 },
  studentName: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginBottom: 4 },
  contactList: { gap: 8, marginTop: 12 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contactText: { color: theme.colors.text, fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '700', color: theme.colors.primary },
  statLabel: { fontSize: 12, color: theme.colors.textMuted, marginTop: 4 },
  cardTitle: { ...theme.font.h3, marginBottom: 8 },
  readyRow: { gap: 8 },
  readyPct: { fontWeight: '700', color: theme.colors.primary },
  notes: { color: theme.colors.text, lineHeight: 20, fontSize: 14 },
  lessonDate: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 2 },
  lessonTopic: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  compName: { fontSize: 15, fontWeight: '600', color: theme.colors.text, flex: 1 },
  compMeta: { fontSize: 12, color: theme.colors.textMuted },
  payRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  payDate: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  payAmount: { fontWeight: '700', color: theme.colors.accent, fontSize: 15 },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', padding: 12 },
});
