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

// A compact 1-10 tappable rating row, used twice in the reflection form
// (understanding and ability, rated independently — a student can
// understand a concept without yet feeling confident performing it).
function RatingScale({ value, onChange, testIDPrefix }: { value: number | null; onChange: (n: number) => void; testIDPrefix: string }) {
  return (
    <View style={styles.ratingRow}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <TouchableOpacity
          key={n}
          style={[styles.ratingOption, value === n && styles.ratingOptionSelected]}
          onPress={() => onChange(n)}
          testID={`${testIDPrefix}-rating-${n}`}
        >
          <Text style={[styles.ratingOptionText, value === n && styles.ratingOptionTextSelected]}>{n}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function StudentHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [reflectText, setReflectText] = useState('');
  const [reflectDifficult, setReflectDifficult] = useState('');
  const [reflectNextFocus, setReflectNextFocus] = useState('');
  const [moodEmoji, setMoodEmoji] = useState<string | null>(null);
  const [moodReason, setMoodReason] = useState('');
  const [understandingRating, setUnderstandingRating] = useState<number | null>(null);
  const [abilityRating, setAbilityRating] = useState<number | null>(null);
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

  // A real logged-in user (user exists) whose own Supabase student record
  // can't be found is a genuine data-linking problem, not a reason to show
  // them a hardcoded demo student's name/progress as if it were their own
  // — that's actively misleading, not "graceful" fallback. Mock data is
  // only appropriate when there's truly no session at all (offline/preview
  // mode), which is what !user actually signals here.
  const mockStudentByEmail = user?.email ? mockDb.getStudentByEmail(user.email) : undefined;
  const mockStudent = !user ? (mockStudentByEmail || mockDb.getStudent('s2')!) : undefined;
  const noRealLinkFound = !!user && !supabaseStudent && !mockStudent;

  // Unified student card used by the UI. Prefer Supabase fields when present.
  const student = supabaseStudent
    ? {
        id: supabaseStudent.id,
        name: supabaseStudent.name,
        status: supabaseStudent.status,
        progress: supabaseStudent.progress ?? 0,
        test_date: supabaseStudent.test_date,
      }
    : mockStudent
      ? {
          id: mockStudent.id,
          name: mockStudent.name,
          status: mockStudent.status,
          progress: mockStudent.progress,
          test_date: mockStudent.test_date,
        }
      // Genuinely no link found for a real session — an honest empty
      // shell rather than a fabricated identity. The screen below shows a
      // clear "not linked" message when noRealLinkFound is true.
      : { id: '', name: user?.name || 'Student', status: 'New' as const, progress: 0, test_date: undefined };

  // -------- Competencies (Supabase first, mockDb fallback only in true no-session preview mode) --------
  const competenciesMock = mockStudent ? mockDb.getCompetencies(student.id) : [];
  const { competencies: sbCompetencies } = useCompetencies(supabaseStudent ? student.id : undefined);
  const competencies = supabaseStudent ? (sbCompetencies || []) : competenciesMock;

  // -------- Lessons (Supabase first, mockDb fallback only in true no-session preview mode) --------
  const { lessons: sbLessons } = useLessonsForStudent(supabaseStudent ? student.id : undefined);
  const lessons = supabaseStudent
    ? (sbLessons || [])
    : (mockStudent ? mockDb.listLessonsForStudent(student.id) : []);
  const recentLesson = lessons.find((l) => l.status === 'Completed') || lessons[0];

  // -------- Badges (Supabase first) ------------------------------------
  const { badges: sbBadges } = useBadges(student.id);
  const badges = useMemo(
    () => (sbBadges && sbBadges.length > 0
      ? sbBadges.map((b) => ({ key: b.badge_key, name: b.badge_name, description: b.description, earned_at: b.earned_at }))
      : mockDb_ext.getBadges(student.id)),
    [sbBadges, student.id, reloadKey],
  );

  // -------- Reflective logs (Supabase first, mock only in true no-session preview mode) --------
  const { logs: sbReflections } = useReflectiveLogs(supabaseStudent ? student.id : undefined);
  const reflections = useMemo(() => {
    if (supabaseStudent) {
      return (sbReflections || []).map((r) => ({
        id: r.id,
        student_id: r.student_id,
        lesson_id: r.lesson_id || '',
        text: [r.what_well, r.what_difficult, r.next_focus].filter(Boolean).join(' · ') || '',
        mood_emoji: r.mood_emoji,
        understanding_rating: r.understanding_rating,
        ability_rating: r.ability_rating,
        created_at: r.created_at,
      }));
    }
    return mockStudent ? mockDb_ext.listReflections(student.id) : [];
  }, [supabaseStudent, sbReflections, student.id, reloadKey]);

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
      Alert.alert('Please write a few words about what went well.');
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
          what_difficult: reflectDifficult.trim() || undefined,
          next_focus: reflectNextFocus.trim() || undefined,
          mood_emoji: moodEmoji || undefined,
          mood_reason: moodReason.trim() || undefined,
          understanding_rating: understandingRating ?? undefined,
          ability_rating: abilityRating ?? undefined,
        });
      } else if (recentLesson) {
        mockDb_ext.addReflection(recentLesson.id, student.id, reflectText.trim());
      }
      setReflectText('');
      setReflectDifficult('');
      setReflectNextFocus('');
      setMoodEmoji(null);
      setMoodReason('');
      setUnderstandingRating(null);
      setAbilityRating(null);
      setReflectOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save your reflection.');
    } finally {
      setSaving(false);
    }
  };

  if (noRealLinkFound) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          <Text style={{ ...theme.font.h2, textAlign: 'center' }}>We couldn't find your student profile</Text>
          <Text style={{ color: theme.colors.textMuted, textAlign: 'center' }}>
            Your account isn't linked to a student record yet. Please contact your instructor.
          </Text>
        </View>
        <BottomNav />
      </SafeAreaView>
    );
  }

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

        {/* Show Me, Tell Me reference */}
        <TouchableOpacity onPress={() => router.push('/show-me-tell-me-screen')} testID="show-me-tell-me-widget">
          <Card style={styles.smtmCard}>
            <View style={styles.smtmIcon}>
              <BookOpen size={22} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.smtmTitle}>Show Me, Tell Me</Text>
              <Text style={styles.smtmSub}>All 21 official DVSA vehicle safety questions</Text>
            </View>
            <ChevronRight size={20} color={theme.colors.textMuted} />
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
                {recentLesson.grade && <Badge label={`Grade ${recentLesson.grade}/5`} bg={theme.colors.successLight} color={theme.colors.success} />}
                <Badge
                  label={`${recentLesson.driving_faults + recentLesson.serious_faults} faults`}
                  bg={theme.colors.warningLight}
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
                  <Trophy size={13} color={theme.colors.accent} />
                  <Text style={styles.badgeChipText}>{b.name}</Text>
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
            reflections.slice(0, 3).map((r: any) => (
              <View key={r.id} style={styles.reflectItem} testID={`reflection-${r.id}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {r.mood_emoji && <Text style={{ fontSize: 16 }}>{r.mood_emoji}</Text>}
                  <Text style={styles.reflectDate}>{new Date(r.created_at).toLocaleDateString('en-GB')}</Text>
                </View>
                <Text style={styles.reflectText}>"{r.text}"</Text>
                {(r.understanding_rating || r.ability_rating) && (
                  <Text style={styles.reflectRatings}>
                    {r.understanding_rating ? `Understanding ${r.understanding_rating}/10` : ''}
                    {r.understanding_rating && r.ability_rating ? '  ·  ' : ''}
                    {r.ability_rating ? `Ability ${r.ability_rating}/10` : ''}
                  </Text>
                )}
              </View>
            ))
          )}
        </Card>

        <View style={{ height: 24 }} />
      </ScrollView>

      <BottomNav role="student" />

      <BottomSheet visible={reflectOpen} onClose={() => setReflectOpen(false)} title="Reflective log" testID="sheet-reflection">
        <Text style={styles.reflectQuestionLabel}>Which emoji best reflects your mood at the end of this lesson?</Text>
        <View style={styles.moodRow}>
          {['😞', '😕', '😐', '🙂', '😄'].map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={[styles.moodOption, moodEmoji === emoji && styles.moodOptionSelected]}
              onPress={() => setMoodEmoji(emoji)}
              testID={`mood-${emoji}`}
            >
              <Text style={{ fontSize: 26 }}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {moodEmoji && (
          <TextInput
            style={styles.reflectSmallInput}
            value={moodReason}
            onChangeText={setMoodReason}
            placeholder="Why that emoji? (optional)"
            placeholderTextColor={theme.colors.textMuted}
            testID="input-mood-reason"
          />
        )}

        <Text style={[styles.reflectQuestionLabel, { marginTop: 14 }]}>Rate your understanding following this lesson</Text>
        <RatingScale value={understandingRating} onChange={setUnderstandingRating} testIDPrefix="understanding" />

        <Text style={[styles.reflectQuestionLabel, { marginTop: 14 }]}>Rate your ability following this lesson</Text>
        <RatingScale value={abilityRating} onChange={setAbilityRating} testIDPrefix="ability" />

        <Text style={[styles.reflectQuestionLabel, { marginTop: 14 }]}>What went well during this lesson?</Text>
        <TextInput
          style={styles.reflectInput}
          value={reflectText}
          onChangeText={setReflectText}
          placeholder="Today I worked on roundabouts. I felt more confident with signalling…"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          textAlignVertical="top"
          testID="input-reflection"
        />

        <Text style={[styles.reflectQuestionLabel, { marginTop: 14 }]}>What was tricky? (optional)</Text>
        <TextInput
          style={styles.reflectSmallInput}
          value={reflectDifficult}
          onChangeText={setReflectDifficult}
          placeholder="Observation when exiting the roundabout…"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-reflection-difficult"
        />

        <Text style={[styles.reflectQuestionLabel, { marginTop: 14 }]}>Focus for next time? (optional)</Text>
        <TextInput
          style={styles.reflectSmallInput}
          value={reflectNextFocus}
          onChangeText={setReflectNextFocus}
          placeholder="Practise mirror checks before signalling…"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-reflection-next-focus"
        />

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }, { marginTop: 16 }]}
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
  smtmCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  smtmIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  smtmTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 15 },
  smtmSub: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
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
  badgeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.lockedBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.accent },
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
  reflectRatings: { fontSize: 12, color: theme.colors.primary, fontWeight: '600', marginTop: 4 },
  hint: { color: theme.colors.textMuted, marginBottom: 12 },
  reflectInput: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, minHeight: 120, backgroundColor: theme.colors.background, fontSize: 15 },
  reflectSmallInput: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: theme.colors.background, fontSize: 14, marginTop: 6 },
  reflectQuestionLabel: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  moodRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  moodOption: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: theme.colors.border, backgroundColor: theme.colors.background,
  },
  moodOptionSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.lockedBg },
  ratingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  ratingOption: {
    width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background,
  },
  ratingOptionSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  ratingOptionText: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  ratingOptionTextSelected: { color: '#fff' },
  saveBtn: { marginTop: 12, backgroundColor: theme.colors.primary, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
