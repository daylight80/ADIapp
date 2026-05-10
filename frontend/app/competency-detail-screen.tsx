import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ChevronDown, ChevronUp, Check } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb } from '../src/mockDb';
import { Card, ProgressBar, Badge } from '../src/ui';

type Tab = 'overview' | 'lessons' | 'skills';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'skills', label: 'Skills' },
];

const MILESTONES = ['Introduced', 'Practising', 'Confident', 'Mastered'];

export default function CompetencyDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const studentId = (params.id as string) || 's2';
  const key = (params.key as string) || 'controls';

  const competency = mockDb.getCompetency(studentId, key) || mockDb.getCompetencies(studentId)[0];
  const lessons = useMemo(
    () => mockDb.listLessonsForStudent(studentId).filter((l) => l.topic.toLowerCase().includes(competency.name.split(' ')[0].toLowerCase())),
    [studentId, competency.name]
  );

  const [tab, setTab] = useState<Tab>('overview');
  const [expanded, setExpanded] = useState<string | null>(null);

  const milestoneIdx = Math.min(MILESTONES.length - 1, competency.level - 1);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{competency.name}</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => setTab(t.key)}
            testID={`comp-tab-${t.key}`}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === 'overview' && (
          <View style={{ gap: 14 }} testID="comp-overview">
            {/* Milestone bar */}
            <Card>
              <Text style={styles.cardTitle}>Milestones</Text>
              <View style={styles.milestoneRow}>
                {MILESTONES.map((m, i) => {
                  const done = i <= milestoneIdx;
                  return (
                    <View key={m} style={styles.milestoneItem}>
                      <View style={[styles.milestoneDot, { backgroundColor: done ? theme.colors.primary : theme.colors.border }]}>
                        {done && <Check size={14} color="#fff" />}
                      </View>
                      <Text style={[styles.milestoneLabel, !done && { color: theme.colors.textMuted }]}>{m}</Text>
                      {i < MILESTONES.length - 1 && (
                        <View style={[styles.milestoneLine, { backgroundColor: done ? theme.colors.primary : theme.colors.border }]} />
                      )}
                    </View>
                  );
                })}
              </View>
            </Card>

            {/* Skills progress */}
            <Card style={{ gap: 12 }}>
              <Text style={styles.cardTitle}>Skill progress</Text>
              {competency.skills.map((s) => (
                <View key={s.name} style={{ gap: 6 }}>
                  <View style={styles.skillRow}>
                    <Text style={styles.skillName}>{s.name}</Text>
                    <Badge label={`L${s.level}`} bg={theme.colors.primaryLight} color={theme.colors.primary} />
                  </View>
                  <ProgressBar progress={s.progress} />
                  <Text style={styles.skillPct}>{s.progress}%</Text>
                </View>
              ))}
            </Card>

            {/* Note card */}
            <Card>
              <Text style={styles.cardTitle}>Latest instructor note</Text>
              <Text style={styles.note}>
                Continue building confidence with {competency.name.toLowerCase()}. Practise on quieter
                routes before progressing to busier centres.
              </Text>
            </Card>
          </View>
        )}

        {tab === 'lessons' && (
          <View style={{ gap: 10 }} testID="comp-lessons">
            {lessons.length === 0 ? (
              <Card><Text style={styles.emptyText}>No lessons recorded for this competency yet.</Text></Card>
            ) : (
              lessons.map((l) => {
                const isOpen = expanded === l.id;
                const beforeLvl = Math.max(1, (l.grade || 3) - 1);
                const afterLvl = l.grade || 3;
                return (
                  <Card key={l.id} testID={`comp-lesson-${l.id}`}>
                    <TouchableOpacity onPress={() => setExpanded(isOpen ? null : l.id)} style={styles.lessonHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.lessonDate}>{new Date(l.date).toLocaleDateString('en-GB')}</Text>
                        <Text style={styles.lessonTopic}>{l.topic}</Text>
                      </View>
                      <View style={styles.levelArrow}>
                        <Badge label={`L${beforeLvl}`} bg={theme.colors.border} color={theme.colors.textMuted} />
                        <Text style={{ color: theme.colors.textMuted }}>→</Text>
                        <Badge label={`L${afterLvl}`} bg="#D1FAE5" color={theme.colors.success} />
                      </View>
                      {isOpen ? <ChevronUp size={18} color={theme.colors.textMuted} /> : <ChevronDown size={18} color={theme.colors.textMuted} />}
                    </TouchableOpacity>
                    {isOpen && (
                      <View style={{ marginTop: 12, gap: 8 }}>
                        {l.notes && <Text style={styles.note}>{l.notes}</Text>}
                        <Text style={styles.faultLine}>
                          Faults: {l.driving_faults + l.serious_faults + l.dangerous_faults}
                        </Text>
                      </View>
                    )}
                  </Card>
                );
              })
            )}
          </View>
        )}

        {tab === 'skills' && (
          <View style={{ gap: 10 }} testID="comp-skills">
            {competency.skills.map((s) => (
              <Card key={s.name} style={{ gap: 8 }}>
                <View style={styles.skillRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.skillName}>{s.name}</Text>
                    <Text style={styles.milestoneLabel}>{MILESTONES[Math.min(s.level - 1, MILESTONES.length - 1)]}</Text>
                  </View>
                  <Badge label={`Level ${s.level}`} bg={theme.colors.primaryLight} color={theme.colors.primary} />
                </View>
                <ProgressBar progress={s.progress} />
                <Text style={styles.skillPct}>{s.progress}% complete</Text>
              </Card>
            ))}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
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
  cardTitle: { ...theme.font.h3, marginBottom: 12 },
  milestoneRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  milestoneItem: { flex: 1, alignItems: 'center', position: 'relative' },
  milestoneDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 6, zIndex: 2 },
  milestoneLabel: { fontSize: 11, color: theme.colors.text, textAlign: 'center', fontWeight: '500' },
  milestoneLine: { position: 'absolute', top: 13, left: '60%', right: '-40%', height: 2, zIndex: 1 },
  skillRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  skillName: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  skillPct: { fontSize: 12, color: theme.colors.textMuted },
  note: { fontSize: 14, lineHeight: 20, color: theme.colors.text },
  lessonHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lessonDate: { fontSize: 12, color: theme.colors.textMuted },
  lessonTopic: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginTop: 2 },
  levelArrow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  faultLine: { fontSize: 13, color: theme.colors.faultDriving, fontWeight: '600' },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', padding: 12 },
});
