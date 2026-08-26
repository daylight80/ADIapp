import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/AuthContext';
import { BottomNav } from '../src/BottomNav';
import { LessonToolsSheet } from '../src/LessonToolsSheet';
import { Lesson } from '../src/mockDb';
import {
  useStudents, useTodayLessons, useInstructorEarnings,
  useInstructorTestOutcomes, useCompetencyPatterns,
} from '../src/useSupabaseData';
import { computeTestKpis } from '../src/supabaseDb';
import { colorForLessonType } from '../src/diary/lessonTypes';
import { isPaidTier, tierById, studentUsageUrgency, studentUsageMessage } from '../src/tiers';
import { OpenInMapsButton } from '../src/OpenInMapsButton';
import { ContactsImportBanner } from '../src/ContactsImportBanner';
import { Crown, ChevronRight, Users, CalendarDays, Receipt } from 'lucide-react-native';
import { usePendingSyncCount } from '../src/offlineSync';

/**
 * Instructor Home — redesigned visual direction from the Claude Design
 * handoff (23 Aug 2026), promoted to live on 24 Aug 2026 after review as
 * home-v2-screen. This is now the real, live home screen.
 *
 * Wired to REAL data throughout — the previous version of this screen
 * called mockDb.getKPIs(), getMTDStats(), listTodayLessons() and
 * getEarningsByMonth(), meaning student counts, month-to-date earnings,
 * today's lessons and the earnings chart were all hardcoded demo numbers,
 * not the signed-in instructor's actual figures. useTodayLessons and
 * useInstructorEarnings were added earlier this session specifically to
 * fix this.
 *
 * Three real features ported in as part of promoting this to live (24 Aug
 * 2026) — none of these were in the original v2 trial, since the design
 * never covered them:
 *   - ContactsImportBanner — same auto-hide behaviour as before (dismissed
 *     server-side, or once the instructor has 3+ students)
 *   - The Starter-tier upgrade banner, escalating to a danger colour once
 *     the student limit is actually reached — real urgency, not cosmetic
 *   - The Students / Diary / Receipts quick-actions row
 * All three use the TOTAL student count (students.length), matching
 * canAddStudent's own logic — the trial's kpis object only tracks
 * active/testReady/waitlist counts, which would have undercounted against
 * the tier limit (a "New" or "Passed" student still occupies a seat).
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
  success: '#10B981',
  warmCard: '#FFF7ED',
  warmBorder: '#FED7AA',
  warmText: '#C2410C',
};

const DAY_START = 450; // 07:30
const DAY_END = 1200;  // 20:00
const SPAN = DAY_END - DAY_START;

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fmt(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}
function initialsOf(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function InstructorHomeV2Screen() {
  const pendingSyncCount = usePendingSyncCount();
  const router = useRouter();
  const { user } = useAuth();
  const [selId, setSelId] = useState<string | null>(null);
  const [detailLesson, setDetailLesson] = useState<Lesson | null>(null);

  const { lessons: todayLessons, loading: lessonsLoading } = useTodayLessons();
  const { students } = useStudents();
  const { mtdEarned, mtdUnpaid, mtdLessonCount, byMonth } = useInstructorEarnings();
  const { rows: testOutcomes } = useInstructorTestOutcomes();
  const studentIds = useMemo(() => students.map((s) => s.id), [students]);
  const { patterns } = useCompetencyPatterns(studentIds);
  const testKpis = computeTestKpis(testOutcomes);

  const tier = tierById(user?.tier);
  const paid = isPaidTier(user?.tier);

  const sorted = useMemo(
    () => [...todayLessons].sort((a, b) => toMin(a.start_time) - toMin(b.start_time)),
    [todayLessons],
  );
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nextLesson = sorted.find((l) => toMin(l.end_time) >= nowMin && l.status !== 'Cancelled');
  const sel = sorted.find((l) => l.id === selId) || nextLesson || sorted[0];

  const studentName = (id: string) => students.find((s) => s.id === id)?.name || 'Student';
  const remaining = sorted.filter((l) => toMin(l.end_time) >= nowMin && l.status !== 'Cancelled');
  const remainingMins = remaining.reduce((sum, l) => sum + (toMin(l.end_time) - toMin(l.start_time)), 0);

  const kpis = useMemo(() => ({
    active: students.filter((s) => s.status === 'Active').length,
    testReady: students.filter((s) => s.status === 'Test Ready').length,
    waitlist: students.filter((s) => s.status === 'Waitlist').length,
  }), [students]);

  const maxBar = Math.max(1, ...byMonth.map((b) => b.value));

  return (
    <SafeAreaView style={s.outer} edges={['top']}>
      <View style={s.surface}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110 }}>
          {/* Header */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.eyebrow}>
                {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              </Text>
              <Text style={s.greeting} numberOfLines={1}>{user?.name || 'Instructor'}</Text>
            </View>
            <View style={s.tierPill}>
              <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: C.accent }} />
              <Text style={s.tierPillText}>{tier?.name || 'Starter'}</Text>
            </View>
          </View>

          {/* Contacts import nudge — auto-hides server-side once dismissed
              or once the instructor has 3+ students. */}
          <View style={{ marginHorizontal: 20, marginTop: 12 }}>
            <ContactsImportBanner studentCount={students.length} isInstructor />
          </View>

          {/* Upgrade banner (Starter tier only) — real urgency, not
              cosmetic: escalates to a danger colour once the student
              limit is actually reached. */}
          {!paid && (() => {
            const limit = tierById(user?.tier).student_limit;
            const urgency = studentUsageUrgency(students.length, limit);
            return (
              <TouchableOpacity
                style={[s.upgradeBanner, urgency === 'critical' && { backgroundColor: '#B91C1C' }]}
                onPress={() => router.push('/pricing-screen' as any)}
                testID="v2-upgrade-banner"
                activeOpacity={0.9}
              >
                <View style={s.upgradeIcon}><Crown size={18} color="#fff" /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.upgradeTitle}>
                    {urgency === 'critical' ? "You've reached your limit" : `Upgrade to ${tierById('growth').name}`}
                  </Text>
                  <Text style={s.upgradeSub} numberOfLines={1}>
                    {students.length}/{limit} students used · {studentUsageMessage(students.length, limit)}
                  </Text>
                </View>
                <ChevronRight size={18} color="#fff" />
              </TouchableOpacity>
            );
          })()}

          {/* Quick actions */}
          <View style={{ flexDirection: 'row', gap: 9, marginHorizontal: 20, marginTop: 12 }}>
            <TouchableOpacity style={[s.qaBtn, { backgroundColor: C.primary }]} onPress={() => router.push('/student-crm-screen' as any)} testID="v2-qa-students">
              <Users size={18} color="#fff" />
              <Text style={s.qaText}>Students</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.qaBtn, { backgroundColor: C.accent }]} onPress={() => router.push('/lesson-diary-screen' as any)} testID="v2-qa-diary">
              <CalendarDays size={18} color="#fff" />
              <Text style={s.qaText}>Diary</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.qaBtn, { backgroundColor: '#047857' }]} onPress={() => router.push('/receipts-screen' as any)} testID="v2-qa-receipts">
              <Receipt size={18} color="#fff" />
              <Text style={s.qaText}>Receipts</Text>
            </TouchableOpacity>
          </View>

          {/* Pending sync banner — only shown when there's actually
              something queued, so it never clutters the screen for the
              common case of a normal connection. */}
          {pendingSyncCount > 0 && (
            <TouchableOpacity
              style={s.syncBanner}
              onPress={() => router.push('/sync-status-screen' as any)}
              testID="pending-sync-banner"
            >
              <View style={s.syncDot} />
              <Text style={s.syncBannerText}>
                {pendingSyncCount} change{pendingSyncCount === 1 ? '' : 's'} pending sync
              </Text>
              <ChevronRight size={16} color={C.warmText} />
            </TouchableOpacity>
          )}

          {/* Your day — timeline strip */}
          <View style={s.dayCard}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={s.sectionLabel}>Your day</Text>
              <Text style={s.daySummary}>
                {remaining.length} left · {Math.floor(remainingMins / 60)}h{remainingMins % 60 ? ` ${remainingMins % 60}m` : ''}
              </Text>
            </View>
            <View style={s.timelineTrack}>
              {[480, 600, 720, 840, 960, 1080].map((m) => (
                <View key={m} style={{ position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(15,23,42,.09)', left: `${((m - DAY_START) / SPAN) * 100}%` }} />
              ))}
              {sorted.map((l) => {
                const sMin = toMin(l.start_time);
                const eMin = toMin(l.end_time);
                const isSel = sel?.id === l.id;
                const isPast = eMin < nowMin;
                return (
                  <TouchableOpacity
                    key={l.id}
                    onPress={() => setSelId(l.id)}
                    style={{
                      position: 'absolute', top: 5, bottom: 5,
                      left: `${((sMin - DAY_START) / SPAN) * 100}%`,
                      width: `${((eMin - sMin) / SPAN) * 100}%`,
                      backgroundColor: isPast ? '#CFC8B9' : colorForLessonType(l.lesson_type),
                      opacity: isPast ? 1 : isSel ? 1 : 0.82,
                      borderRadius: 7, alignItems: 'center', justifyContent: 'center',
                      borderWidth: isSel ? 2.5 : 0, borderColor: C.ink,
                    }}
                    testID={`v2-home-block-${l.id}`}
                  >
                    {eMin - sMin >= 100 && (
                      <Text style={s.blockInitials}>{initialsOf(studentName(l.student_id))}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
              {nowMin >= DAY_START && nowMin <= DAY_END && (
                <View style={{ position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.ink, left: `${((nowMin - DAY_START) / SPAN) * 100}%` }} />
              )}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
              {['08', '12', '16', '20'].map((h) => (
                <Text key={h} style={s.tickLabel}>{h}</Text>
              ))}
            </View>
          </View>

          {/* Hero — the selected/next lesson */}
          {lessonsLoading ? (
            <View style={[s.hero, { alignItems: 'center', paddingVertical: 40 }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : sel ? (
            <View style={s.hero}>
              <View style={s.heroInner}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <Text style={[s.heroBadge, nextLesson?.id === sel.id && { color: C.accent }]}>
                    {toMin(sel.end_time) < nowMin ? 'Completed' : nextLesson?.id === sel.id ? 'Next up' : 'Later today'}
                  </Text>
                  <Text style={s.heroDuration}>
                    {((toMin(sel.end_time) - toMin(sel.start_time)) / 60).toFixed(1).replace('.0', '')} hr
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <Text style={s.heroTime}>{fmt(toMin(sel.start_time))}</Text>
                  <Text style={s.heroTimeEnd}>– {fmt(toMin(sel.end_time))}</Text>
                </View>

                <Text style={s.heroStudent}>{studentName(sel.student_id)}</Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
                  <Text style={[s.heroTypeChip, { backgroundColor: colorForLessonType(sel.lesson_type) }]}>
                    {sel.lesson_type}
                  </Text>
                  {!!sel.topic && <Text style={s.heroTopic}>{sel.topic}</Text>}
                </View>

                {!!sel.pickup_address && (
                  <View style={s.heroPickupRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.heroPickupLabel}>Pick up</Text>
                      <Text style={s.heroPickupValue} numberOfLines={1}>{sel.pickup_address}</Text>
                    </View>
                    <OpenInMapsButton
                      address={sel.pickup_address}
                      variant="pill"
                      label="Nav"
                      testID={`v2-home-nav-${sel.id}`}
                    />
                  </View>
                )}

                <TouchableOpacity style={s.heroCta} onPress={() => setDetailLesson(sel)} testID="v2-home-cta">
                  <Text style={s.heroCtaText}>Lesson tools</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={[s.hero, { paddingVertical: 8 }]}>
              <View style={s.heroInner}>
                <Text style={s.heroBadge}>Nothing booked</Text>
                <Text style={s.heroStudent}>No lessons today</Text>
                <TouchableOpacity style={s.heroCta} onPress={() => router.push('/lesson-diary-screen' as any)} testID="v2-home-cta-empty">
                  <Text style={s.heroCtaText}>Open diary</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Rest of today */}
          {sorted.length > 0 && (
            <View style={{ marginHorizontal: 20, marginTop: 22 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 }}>
                <Text style={s.sectionLabel}>Today&apos;s lessons</Text>
                <TouchableOpacity onPress={() => router.push('/lesson-diary-screen' as any)}>
                  <Text style={s.linkText}>Open diary</Text>
                </TouchableOpacity>
              </View>
              <View style={{ gap: 7 }}>
                {sorted.map((l) => {
                  const isSel = sel?.id === l.id;
                  const isPast = toMin(l.end_time) < nowMin;
                  return (
                    <TouchableOpacity
                      key={l.id}
                      style={[s.row, isSel && s.rowActive, isPast && { opacity: 0.55 }]}
                      onPress={() => setSelId(l.id)}
                      testID={`v2-home-row-${l.id}`}
                    >
                      <View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: isPast ? '#CFC8B9' : colorForLessonType(l.lesson_type) }} />
                      <Text style={s.rowTime}>{fmt(toMin(l.start_time))}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[s.rowName, isPast && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
                          {studentName(l.student_id)}
                        </Text>
                        {!!l.topic && <Text style={s.rowTopic} numberOfLines={1}>{l.topic}</Text>}
                      </View>
                      <Text style={[s.rowTag, { color: isPast ? C.textMuted : colorForLessonType(l.lesson_type) }]}>
                        {isPast ? 'Done' : l.lesson_type}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* This month — real figures */}
          {paid && (
            <View style={{ marginHorizontal: 20, marginTop: 24 }}>
              <Text style={s.sectionLabel}>This month</Text>
              <View style={{ marginTop: 10, gap: 9 }}>
                <View style={s.mtdCard}>
                  <View style={{ gap: 3 }}>
                    <Text style={s.mtdLabel}>Earned month to date</Text>
                    <Text style={s.mtdValue}>£{mtdEarned.toFixed(0)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    {mtdUnpaid > 0 && <Text style={s.mtdUnpaid}>£{mtdUnpaid.toFixed(0)} unpaid</Text>}
                    <Text style={s.mtdCount}>{mtdLessonCount} lessons</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 9 }}>
                  <View style={s.statTile}>
                    <Text style={[s.statValue, { color: C.success }]}>{testKpis.passRatePct}%</Text>
                    <Text style={s.statLabel}>Pass rate · {testKpis.total} tests</Text>
                  </View>
                  <View style={s.statTile}>
                    <Text style={s.statValue}>{kpis.active}</Text>
                    <Text style={s.statLabel}>Active students</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 9 }}>
                  <View style={s.statTile}>
                    <Text style={[s.statValue, { color: C.accent }]}>{kpis.testReady}</Text>
                    <Text style={s.statLabel}>Test ready</Text>
                  </View>
                  <View style={s.statTile}>
                    <Text style={s.statValue}>{kpis.waitlist}</Text>
                    <Text style={s.statLabel}>Waiting list</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Earnings chart — real data */}
          {paid && byMonth.length > 0 && (
            <View style={s.chartCard}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
                <Text style={s.sectionLabel}>Earnings</Text>
                <Text style={s.chartSub}>Last 6 months</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9, height: 96 }}>
                {byMonth.map((b, i) => {
                  const isLast = i === byMonth.length - 1;
                  return (
                    <View key={b.label} style={{ flex: 1, alignItems: 'center', gap: 7, height: '100%', justifyContent: 'flex-end' }}>
                      <Text style={[s.barValue, isLast && { color: C.warmText }]}>
                        {b.value >= 1000 ? `£${(b.value / 1000).toFixed(1)}k` : `£${b.value.toFixed(0)}`}
                      </Text>
                      <View style={{
                        width: '100%',
                        height: `${Math.max(2, (b.value / maxBar) * 100)}%`,
                        borderRadius: 6,
                        backgroundColor: isLast ? C.accent : C.primary,
                        opacity: isLast ? 1 : 0.28,
                      }} />
                      <Text style={s.barLabel}>{b.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Competency patterns — already real on the live screen too */}
          {paid && patterns.length > 0 && (
            <View style={s.patternsCard}>
              <Text style={[s.sectionLabel, { color: C.warmText }]}>Where students need help</Text>
              <View style={{ marginTop: 11, gap: 9 }}>
                {patterns.slice(0, 3).map((p) => (
                  <View key={p.category_key} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <Text style={s.patternCount}>{p.studentsStruggling}/{p.studentsAssessed}</Text>
                    <Text style={s.patternText}>struggling with {p.category_name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        <BottomNav role="instructor" />
      </View>

      <LessonToolsSheet
        visible={!!detailLesson}
        onClose={() => setDetailLesson(null)}
        lesson={detailLesson}
        onChanged={() => setSelId(selId)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  outer: { flex: 1, backgroundColor: C.pageBg },
  surface: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingTop: 10 },
  eyebrow: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, letterSpacing: 1.7, textTransform: 'uppercase', color: C.textMuted },
  greeting: { fontFamily: 'Archivo_800ExtraBold', fontSize: 30, letterSpacing: -0.6, color: C.text, marginTop: 1 },
  tierPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 13, borderRadius: 999, backgroundColor: C.warmCard, borderWidth: 1, borderColor: C.warmBorder },
  tierPillText: { fontFamily: 'Barlow_700Bold', fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: C.warmText },

  upgradeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginTop: 12,
    backgroundColor: C.primary, borderRadius: 16, padding: 13,
  },
  upgradeIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,.2)', alignItems: 'center', justifyContent: 'center' },
  upgradeTitle: { fontFamily: 'Archivo_700Bold', fontSize: 14.5, color: '#fff' },
  upgradeSub: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: 'rgba(255,255,255,.8)', marginTop: 1 },

  qaBtn: { flex: 1, minHeight: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 4 },
  qaText: { fontFamily: 'Barlow_700Bold', fontSize: 11.5, color: '#fff' },

  dayCard: { marginHorizontal: 20, marginTop: 18, padding: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 18 },

  syncBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 20, marginTop: 12,
    backgroundColor: C.warmCard, borderWidth: 1, borderColor: C.warmBorder, borderRadius: 13, padding: 12,
  },
  syncDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.warmText },
  syncBannerText: { flex: 1, fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.warmText },
  sectionLabel: { fontFamily: 'Barlow_700Bold', fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: C.textMuted },
  daySummary: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.text },
  timelineTrack: { position: 'relative', height: 46, borderRadius: 10, backgroundColor: '#F1EDE5', overflow: 'hidden' },
  blockInitials: { fontFamily: 'Barlow_700Bold', fontSize: 11, color: 'rgba(255,255,255,.92)' },
  tickLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 10.5, color: '#A69C8B' },

  hero: { marginHorizontal: 20, marginTop: 16, borderRadius: 22, backgroundColor: C.primary, padding: 6 },
  heroInner: { borderWidth: 2, borderColor: 'rgba(255,255,255,.5)', borderRadius: 17, padding: 16 },
  heroBadge: { fontFamily: 'Archivo_800ExtraBold', fontSize: 12, letterSpacing: 2.2, textTransform: 'uppercase', color: 'rgba(255,255,255,.65)' },
  heroDuration: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: 'rgba(255,255,255,.7)' },
  heroTime: { fontFamily: 'Archivo_800ExtraBold', fontSize: 46, letterSpacing: -1.6, color: '#fff' },
  heroTimeEnd: { fontFamily: 'Barlow_600SemiBold', fontSize: 17, color: 'rgba(255,255,255,.62)' },
  heroStudent: { fontFamily: 'Archivo_700Bold', fontSize: 24, letterSpacing: -0.35, color: '#fff', marginTop: 12 },
  heroTypeChip: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.3, textTransform: 'uppercase', color: '#fff', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, overflow: 'hidden' },
  heroTopic: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: 'rgba(255,255,255,.8)' },
  heroPickupRow: { marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.22)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroPickupLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,.55)' },
  heroPickupValue: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: '#fff' },
  heroCta: { marginTop: 16, minHeight: 54, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  heroCtaText: { fontFamily: 'Barlow_700Bold', fontSize: 17, color: '#fff' },

  linkText: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11, minHeight: 58, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.55)', borderWidth: 1, borderColor: C.border },
  rowActive: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.ink },
  rowTime: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: C.text, width: 46 },
  rowName: { fontFamily: 'Barlow_600SemiBold', fontSize: 14.5, color: C.text },
  rowTopic: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, color: C.textMuted, marginTop: 1 },
  rowTag: { fontFamily: 'Barlow_700Bold', fontSize: 10, letterSpacing: 1.1, textTransform: 'uppercase', backgroundColor: 'rgba(15,23,42,.045)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, overflow: 'hidden' },

  mtdCard: { backgroundColor: C.ink, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  mtdLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.7, textTransform: 'uppercase', color: 'rgba(255,255,255,.5)' },
  mtdValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 38, letterSpacing: -1.1, color: '#fff' },
  mtdUnpaid: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, color: '#FF9A4D' },
  mtdCount: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: 'rgba(255,255,255,.5)' },
  statTile: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 13, gap: 2 },
  statValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 30, letterSpacing: -0.9, color: C.text },
  statLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, color: C.textMuted2 },

  chartCard: { marginHorizontal: 20, marginTop: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 15 },
  chartSub: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.textMuted },
  barValue: { fontFamily: 'Barlow_600SemiBold', fontSize: 10, color: '#A69C8B' },
  barLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 11, color: C.textMuted },

  patternsCard: { marginHorizontal: 20, marginTop: 12, backgroundColor: C.warmCard, borderWidth: 1, borderColor: C.warmBorder, borderRadius: 18, padding: 15 },
  patternCount: { fontFamily: 'Archivo_800ExtraBold', fontSize: 19, color: C.warmText, minWidth: 44 },
  patternText: { fontFamily: 'Barlow_500Medium', fontSize: 13.5, color: C.text, flex: 1 },
});
