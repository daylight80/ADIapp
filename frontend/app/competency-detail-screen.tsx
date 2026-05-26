import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ChevronDown, ChevronUp, Check, Pencil } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb } from '../src/mockDb';
import { useCompetencies, updateCompetency } from '../src/useSupabaseData';
import { Card, ProgressBar, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';

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
  const studentId = (params.id as string) || '';
  const key = (params.key as string) || 'controls';

  // Live competencies from Supabase, with a mockDb fallback for legacy student IDs.
  const { competencies: sbComps, loading: compLoading } = useCompetencies(studentId);
  const competency = useMemo(() => {
    if (sbComps && sbComps.length > 0) {
      return sbComps.find((c) => c.key === key) || sbComps[0];
    }
    // Fallback to mock (student-home flow with non-Supabase IDs)
    return mockDb.getCompetency(studentId, key) || mockDb.getCompetencies(studentId)[0];
  }, [sbComps, studentId, key]);

  // Filter related lessons by competency name (legacy heuristic, kept for now).
  const lessons = useMemo(() => {
    if (!competency) return [];
    const firstWord = (competency.name || '').split(' ')[0]?.toLowerCase() || '';
    return mockDb
      .listLessonsForStudent(studentId)
      .filter((l) => l.topic.toLowerCase().includes(firstWord));
  }, [studentId, competency?.name]);

  const [tab, setTab] = useState<Tab>('overview');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Edit competency state
  const [editOpen, setEditOpen] = useState(false);
  const [editLevel, setEditLevel] = useState<number>(competency?.level ?? 1);
  const [editProgress, setEditProgress] = useState<number>(competency?.progress ?? 0);
  const [saving, setSaving] = useState(false);
  // Whether to show edit affordance — only when this competency came from Supabase
  const isLive = !!sbComps && sbComps.length > 0 && sbComps.some((c) => c.key === key);

  const openEdit = () => {
    if (!competency) return;
    setEditLevel(competency.level);
    setEditProgress(competency.progress);
    setEditOpen(true);
  };
  const saveEdit = async () => {
    if (!competency) return;
    setSaving(true);
    try {
      await updateCompetency(studentId, competency.key, {
        level: editLevel,
        progress: editProgress,
      });
      setEditOpen(false);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not update competency.');
    } finally {
      setSaving(false);
    }
  };

  if (compLoading && !competency) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={[styles.header, { justifyContent: 'flex-start' }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
            <ArrowLeft size={22} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!competency) return null;

  const milestoneIdx = Math.min(MILESTONES.length - 1, competency.level - 1);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{competency.name}</Text>
        {isLive ? (
          <TouchableOpacity onPress={openEdit} style={styles.iconBtn} testID="btn-edit-competency">
            <Pencil size={20} color={theme.colors.primary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
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
            {/* Level summary card */}
            <Card>
              <View style={styles.summaryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryLabel}>Current level</Text>
                  <Text style={styles.summaryValue}>Level {competency.level}/5</Text>
                  <Text style={styles.summaryMeta}>{MILESTONES[milestoneIdx]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryLabel}>Progress</Text>
                  <Text style={[styles.summaryValue, { color: theme.colors.accent }]}>{competency.progress}%</Text>
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                <ProgressBar progress={competency.progress} height={10} />
              </View>
              {competency.assessed_at && (
                <Text style={styles.assessedAt}>
                  Last assessed: {new Date(competency.assessed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              )}
            </Card>

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

            {/* Instructor notes */}
            <Card>
              <Text style={styles.cardTitle}>Latest instructor note</Text>
              <Text style={styles.note}>
                {competency.notes
                  ? competency.notes
                  : `Continue building confidence with ${competency.name.toLowerCase()}. Practise on quieter routes before progressing to busier centres.`}
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

      {/* Edit competency bottom sheet */}
      <BottomSheet visible={editOpen} onClose={() => setEditOpen(false)} title={`Update ${competency.name}`} testID="sheet-edit-competency">
        <Text style={styles.editLabel}>Competency level</Text>
        <View style={styles.levelRow}>
          {[1, 2, 3, 4, 5].map((lvl) => (
            <TouchableOpacity
              key={lvl}
              style={[styles.levelChip, editLevel === lvl && styles.levelChipActive]}
              onPress={() => setEditLevel(lvl)}
              testID={`pick-level-${lvl}`}
            >
              <Text style={[styles.levelChipText, editLevel === lvl && styles.levelChipTextActive]}>L{lvl}</Text>
              <Text style={[styles.levelChipSub, editLevel === lvl && styles.levelChipTextActive]}>
                {MILESTONES[Math.min(lvl - 1, MILESTONES.length - 1)]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.editLabel, { marginTop: 16 }]}>
          Progress: <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>{editProgress}%</Text>
        </Text>
        <View style={styles.progressRow}>
          {[0, 25, 50, 75, 100].map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.progressChip, editProgress === p && styles.progressChipActive]}
              onPress={() => setEditProgress(p)}
              testID={`pick-progress-${p}`}
            >
              <Text style={[styles.progressChipText, editProgress === p && styles.progressChipTextActive]}>{p}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={saveEdit}
          disabled={saving}
          testID="btn-save-competency"
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save changes</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditOpen(false)} testID="btn-cancel-edit-competency">
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </BottomSheet>
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
  summaryRow: { flexDirection: 'row', gap: 16 },
  summaryLabel: { fontSize: 12, color: theme.colors.textMuted, marginBottom: 4, fontWeight: '600' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: theme.colors.primary },
  summaryMeta: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  assessedAt: { fontSize: 12, color: theme.colors.textMuted, marginTop: 10 },
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
  // Edit sheet
  editLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginBottom: 10 },
  levelRow: { flexDirection: 'row', gap: 6 },
  levelChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  levelChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  levelChipText: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  levelChipSub: { fontSize: 10, color: theme.colors.textMuted, marginTop: 2 },
  levelChipTextActive: { color: '#fff' },
  progressRow: { flexDirection: 'row', gap: 6 },
  progressChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  progressChipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  progressChipText: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
  progressChipTextActive: { color: '#fff' },
  saveBtn: { marginTop: 20, backgroundColor: theme.colors.primary, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cancelBtn: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 8 },
  cancelBtnText: { color: theme.colors.textMuted, fontWeight: '600', fontSize: 14 },
});
