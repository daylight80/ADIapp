import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/AuthContext';
import { BottomNav } from '../src/BottomNav';
import { mockDb } from '../src/mockDb';
import { isPaidTier } from '../src/tiers';
import {
  useStudentByAuthId, useStudentByEmail, useCompetencies, useLessonsForStudent,
  useBadges, useReflectiveLogs, useMockTestAttempts, createReflectiveLog,
} from '../src/useSupabaseData';
import { DVSA_SYLLABUS } from '../src/supabaseDb';

/**
 * TRIAL — Student App home, from the same Claude Design handoff (23 Aug
 * 2026). Separate route; the live student-home-screen.tsx is untouched.
 *
 * Real "Driving readiness" criteria — the live screen's version is
 * Object.freeze()'d mockDb data, identical for every student regardless of
 * their actual progress. This version computes each criterion from real
 * data:
 *   - 25+ lessons  -> count of Completed lessons
 *   - Mock test    -> any mock_test_attempts row with passed = true
 *   - Theory       -> the 'theory_passed' badge (in-app PRACTICE test —
 *                     deliberately labelled that way, not "DVSA theory
 *                     test passed", since the app has no way to verify the
 *                     real external exam)
 *   - Manoeuvres   -> all 5 manoeuvre categories (parallel_park,
 *                     bay_park_forward/reverse, pull_up_right,
 *                     emergency_stop) at competency level 4+
 *   - Independent  -> the independent_driving category specifically at
 *                     level 4+ — DVSA_SYLLABUS already has this as its own
 *                     tracked category, so this isn't a guess
 *
 * All 5 criteria have genuine data behind them — none needed to be left
 * as an honest placeholder.
 */

const C = {
  pageBg: '#DCD6CA',
  surface: '#F5F2EC',
  border: '#E4DED2',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  primary: '#00539F',
  accent: '#FF6B00',
  ink: '#0F172A',
  warmBg: '#FFF7ED',
  warmBorder: '#FED7AA',
  warmText: '#C2410C',
};

const MANOEUVRE_KEYS = ['parallel_park', 'bay_park_forward', 'bay_park_reverse', 'pull_up_right', 'emergency_stop'];
const MIN_LESSONS = 25;
const READY_LEVEL = 4;

function initialsOf(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function StudentAppV2Screen() {
  const router = useRouter();
  const { user } = useAuth();

  const { student: sbStudentByAuth } = useStudentByAuthId(user?.id);
  const { student: sbStudentByEmail } = useStudentByEmail(!sbStudentByAuth ? user?.email : undefined);
  const supabaseStudent = sbStudentByAuth || sbStudentByEmail;
  const mockStudent = !user ? mockDb.getStudent('s2') : undefined;
  const student = supabaseStudent || mockStudent;
  const noRealLinkFound = !!user && !supabaseStudent && !mockStudent;

  const { competencies: sbCompetencies } = useCompetencies(supabaseStudent ? student?.id : undefined);
  const competencies = supabaseStudent ? (sbCompetencies || []) : (student ? mockDb.getCompetencies(student.id) : []);

  const { lessons: sbLessons } = useLessonsForStudent(supabaseStudent ? student?.id : undefined);
  const lessons = supabaseStudent ? (sbLessons || []) : (student ? mockDb.listLessonsForStudent(student.id) : []);

  const { badges } = useBadges(student?.id);
  const { logs: sbReflections } = useReflectiveLogs(supabaseStudent ? student?.id : undefined);
  const { attempts: mockTestAttempts } = useMockTestAttempts(supabaseStudent?.id);

  const [reflectOpen, setReflectOpen] = useState(false);
  const [moodEmoji, setMoodEmoji] = useState<string | null>(null);
  const [moodReason, setMoodReason] = useState('');
  const [understandingRating, setUnderstandingRating] = useState<number | null>(null);
  const [abilityRating, setAbilityRating] = useState<number | null>(null);
  const [reflectWell, setReflectWell] = useState('');
  const [reflectTricky, setReflectTricky] = useState('');
  const [reflectFocus, setReflectFocus] = useState('');
  const [saving, setSaving] = useState(false);
  const [slotAlerts, setSlotAlerts] = useState(true);

  const completedLessons = lessons.filter((l) => l.status === 'Completed');
  const recentLesson = completedLessons[0] || lessons[0];

  const levelByKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of competencies) map[c.category_key] = c.level;
    return map;
  }, [competencies]);

  const readiness = useMemo(() => {
    const hasMockPass = mockTestAttempts.some((a) => a.passed);
    const hasTheoryBadge = badges.some((b) => b.badge_key === 'theory_passed');
    const manoeuvresReady = MANOEUVRE_KEYS.every((k) => (levelByKey[k] || 0) >= READY_LEVEL);
    const independentReady = (levelByKey.independent_driving || 0) >= READY_LEVEL;
    const criteria = [
      { key: 'lessons', label: `Minimum ${MIN_LESSONS} lessons`, met: completedLessons.length >= MIN_LESSONS },
      { key: 'mock_test', label: 'Mock test passed', met: hasMockPass },
      { key: 'theory', label: 'Theory practice passed (in-app)', met: hasTheoryBadge },
      { key: 'manoeuvres', label: 'All manoeuvres at Level 4+', met: manoeuvresReady },
      { key: 'independent', label: 'Independent driving (Level 4+)', met: independentReady },
    ];
    const met = criteria.filter((c) => c.met).length;
    return { criteria, met, total: criteria.length, pct: Math.round((met / criteria.length) * 100) };
  }, [completedLessons.length, mockTestAttempts, badges, levelByKey]);

  const handleSaveReflection = async () => {
    if (reflectWell.trim().length < 5) return;
    setSaving(true);
    try {
      if (supabaseStudent) {
        await createReflectiveLog({
          student_id: supabaseStudent.id,
          lesson_id: recentLesson?.id,
          what_well: reflectWell.trim(),
          what_difficult: reflectTricky.trim() || undefined,
          next_focus: reflectFocus.trim() || undefined,
          mood_emoji: moodEmoji || undefined,
          mood_reason: moodReason.trim() || undefined,
          understanding_rating: understandingRating ?? undefined,
          ability_rating: abilityRating ?? undefined,
        });
      }
      setReflectOpen(false);
      setMoodEmoji(null); setMoodReason(''); setUnderstandingRating(null); setAbilityRating(null);
      setReflectWell(''); setReflectTricky(''); setReflectFocus('');
    } finally {
      setSaving(false);
    }
  };

  if (noRealLinkFound) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }}>
          <Text style={s.emptyTitle}>We couldn&apos;t find your student profile</Text>
          <Text style={s.emptySub}>Your account isn&apos;t linked to a student record yet. Please contact your instructor.</Text>
        </View>
        <BottomNav role="student" />
      </SafeAreaView>
    );
  }

  if (!student) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const paid = isPaidTier(user?.tier);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.surface}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View>
              <Text style={s.eyebrow}>Hello</Text>
              <Text style={s.greeting} numberOfLines={1}>{(student.name || 'Student').split(' ')[0]}</Text>
            </View>
            <View style={s.avatar}><Text style={s.avatarText}>{initialsOf(student.name || 'S')}</Text></View>
          </View>

          <View style={s.readyCard}>
            <View style={s.readyInner}>
              <Text style={s.readyLabel}>Driving readiness</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9, marginTop: 8 }}>
                <Text style={s.readyPct}>{readiness.pct}</Text>
                <Text style={s.readyPctSign}>%</Text>
                <Text style={s.readyLine} numberOfLines={1}>{readiness.met}/{readiness.total} criteria met</Text>
              </View>
              <View style={s.readyTrack}>
                <View style={[s.readyFill, { width: `${readiness.pct}%` }]} />
              </View>
              <View style={{ marginTop: 13, gap: 7 }}>
                {readiness.criteria.map((c) => (
                  <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                    <Text style={[s.criteriaMark, { color: c.met ? '#6EE7B7' : 'rgba(255,255,255,.35)' }]}>{c.met ? '✓' : '○'}</Text>
                    <Text style={[s.criteriaLabel, { color: c.met ? '#fff' : 'rgba(255,255,255,.55)' }]}>{c.label}</Text>
                  </View>
                ))}
              </View>
              <View style={s.readyNudgeWrap}>
                <Text style={s.readyNudge}>
                  {readiness.total - readiness.met === 0
                    ? 'All criteria met — ask your instructor about booking your test!'
                    : `${readiness.total - readiness.met} more to go before your instructor recommends a test date.`}
                </Text>
              </View>
            </View>
          </View>

          <TouchableOpacity style={s.mockCta} onPress={() => router.push('/dl25-mock-test-screen' as any)} testID="v2-student-mock-cta">
            <View style={s.mockIcon}><Text style={s.mockIconText}>DL25</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.mockTitle}>Mock test</Text>
              <Text style={s.mockSub}>
                {mockTestAttempts.length > 0 ? `${mockTestAttempts.length} attempt${mockTestAttempts.length === 1 ? '' : 's'} so far` : 'Take a full DVSA-style mock'}
              </Text>
            </View>
            <Text style={s.chev}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.smtmCard} onPress={() => router.push('/show-me-tell-me-screen' as any)} testID="v2-student-smtm">
            <View style={s.smtmIcon}><Text style={s.smtmIconText}>21</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.smtmTitle}>Show me, tell me</Text>
              <Text style={s.smtmSub}>All 21 official DVSA vehicle safety questions</Text>
            </View>
            <Text style={s.chevMuted}>›</Text>
          </TouchableOpacity>

          {recentLesson && (
            <View style={{ marginHorizontal: 20, marginTop: 22 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Text style={s.sectionLabel}>Last lesson</Text>
                <Text style={s.sectionMeta}>
                  {new Date(`${recentLesson.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <View style={s.feedbackCard}>
                <Text style={s.feedbackTopic}>{recentLesson.topic || recentLesson.lesson_type}</Text>
                {!!recentLesson.notes && <Text style={s.feedbackNote}>&ldquo;{recentLesson.notes}&rdquo;</Text>}
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
                  {!!recentLesson.grade && <Text style={s.gradeChip}>Grade {recentLesson.grade}</Text>}
                  <Text style={s.faultsChip}>
                    {(recentLesson.driving_faults || 0) + (recentLesson.serious_faults || 0)} faults
                  </Text>
                </View>
              </View>
            </View>
          )}

          <View style={{ marginHorizontal: 20, marginTop: 22 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={s.sectionLabel}>DVSA syllabus</Text>
              <Text style={s.sectionMeta}>{competencies.length}/{DVSA_SYLLABUS.length} started</Text>
            </View>
            {!paid ? (
              <View style={s.lockedCard}>
                <View style={s.lockedIcon}><Text style={{ fontSize: 17, color: C.warmText }}>✳</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.lockedTitle}>Tracker locked</Text>
                  <Text style={s.lockedSub}>Included from Growth tier. Ask your instructor to upgrade.</Text>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
                {competencies.slice(0, 12).map((c) => (
                  <TouchableOpacity
                    key={c.category_key}
                    style={s.compCard}
                    onPress={() => router.push({ pathname: '/competency-detail-screen', params: { key: c.category_key, studentId: student.id } } as any)}
                    testID={`v2-comp-${c.category_key}`}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={s.compName} numberOfLines={1}>{c.category_name}</Text>
                      <Text style={[s.compLevel, c.level >= READY_LEVEL && { color: '#047857' }]}>L{c.level}</Text>
                    </View>
                    <View style={s.compTrack}>
                      <View style={[s.compFill, { width: `${c.progress}%`, backgroundColor: c.level >= READY_LEVEL ? '#10B981' : C.primary }]} />
                    </View>
                    <Text style={s.compPct}>{c.progress}%</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {badges.length > 0 && (
            <View style={{ marginHorizontal: 20, marginTop: 22 }}>
              <Text style={s.sectionLabel}>Badges earned</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                {badges.map((b) => (
                  <View key={b.id} style={s.badgeChip}>
                    <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: C.accent }} />
                    <Text style={s.badgeChipText}>{b.badge_name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={s.alertsCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.alertsTitle}>Slot alerts</Text>
                <Text style={s.alertsSub}>Short-notice cancellations</Text>
              </View>
              <Switch
                value={slotAlerts}
                onValueChange={setSlotAlerts}
                trackColor={{ true: C.primary, false: '#D6CFC1' }}
                testID="v2-slot-alerts-toggle"
              />
            </View>
            <Text style={s.alertsCopy}>
              {slotAlerts ? "You'll be notified if an earlier slot opens up with your instructor." : "You won't be notified about newly available slots."}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 9, marginHorizontal: 20, marginTop: 12 }}>
            <TouchableOpacity style={[s.actionBtn, { backgroundColor: C.primary }]} onPress={() => router.push('/theory-test-screen' as any)} testID="v2-student-theory">
              <Text style={s.actionBtnText}>Theory test</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#047857' }]} onPress={() => router.push('/wallet-screen' as any)} testID="v2-student-wallet">
              <Text style={s.actionBtnText}>Wallet</Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginHorizontal: 20, marginTop: 22 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={s.sectionLabel}>Reflective log</Text>
              <TouchableOpacity style={s.addBtn} onPress={() => setReflectOpen(true)} testID="v2-add-reflection">
                <Text style={s.addBtnText}>+ Add</Text>
              </TouchableOpacity>
            </View>

            {(sbReflections || []).length === 0 ? (
              <View style={s.emptyReflect}>
                <Text style={s.emptyReflectText}>Reflect on what you learnt — a key part of modern learner-centred driving instruction.</Text>
              </View>
            ) : (
              <View style={{ marginTop: 9, gap: 8 }}>
                {(sbReflections || []).slice(0, 3).map((r) => (
                  <View key={r.id} style={s.reflectCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {!!r.mood_emoji && <Text style={{ fontSize: 16 }}>{r.mood_emoji}</Text>}
                      <Text style={s.reflectDate}>{new Date(r.created_at).toLocaleDateString('en-GB')}</Text>
                    </View>
                    <Text style={s.reflectText}>&ldquo;{r.what_well}&rdquo;</Text>
                    {(r.understanding_rating || r.ability_rating) ? (
                      <Text style={s.reflectRatings}>
                        {r.understanding_rating ? `Understanding ${r.understanding_rating}/10` : ''}
                        {r.understanding_rating && r.ability_rating ? '  ·  ' : ''}
                        {r.ability_rating ? `Ability ${r.ability_rating}/10` : ''}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        <BottomNav role="student" />
      </View>

      {reflectOpen && (
        <View style={s.sheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setReflectOpen(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Reflective log</Text>
            {!!recentLesson && (
              <Text style={s.sheetSub}>After {recentLesson.topic || recentLesson.lesson_type}</Text>
            )}
            <ScrollView style={{ flex: 1, marginTop: 14 }} keyboardShouldPersistTaps="handled">
              <Text style={s.qLabel}>Which emoji best reflects your mood at the end of this lesson?</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 }}>
                {['😞', '😕', '😐', '🙂', '😄'].map((e) => (
                  <TouchableOpacity
                    key={e}
                    style={[s.moodBtn, moodEmoji === e && s.moodBtnActive]}
                    onPress={() => setMoodEmoji(e)}
                    testID={`v2-mood-${e}`}
                  >
                    <Text style={{ fontSize: 22 }}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.qLabel, { marginTop: 16 }]}>Rate your understanding following this lesson</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <TouchableOpacity
                    key={n}
                    style={[s.numBtn, understandingRating === n && s.numBtnActive]}
                    onPress={() => setUnderstandingRating(n)}
                    testID={`v2-understanding-${n}`}
                  >
                    <Text style={[s.numBtnText, understandingRating === n && s.numBtnTextActive]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.qLabel, { marginTop: 16 }]}>Rate your ability following this lesson</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <TouchableOpacity
                    key={n}
                    style={[s.numBtn, abilityRating === n && s.numBtnActive]}
                    onPress={() => setAbilityRating(n)}
                    testID={`v2-ability-${n}`}
                  >
                    <Text style={[s.numBtnText, abilityRating === n && s.numBtnTextActive]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.qLabel, { marginTop: 16 }]}>What went well during this lesson?</Text>
              <TextInput
                style={s.textarea}
                value={reflectWell}
                onChangeText={setReflectWell}
                placeholder="Today I worked on roundabouts. I felt more confident with signalling…"
                placeholderTextColor={C.textMuted}
                multiline
                testID="v2-input-well"
              />

              <Text style={[s.qLabel, { marginTop: 14 }]}>What was tricky? <Text style={{ fontWeight: '400', color: C.textMuted2 }}>(optional)</Text></Text>
              <TextInput
                style={s.smallInput}
                value={reflectTricky}
                onChangeText={setReflectTricky}
                placeholder="Observation when exiting the roundabout…"
                placeholderTextColor={C.textMuted}
                testID="v2-input-tricky"
              />

              <Text style={[s.qLabel, { marginTop: 14 }]}>Focus for next time? <Text style={{ fontWeight: '400', color: C.textMuted2 }}>(optional)</Text></Text>
              <TextInput
                style={s.smallInput}
                value={reflectFocus}
                onChangeText={setReflectFocus}
                placeholder="Practise mirror checks before signalling…"
                placeholderTextColor={C.textMuted}
                testID="v2-input-focus"
              />
              <View style={{ height: 20 }} />
            </ScrollView>

            <View style={s.sheetFooter}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setReflectOpen(false)} testID="v2-reflect-cancel">
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSaveReflection}
                disabled={saving}
                testID="v2-reflect-save"
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save reflection</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.pageBg },
  surface: { flex: 1, backgroundColor: C.surface },

  eyebrow: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, letterSpacing: 1.7, textTransform: 'uppercase', color: C.textMuted },
  greeting: { fontFamily: 'Archivo_800ExtraBold', fontSize: 30, letterSpacing: -0.6, color: C.text, marginTop: 1 },
  avatar: { width: 46, height: 46, borderRadius: 999, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: '#fff' },

  readyCard: { marginHorizontal: 20, marginTop: 16, borderRadius: 22, backgroundColor: C.primary, padding: 6, shadowColor: '#003A6F', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.35, shadowRadius: 28, elevation: 6 },
  readyInner: { borderWidth: 2, borderColor: 'rgba(255,255,255,.5)', borderRadius: 17, padding: 16 },
  readyLabel: { fontFamily: 'Archivo_800ExtraBold', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#FF9A4D' },
  readyPct: { fontFamily: 'Archivo_800ExtraBold', fontSize: 54, letterSpacing: -1.7, color: '#fff' },
  readyPctSign: { fontFamily: 'Archivo_700Bold', fontSize: 20, color: 'rgba(255,255,255,.6)', paddingBottom: 6 },
  readyLine: { flex: 1, textAlign: 'right', fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: 'rgba(255,255,255,.78)', paddingBottom: 7 },
  readyTrack: { height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,.22)', marginTop: 13, overflow: 'hidden' },
  readyFill: { height: '100%', backgroundColor: '#FF9A4D', borderRadius: 999 },
  criteriaMark: { fontFamily: 'Barlow_700Bold', fontSize: 14, width: 16 },
  criteriaLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 13.5, flex: 1 },
  readyNudgeWrap: { marginTop: 15, paddingTop: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.22)' },
  readyNudge: { fontFamily: 'Barlow_500Medium', fontSize: 13, lineHeight: 18.5, color: 'rgba(255,255,255,.8)' },

  mockCta: { marginHorizontal: 20, marginTop: 14, borderRadius: 18, backgroundColor: C.accent, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  mockIcon: { width: 52, height: 52, borderRadius: 15, backgroundColor: 'rgba(255,255,255,.22)', alignItems: 'center', justifyContent: 'center' },
  mockIconText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 15, color: '#fff' },
  mockTitle: { fontFamily: 'Archivo_700Bold', fontSize: 17, color: '#fff' },
  mockSub: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: 'rgba(255,255,255,.85)', marginTop: 1 },
  chev: { fontFamily: 'Barlow_700Bold', fontSize: 20, color: '#fff' },

  smtmCard: { marginHorizontal: 20, marginTop: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 13 },
  smtmIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#E5F0FA', alignItems: 'center', justifyContent: 'center' },
  smtmIconText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 13, color: C.primary },
  smtmTitle: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },
  smtmSub: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.textMuted },
  chevMuted: { fontFamily: 'Barlow_700Bold', fontSize: 18, color: '#A69C8B' },

  sectionLabel: { fontFamily: 'Barlow_700Bold', fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: C.textMuted },
  sectionMeta: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: C.textMuted },

  feedbackCard: { marginTop: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 15 },
  feedbackTopic: { fontFamily: 'Archivo_700Bold', fontSize: 16, color: C.text },
  feedbackNote: { fontFamily: 'Barlow_400Regular', fontSize: 14, lineHeight: 20, color: C.textMuted2, marginTop: 8 },
  gradeChip: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: '#fff', backgroundColor: C.primary, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 5, overflow: 'hidden' },
  faultsChip: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: '#92400E', backgroundColor: '#FEF3C7', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 5, overflow: 'hidden' },

  lockedCard: { marginTop: 9, backgroundColor: C.warmBg, borderWidth: 1, borderColor: C.warmBorder, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13 },
  lockedIcon: { width: 42, height: 42, borderRadius: 999, backgroundColor: C.warmBorder, alignItems: 'center', justifyContent: 'center' },
  lockedTitle: { fontFamily: 'Archivo_700Bold', fontSize: 14.5, color: C.text },
  lockedSub: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 17, color: C.textMuted, marginTop: 1 },

  compCard: { width: '48%', backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 11, gap: 8 },
  compName: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: C.text, flex: 1 },
  compLevel: { fontFamily: 'Barlow_700Bold', fontSize: 11, color: C.textMuted },
  compTrack: { height: 5, borderRadius: 999, backgroundColor: '#EDE8DE', overflow: 'hidden' },
  compFill: { height: '100%' },
  compPct: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, color: C.textMuted2 },

  badgeChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: C.warmBg, borderWidth: 1, borderColor: C.accent, borderRadius: 999 },
  badgeChipText: { fontFamily: 'Barlow_700Bold', fontSize: 13, color: C.warmText },

  alertsCard: { marginHorizontal: 20, marginTop: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14 },
  alertsTitle: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },
  alertsSub: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.textMuted, marginTop: 1 },
  alertsCopy: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 18, color: C.textMuted, marginTop: 9 },

  actionBtn: { flex: 1, minHeight: 58, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  actionBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 14.5, color: '#fff' },

  addBtn: { height: 32, paddingHorizontal: 13, borderRadius: 9, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: '#fff' },
  emptyReflect: { marginTop: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16 },
  emptyReflectText: { fontFamily: 'Barlow_400Regular', fontSize: 13.5, lineHeight: 19.5, color: C.textMuted },
  reflectCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderLeftWidth: 4, borderLeftColor: C.primary, borderRadius: 16, padding: 13 },
  reflectDate: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: C.textMuted2 },
  reflectText: { fontFamily: 'Barlow_400Regular', fontSize: 13.5, lineHeight: 19, color: C.text, marginTop: 7 },
  reflectRatings: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: C.primary, marginTop: 7 },

  emptyTitle: { fontFamily: 'Archivo_700Bold', fontSize: 18, color: C.text, textAlign: 'center' },
  emptySub: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: C.textMuted, textAlign: 'center' },

  sheetOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 70, backgroundColor: C.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 10, paddingHorizontal: 20 },
  sheetHandle: { width: 42, height: 4, borderRadius: 999, backgroundColor: '#D6CFC1', alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontFamily: 'Archivo_800ExtraBold', fontSize: 24, letterSpacing: -0.4, color: C.text },
  sheetSub: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: C.textMuted, marginTop: 2 },
  qLabel: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: C.text },
  moodBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.border, backgroundColor: '#fff' },
  moodBtnActive: { borderColor: C.primary, backgroundColor: '#E5F0FA' },
  numBtn: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: '#fff' },
  numBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  numBtnText: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.text },
  numBtnTextActive: { color: '#fff' },
  textarea: { width: '100%', minHeight: 96, marginTop: 9, padding: 13, borderWidth: 1, borderColor: C.border, borderRadius: 13, backgroundColor: '#fff', fontFamily: 'Barlow_400Regular', fontSize: 14, color: C.text, textAlignVertical: 'top' },
  smallInput: { width: '100%', minHeight: 46, marginTop: 9, paddingHorizontal: 13, borderWidth: 1, borderColor: C.border, borderRadius: 13, backgroundColor: '#fff', fontFamily: 'Barlow_400Regular', fontSize: 14, color: C.text },
  sheetFooter: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.border, flexDirection: 'row', gap: 9 },
  cancelBtn: { width: 96, minHeight: 52, borderWidth: 1, borderColor: C.border, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: C.textMuted },
  saveBtn: { flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: '#fff' },
});
