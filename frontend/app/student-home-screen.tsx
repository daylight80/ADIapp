import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, TextInput, Alert, ActivityIndicator, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check, X, FileCheck, MessageCircle, ChevronRight, Award, Trophy, BookOpen, Pencil, Wallet, Bell } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { mockDb, readiness, mockDb_ext } from '../src/mockDb';
import { isPaidTier } from '../src/tiers';
import { registerExpoPushToken } from '../src/notifications';
import { getWaitingListStatus, setWaitingListStatus } from '../src/supabaseDb';
import {
  useCompetencies,
  useBadges,
  useReflectiveLogs,
  createReflectiveLog,
  useStudentByAuthId,
  useStudentByEmail,
  useLessonsForStudent,
  useMockTestAttempts,
} from '../src/useSupabaseData';
import { Card, ProgressBar, Badge, LockedFeature } from '../src/ui';
import { BottomNav } from '../src/BottomNav';
import { BottomSheet } from '../src/BottomSheet';

export default function StudentHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflectText, setReflectText] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  // ---------------------------------------------------------------------
  // Resolve "who am I?"
  //   1. Try Supabase by auth uid (Migration 004 onwards).
  //   2. Fall back to Supabase by email.
  //   3. Fall back to mockDb seed (legacy demo flow).
  // ---------------------------------------------------------------------
  const { student: sbStudentByAuth } = useStudentByAuthId(user?.id);
  const { student: sbStudentByEmail } = useStudentByEmail(
    !sbStudentByAuth ? user?.email : undefined,
  );
  const supabaseStudent = sbStudentByAuth || sbStudentByEmail;
  const mockStudentByEmail = user?.email ? mockDb.getStudentByEmail(user.email) : undefined;
  const mockStudent = mockStudentByEmail || mockDb.getStudent('s2')!;

  // Unified student card used by the UI. Prefer Supabase fields when present.
  const student = supabaseStudent
    ? {
        id: supabaseStudent.id,
        name: supabaseStudent.name,
        status: supabaseStudent.status,
        progress: supabaseStudent.progress ?? 0,
        test_date: supabaseStudent.test_date,
      }
    : {
        id: mockStudent.id,
        name: mockStudent.name,
        status: mockStudent.status,
        progress: mockStudent.progress,
        test_date: mockStudent.test_date,
      };

  // -------- Competencies (Supabase first, mockDb fallback) -------------
  const competenciesMock = mockDb.getCompetencies(student.id);
  const { competencies: sbCompetencies } = useCompetencies(student.id);
  const competencies = sbCompetencies && sbCompetencies.length > 0 ? sbCompetencies : competenciesMock;

  // -------- Lessons (Supabase first, mockDb fallback) ------------------
  const { lessons: sbLessons } = useLessonsForStudent(student.id);
  const lessons = sbLessons && sbLessons.length > 0
    ? sbLessons
    : mockDb.listLessonsForStudent(student.id);
  const recentLesson = lessons.find((l) => l.status === 'Completed') || lessons[0];

  // -------- Badges (Supabase first) ------------------------------------
  const { badges: sbBadges } = useBadges(student.id);
  const badges = useMemo(
    () => (sbBadges && sbBadges.length > 0
      ? sbBadges.map((b) => ({ key: b.badge_key, name: b.badge_name, description: b.description, earned_at: b.earned_at }))
      : mockDb_ext.getBadges(student.id)),
    [sbBadges, student.id, reloadKey],
  );

  // -------- Reflective logs (Supabase first) ---------------------------
  const { logs: sbReflections } = useReflectiveLogs(student.id);
  const reflections = useMemo(() => {
    if (sbReflections && sbReflections.length > 0) {
      return sbReflections.map((r) => ({
        id: r.id,
        student_id: r.student_id,
        lesson_id: r.lesson_id || '',
        // Combine the three fields into a single rendering line.
        text: [r.what_well, r.what_difficult, r.next_focus].filter(Boolean).join(' · ') || '',
        created_at: r.created_at,
      }));
    }
    return mockDb_ext.listReflections(student.id);
  }, [sbReflections, student.id, reloadKey]);

  const met = readiness.criteria.filter((c) => c.met).length;
  const total = readiness.criteria.length;
  const pct = Math.round((met / total) * 100);

  // -------- Mock test history (Supabase only — no mockDb equivalent) ---
  const { attempts: mockTestAttempts } = useMockTestAttempts(supabaseStudent?.id);
  const lastMockAttempt = mockTestAttempts[0];

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      setReloadKey((k) => k + 1);
      setRefreshing(false);
    }, 600);
  }, []);

  // -----------------------------------------------------------------------
  // Push notification registration + Smart-Gap waiting-list opt-in
  // -----------------------------------------------------------------------
  const [waiting, setWaiting] = useState(false);
  const [savingWaiting, setSavingWaiting] = useState(false);

  useEffect(() => {
    // Register the device's Expo push token against the signed-in auth user
    // so the backend can fan out Smart Gap broadcasts. No-op on web.
    registerExpoPushToken().catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    // Read waiting-list opt-in status whenever we know the Supabase student id.
    if (!supabaseStudent?.id) { setWaiting(false); return; }
    let cancelled = false;
    getWaitingListStatus(supabaseStudent.id)
      .then((v) => { if (!cancelled) setWaiting(v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [supabaseStudent?.id, reloadKey]);

  const toggleWaiting = async (next: boolean) => {
    if (!supabaseStudent) {
      Alert.alert(
        'Not linked yet',
        'Once your instructor links your account to Supabase, you can opt in here.',
      );
      return;
    }
    setSavingWaiting(true);
    setWaiting(next); // optimistic
    try {
      await setWaitingListStatus(supabaseStudent.id, supabaseStudent.school_id, next);
    } catch (e: any) {
      setWaiting(!next);
      Alert.alert('Could not save', e?.message || 'Please apply Migration 007 first.');
    } finally {
      setSavingWaiting(false);
    }
  };

  const saveReflection = async () => {
    if (reflectText.trim().length < 5) {
      Alert.alert('Please write a few words about your last lesson.');
      return;
    }
    setSaving(true);
    try {
      // If this student is Supabase-linked, persist live; otherwise mockDb.
      if (supabaseStudent) {
        await createReflectiveLog({
          student_id: supabaseStudent.id,
          lesson_id: recentLesson?.id,
          what_well: reflectText.trim(),
        });
      } else if (recentLesson) {
        mockDb_ext.addReflection(recentLesson.id, student.id, reflectText.trim());
      }
      setReflectText('');
      setReflectOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save your reflection.');
    } finally {
      setSaving(false);
    }
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
              <Text style={styles.mockSub}>
                {lastMockAttempt
                  ? `Last attempt: ${lastMockAttempt.passed ? 'PASS' : 'FAIL'} · ${new Date(lastMockAttempt.taken_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                  : 'Practise with the official DVSA mark sheet format'}
              </Text>
            </View>
            <ChevronRight size={22} color="#fff" />
          </Card>
        </TouchableOpacity>

        {/* DVSA Competency Tracker — Growth tier and above */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>DVSA Competency Tracker</Text>
        </View>
        {isPaidTier(user?.tier) ? (
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
        ) : (
          <LockedFeature
            title="Competency tracker locked"
            subtitle="Track progress against the DVSA syllabus — included from Growth tier (£14.99/mo). Ask your instructor to upgrade."
            testID="locked-competency-card"
          />
        )}

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

        {/* Smart Gap — opt in to waiting list for short-notice slot pings */}
        <Card style={{ gap: 10 }} testID="waiting-list-card">
          <View style={styles.row}>
            <Bell size={20} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Slot alerts</Text>
            <View style={{ flex: 1 }} />
            <Switch
              value={waiting}
              onValueChange={toggleWaiting}
              disabled={savingWaiting}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor="#fff"
              testID="switch-waiting-list"
            />
          </View>
          <Text style={styles.emptyText}>
            {waiting
              ? "You're on the list. We'll ping you the moment a cancellation frees up a slot."
              : 'Turn this on to get a push notification when a lesson cancellation creates a short-notice opening.'}
          </Text>
        </Card>

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
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={saveReflection}
          disabled={saving}
          testID="btn-save-reflection"
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save reflection</Text>}
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
