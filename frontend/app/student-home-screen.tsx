import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check, X, FileCheck, MessageCircle, ChevronRight, Award, Trophy, BookOpen, Pencil, Wallet } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { mockDb, readiness, mockDb_ext } from '../src/mockDb';
import { useCompetencies } from '../src/useSupabaseData';
import { Card, ProgressBar, Badge } from '../src/ui';
import { BottomNav } from '../src/BottomNav';
import { BottomSheet } from '../src/BottomSheet';

export default function StudentHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflectText, setReflectText] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // Find student record by email (demo) or default to s2
  const studentRecord = user?.email ? mockDb.getStudentByEmail(user.email) : undefined;
  const student = studentRecord || mockDb.getStudent('s2')!;

  const competenciesMock = mockDb.getCompetencies(student.id);
  // Try Supabase live competencies — only takes effect when student.id is a
  // real Supabase UUID (currently the case after Migration 004 lands).
  const { competencies: sbCompetencies } = useCompetencies(student.id);
  const competencies = sbCompetencies && sbCompetencies.length > 0 ? sbCompetencies : competenciesMock;
  const lessons = mockDb.listLessonsForStudent(student.id);
  const recentLesson = lessons.find((l) => l.status === 'Completed') || lessons[0];
  const badges = useMemo(() => mockDb_ext.getBadges(student.id), [student.id, reloadKey]);
  const reflections = useMemo(() => mockDb_ext.listReflections(student.id), [student.id, reloadKey]);

  const met = readiness.criteria.filter((c) => c.met).length;
  const total = readiness.criteria.length;
  const pct = Math.round((met / total) * 100);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      setReloadKey((k) => k + 1);
      setRefreshing(false);
    }, 600);
  }, []);

  const saveReflection = () => {
    if (!recentLesson) return;
    if (reflectText.trim().length < 5) {
      Alert.alert('Please write a few words about your last lesson.');
      return;
    }
    mockDb_ext.addReflection(recentLesson.id, student.id, reflectText.trim());
    setReflectText('');
    setReflectOpen(false);
    setReloadKey((k) => k + 1);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello,</Text>
          <Text style={styles.name} testID="student-name">{user?.name || student.name}</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.name || student.name).split(' ').map((n) => n[0]).join('').slice(0, 2)}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        testID="student-home-scroll"
      >
        {/* Readiness */}
        <Card style={styles.readyCard} testID="readiness-card">
          <View style={styles.readyHeader}>
            <Award size={24} color={theme.colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.readyTitle}>Driving Readiness</Text>
              <Text style={styles.readySub}>{met}/{total} criteria met</Text>
            </View>
            <Text style={styles.readyPct}>{pct}%</Text>
          </View>
          <ProgressBar progress={pct} height={10} color={theme.colors.accent} />
          <View style={{ marginTop: 14, gap: 8 }}>
            {readiness.criteria.map((c) => (
              <View key={c.key} style={styles.criteriaRow} testID={`criteria-${c.key}`}>
                <View style={[styles.checkCircle, { backgroundColor: c.met ? theme.colors.success : theme.colors.border }]}>
                  {c.met ? <Check size={12} color="#fff" /> : <X size={12} color={theme.colors.textMuted} />}
                </View>
                <Text style={[styles.criteriaText, !c.met && { color: theme.colors.textMuted }]}>{c.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Mock Test */}
        <TouchableOpacity onPress={() => router.push('/dl25-mock-test-screen')} testID="mock-test-widget">
          <Card style={styles.mockCard}>
            <View style={styles.mockIcon}>
              <FileCheck size={28} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.mockTitle}>DL25 Mock Test</Text>
              <Text style={styles.mockSub}>Practise with the official DVSA mark sheet format</Text>
            </View>
            <ChevronRight size={22} color="#fff" />
          </Card>
        </TouchableOpacity>

        {/* DVSA Competency Tracker */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>DVSA Competency Tracker</Text>
        </View>
        <View style={styles.compGrid} testID="competency-grid">
          {competencies.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={styles.compCard}
              onPress={() => router.push({ pathname: '/competency-detail-screen', params: { id: student.id, key: c.key } })}
              testID={`comp-${c.key}`}
            >
              <View style={styles.compTop}>
                <Text style={styles.compName} numberOfLines={1}>{c.name}</Text>
                <Badge label={`L${c.level}`} bg={theme.colors.primaryLight} color={theme.colors.primary} />
              </View>
              <ProgressBar progress={c.progress} height={6} />
              <Text style={styles.compPct}>{c.progress}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Lesson Feedback */}
        <Card style={{ gap: 10 }} testID="feedback-widget">
          <View style={styles.row}>
            <MessageCircle size={22} color={theme.colors.primary} />
            <Text style={styles.sectionTitle}>Recent Lesson Feedback</Text>
          </View>
          {recentLesson ? (
            <>
              <Text style={styles.fbDate}>
                {new Date(recentLesson.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
              </Text>
              <Text style={styles.fbTopic}>{recentLesson.topic}</Text>
              {recentLesson.notes && <Text style={styles.fbNotes}>"{recentLesson.notes}"</Text>}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {recentLesson.grade && <Badge label={`Grade ${recentLesson.grade}/5`} bg="#D1FAE5" color={theme.colors.success} />}
                <Badge
                  label={`${recentLesson.driving_faults + recentLesson.serious_faults} faults`}
                  bg="#FEF3C7"
                  color={theme.colors.faultDriving}
                />
              </View>
            </>
          ) : (
            <Text style={styles.fbNotes}>No recent feedback available.</Text>
          )}
        </Card>

        {/* Badges */}
        {badges.length > 0 && (
          <Card style={{ gap: 10 }} testID="badges-card">
            <View style={styles.row}>
              <Trophy size={22} color={theme.colors.accent} />
              <Text style={styles.sectionTitle}>Your badges</Text>
            </View>
            <View style={styles.badgesRow}>
              {badges.map((b) => (
                <View key={b.key} style={styles.badgeChip} testID={`badge-${b.key}`}>
                  <Text style={styles.badgeChipText}>🏆 {b.name}</Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {/* Theory + Wallet shortcuts */}
        <View style={styles.shortcutRow}>
          <TouchableOpacity style={[styles.shortcut, { backgroundColor: theme.colors.primary }]} onPress={() => router.push('/theory-test-screen')} testID="shortcut-theory">
            <BookOpen size={22} color="#fff" />
            <Text style={styles.shortcutText}>Theory Test</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.shortcut, { backgroundColor: theme.colors.success }]} onPress={() => router.push({ pathname: '/wallet-screen', params: { studentId: student.id } })} testID="shortcut-wallet">
            <Wallet size={22} color="#fff" />
            <Text style={styles.shortcutText}>Wallet</Text>
          </TouchableOpacity>
        </View>

        {/* Reflective Logs */}
        <Card style={{ gap: 10 }} testID="reflections-card">
          <View style={styles.reflectHead}>
            <Pencil size={20} color={theme.colors.primary} />
            <Text style={styles.sectionTitle}>Reflective log</Text>
            <TouchableOpacity onPress={() => setReflectOpen(true)} testID="btn-add-reflection">
              <Text style={styles.linkText}>+ Add</Text>
            </TouchableOpacity>
          </View>
          {reflections.length === 0 ? (
            <Text style={styles.emptyText}>Reflect on what you learnt — a key part of modern learner-centred driving instruction.</Text>
          ) : (
            reflections.slice(0, 3).map((r) => (
              <View key={r.id} style={styles.reflectItem} testID={`reflection-${r.id}`}>
                <Text style={styles.reflectDate}>{new Date(r.created_at).toLocaleDateString('en-GB')}</Text>
                <Text style={styles.reflectText}>"{r.text}"</Text>
              </View>
            ))
          )}
        </Card>

        <View style={{ height: 24 }} />
      </ScrollView>

      <BottomNav role="student" />

      <BottomSheet visible={reflectOpen} onClose={() => setReflectOpen(false)} title="Reflective log" testID="sheet-reflection">
        <Text style={styles.hint}>What went well? What could improve next lesson?</Text>
        <TextInput
          style={styles.reflectInput}
          value={reflectText}
          onChangeText={setReflectText}
          placeholder="Today I worked on roundabouts. I felt more confident with signalling but need to practise observation when exiting…"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          textAlignVertical="top"
          testID="input-reflection"
        />
        <TouchableOpacity style={styles.saveBtn} onPress={saveReflection} testID="btn-save-reflection">
          <Text style={styles.saveBtnText}>Save reflection</Text>
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  greeting: { ...theme.font.caption },
  name: { ...theme.font.h2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  scroll: { padding: 16, gap: 16, paddingBottom: 96 },
  readyCard: { gap: 8 },
  readyHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  readyTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  readySub: { ...theme.font.caption },
  readyPct: { fontSize: 24, fontWeight: '700', color: theme.colors.accent },
  criteriaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkCircle: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  criteriaText: { fontSize: 14, color: theme.colors.text, flex: 1 },
  mockCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  mockIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  mockTitle: { color: '#fff', fontWeight: '700', fontSize: 17 },
  mockSub: { color: '#ffffffdd', fontSize: 13, marginTop: 2 },
  sectionTitle: { ...theme.font.h3 },
  sectionHeader: { marginTop: 4 },
  compGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  compCard: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 8,
  },
  compTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  compName: { fontWeight: '600', color: theme.colors.text, flex: 1, fontSize: 13 },
  compPct: { fontSize: 12, color: theme.colors.textMuted, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fbDate: { ...theme.font.caption, fontWeight: '600', color: theme.colors.primary },
  fbTopic: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  fbNotes: { fontSize: 14, color: theme.colors.text, fontStyle: 'italic', lineHeight: 20 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badgeChip: { backgroundColor: '#FFF7ED', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.accent },
  badgeChipText: { color: theme.colors.accent, fontWeight: '700', fontSize: 13 },
  shortcutRow: { flexDirection: 'row', gap: 10 },
  shortcut: { flex: 1, height: 60, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  shortcutText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  reflectHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13, marginLeft: 'auto' },
  emptyText: { color: theme.colors.textMuted, fontSize: 13 },
  reflectItem: { borderLeftWidth: 3, borderLeftColor: theme.colors.primary, paddingLeft: 10, paddingVertical: 4 },
  reflectDate: { fontSize: 11, color: theme.colors.textMuted, fontWeight: '600' },
  reflectText: { fontSize: 14, color: theme.colors.text, fontStyle: 'italic', marginTop: 2 },
  hint: { color: theme.colors.textMuted, marginBottom: 12 },
  reflectInput: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, minHeight: 120, backgroundColor: theme.colors.background, fontSize: 15 },
  saveBtn: { marginTop: 12, backgroundColor: theme.colors.primary, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
