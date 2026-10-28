import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/AuthContext';
import { BottomNav } from '../src/BottomNav';
import { LessonToolsSheet } from '../src/LessonToolsSheet';
import { Lesson } from '../src/supabaseDb';
import {
  useStudents, useTodayLessons, useInstructorEarnings,
  useInstructorTestOutcomes, useCompetencyPatterns,
} from '../src/useSupabaseData';
import { computeTestKpis, getMySchoolProfile } from '../src/supabaseDb';
import { colorForLessonType } from '../src/diary/lessonTypes';
import { isPaidTier, isFranchiseTier, canOpenSchoolDashboard, tierById, studentUsageUrgency, studentUsageMessage } from '../src/tiers';
import { OpenInMapsButton } from '../src/OpenInMapsButton';
import { openSmsComposer } from '../src/tools';
import { ContactsImportBanner } from '../src/ContactsImportBanner';
import { ReferralBanner } from '../src/ReferralBanner';
import { DeadlinesBanner } from '../src/DeadlinesBanner';
import { ActionCentreCard } from '../src/ActionCentreCard';
import { RoadBriefingCard } from '../src/RoadBriefingCard';
import { SetupChecklistCard } from '../src/SetupChecklistCard';
import { PaywallModal } from '../src/PaywallModal';
import { greetingFor, firstNameOf, fmtMinutes, gapsBetween, dayTotals } from '../src/homeDay';
import { Crown, ChevronRight, Users, CalendarDays, Receipt, Lock, Eye, EyeOff, LayoutDashboard, Car, Check } from 'lucide-react-native';
import { usePendingSyncCount } from '../src/offlineSync';
import { OfflineBanner } from '../src/OfflineBanner';

/**
 * Instructor Home. Layout follows the Claude Design "Dashboards" handoff (28 Oct 2026), light theme only: the next
 * lesson first, then the day as a road-style timeline with the gap between lessons, then the cards below.
 *
 * Wired to REAL data throughout (nothing here is mock data). Behaviour that is easy to lose in a restyle and is
 * deliberate:
 *   - the total student count (students.length) is what the Starter limit banner uses, matching canAddStudent
 *   - earnings are masked on every mount and never persisted, so a pupil glancing at the phone cannot see them
 *   - a lesson that is past its end time but still "Scheduled" reads Overdue, not Done
 *   - a failed load shows an error with Try again, never "No lessons today"
 */

const C = {
  pageBg: '#DCD6CA',
  surface: '#F5F2EC',
  card: '#FFFFFF',
  border: '#E3DED3',
  inset: '#F1EEE7',
  blueSoft: '#E5EEF8',
  road: '#334155',
  text: '#0F172A',
  textMuted: '#475569',
  primary: '#00539F',
  accent: '#FF6B00',
  ink: '#0F172A',
  success: '#10B981',
  warmCard: '#FFF0DC',
  warmBorder: '#FED7AA',
  warmText: '#8A4400',
};

const DAY_START = 450; // 07:30
const DAY_END = 1200;  // 20:00
const SPAN = DAY_END - DAY_START;

const EARNINGS_MASK = '£•••';
function maskEarnings(value: string, hidden: boolean): string {
  return hidden ? EARNINGS_MASK : value;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fmt(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function initialsOf(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function Heading({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={s.headingRow}>
      <View style={s.headingBar} />
      <Text style={[s.sectionLabel, { flex: 1 }]}>{children}</Text>
      {right}
    </View>
  );
}

export default function InstructorHomeV2Screen() {
  const pendingSyncCount = usePendingSyncCount();
  const router = useRouter();
  const openPupils = (filter: string) => router.push({ pathname: '/student-crm-screen', params: { filter } } as any);
  const { user } = useAuth();
  const [selId, setSelId] = useState<string | null>(null);
  const [detailLesson, setDetailLesson] = useState<Lesson | null>(null);

  const { lessons: todayLessons, loading: lessonsLoading, error: lessonsError, refresh: refreshLessons } = useTodayLessons();
  const { students } = useStudents();
  const { mtdEarned, mtdUnpaid, mtdLessonCount, byMonth } = useInstructorEarnings();
  const { rows: testOutcomes } = useInstructorTestOutcomes();
  const studentIds = useMemo(() => students.map((st) => st.id), [students]);
  const { patterns } = useCompetencyPatterns(studentIds);
  const testKpis = computeTestKpis(testOutcomes);

  const tier = tierById(user?.tier);
  const paid = isPaidTier(user?.tier);

  // School dashboard entry (26 Sept 2026). getMySchoolProfile() only returns a row for the school's owner, so a
  // non-null result is the owner check. Only queried for Franchise users, so solo tiers make no extra request.
  const [isSchoolOwner, setIsSchoolOwner] = useState(false);
  useEffect(() => {
    if (!isFranchiseTier(user?.tier)) { setIsSchoolOwner(false); return; }
    let active = true;
    getMySchoolProfile()
      .then((school) => { if (active) setIsSchoolOwner(!!school); })
      .catch(() => { if (active) setIsSchoolOwner(false); });
    return () => { active = false; };
  }, [user?.tier, user?.id]);
  const showSchoolDashboard = canOpenSchoolDashboard(user?.tier, isSchoolOwner);
  // Receipts is a paid feature: greyed out rather than hidden, so the row of three buttons stays balanced.
  const [receiptsPaywallOpen, setReceiptsPaywallOpen] = useState(false);
  const [isEarningsHidden, setIsEarningsHidden] = useState(true);
  // Setup checklist for new instructors (28 Sept 2026). null = still deciding, so the referral banner below waits
  // rather than flashing and being removed.
  const [checklistShowing, setChecklistShowing] = useState<boolean | null>(null);

  const sorted = useMemo(
    () => [...todayLessons].sort((a, b) => toMin(a.start_time) - toMin(b.start_time)),
    [todayLessons],
  );
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nextLesson = sorted.find((l) => toMin(l.end_time) >= nowMin && l.status !== 'Cancelled');
  const sel = sorted.find((l) => l.id === selId) || nextLesson || sorted[0];

  const studentName = (id: string) => students.find((st) => st.id === id)?.name || 'Student';
  const studentFor = (id: string) => students.find((st) => st.id === id);
  const selStudent = sel ? studentFor(sel.student_id) : undefined;
  const remaining = sorted.filter((l) => toMin(l.end_time) >= nowMin && l.status !== 'Cancelled');
  const remainingMins = remaining.reduce((sum, l) => sum + (toMin(l.end_time) - toMin(l.start_time)), 0);
  const totals = dayTotals(sorted);
  const gapAfter = useMemo(() => new Map(gapsBetween(sorted).map((g) => [g.after.id, g])), [sorted]);

  const kpis = useMemo(() => ({
    active: students.filter((st) => st.status === 'Active').length,
    testReady: students.filter((st) => st.status === 'Test Ready').length,
    waitlist: students.filter((st) => st.status === 'Waitlist').length,
  }), [students]);

  const maxBar = Math.max(1, ...byMonth.map((b) => b.value));
  const maxStruggling = Math.max(1, ...patterns.map((p) => p.studentsStruggling));

  const dateLine = `${now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  const untilStart = sel ? toMin(sel.start_time) - nowMin : 0;
  const whenText = sel
    ? `${nextLesson?.id === sel.id && untilStart > 0 ? `in ${fmtMinutes(untilStart)} · ` : ''}${fmt(toMin(sel.start_time))} – ${fmt(toMin(sel.end_time))}`
    : '';

  return (
    <SafeAreaView style={s.outer} edges={['top']}>
      <View style={s.surface}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110 }}>
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity
              style={{ flex: 1, minWidth: 0 }}
              activeOpacity={0.7}
              onPress={() => router.push('/profile-screen' as any)}
              testID="v2-home-my-details-link"
            >
              <Text style={s.eyebrow}>{dateLine}</Text>
              <Text style={s.greeting} numberOfLines={1}>{greetingFor(now.getHours())}, {firstNameOf(user?.name)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tierPill, !paid && s.tierPillStarter]}
              onPress={() => router.push('/pricing-screen' as any)}
              activeOpacity={0.7}
              testID="v2-home-tier-pill"
            >
              <Text style={[s.tierPillText, !paid && { color: C.text }]}>{tier?.name || 'Starter'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.avatar}
              onPress={() => router.push('/profile-screen' as any)}
              accessibilityRole="button"
              accessibilityLabel={`Account: ${user?.name || 'Instructor'}`}
              testID="v2-home-avatar"
            >
              <Text style={s.avatarText}>{initialsOf(user?.name || 'Instructor')}</Text>
            </TouchableOpacity>
          </View>

          {/* Getting-started checklist — new accounts only (first 30 days), each step ticks itself from real data. */}
          <SetupChecklistCard students={students} onShowingChange={setChecklistShowing} />

          {/* Next lesson — the selected (or next) lesson */}
          {lessonsLoading ? (
            <View style={[s.hero, { alignItems: 'center', paddingVertical: 40 }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : lessonsError ? (
            <View style={[s.hero, { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, gap: 8 }]} testID="v2-home-lessons-error">
              <Text style={[s.heroStudent, { textAlign: 'center' }]}>Couldn&apos;t load today&apos;s lessons</Text>
              <Text style={{ color: 'rgba(255,255,255,.8)', textAlign: 'center', fontSize: 13 }}>{lessonsError}</Text>
              <TouchableOpacity onPress={refreshLessons} testID="v2-home-lessons-retry">
                <Text style={{ color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 14, textDecorationLine: 'underline' }}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : sel ? (
            <View style={s.hero}>
              <View style={s.heroTop}>
                <Text style={s.heroBadge}>
                  {/* Reads the real status first. A lesson that is past its end time but never marked complete is
                      still 'Scheduled' in the database, and must say Overdue rather than Completed. */}
                  {sel.status === 'Completed' ? 'Completed'
                    : sel.status === 'Cancelled' ? 'Cancelled'
                      : toMin(sel.end_time) < nowMin ? 'Overdue'
                        : nextLesson?.id === sel.id ? 'Next lesson' : 'Later today'}
                </Text>
                <Text style={s.heroWhen}>{whenText}</Text>
              </View>

              <View style={{ paddingHorizontal: 4 }}>
                <Text style={s.heroStudent}>{studentName(sel.student_id)}</Text>
                <Text style={s.heroTopic}>{sel.topic || sel.lesson_type}</Text>
                {!!sel.pickup_address && <Text style={s.heroPickup} numberOfLines={1}>Pick-up: {sel.pickup_address}</Text>}
              </View>

              {/* Navigate falls back to the pupil's own address and postcode when the lesson has no pick-up, and to the
                  test centre for a test with no meeting time. "I've arrived" opens the device's SMS composer. */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <OpenInMapsButton
                  address={(sel.lesson_type === 'Practical Test' && sel.test_centre && !sel.test_time) ? sel.test_centre : (sel.pickup_address || [selStudent?.address, selStudent?.postcode].filter(Boolean).join(', '))}
                  variant="pill"
                  label="Navigate"
                  iconColor={C.ink}
                  style={s.heroBtnPrimary}
                  textStyle={s.heroBtnPrimaryText}
                  testID={`v2-home-nav-quick-${sel.id}`}
                />
                <TouchableOpacity
                  style={s.heroBtnOutline}
                  onPress={() => openSmsComposer(selStudent?.phone || '', `Hi ${firstNameOf(selStudent?.name)}, I've arrived for your lesson!`)}
                  accessibilityRole="button"
                  testID={`v2-home-arrived-${sel.id}`}
                >
                  <Check size={20} color="#fff" />
                  <Text style={s.heroBtnOutlineText}>I&apos;ve arrived</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={s.heroTools} onPress={() => setDetailLesson(sel)} testID="v2-home-cta">
                <Text style={s.heroToolsText}>Lesson tools</Text>
                <ChevronRight size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Today — stats, the day strip, then the timeline with the gap between lessons */}
          <View style={s.card}>
            <Heading right={sorted.length > 0 ? (
              <Text style={s.daySummary}>
                {remaining.length} left · {Math.floor(remainingMins / 60)}h{remainingMins % 60 ? ` ${remainingMins % 60}m` : ''}
              </Text>
            ) : undefined}>Today</Heading>

            {sorted.length > 0 ? (
              <>
                <View style={s.tileRow}>
                  <View style={s.tile}>
                    <Text style={s.tileValue}>{fmtMinutes(totals.teachMin)}</Text>
                    <Text style={s.tileLabel}>teaching, {totals.lessonCount} {totals.lessonCount === 1 ? 'lesson' : 'lessons'}</Text>
                  </View>
                  <View style={s.tile}>
                    <Text style={s.tileValue}>{fmtMinutes(totals.gapMin)}</Text>
                    <Text style={s.tileLabel}>between lessons</Text>
                  </View>
                </View>

                <View style={{ marginHorizontal: 8 }}>
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
                            position: 'absolute', top: 4, bottom: 4,
                            left: `${((sMin - DAY_START) / SPAN) * 100}%`,
                            width: `${((eMin - sMin) / SPAN) * 100}%`,
                            backgroundColor: isPast ? '#CFC8B9' : colorForLessonType(l.lesson_type),
                            opacity: isPast ? 1 : isSel ? 1 : 0.82,
                            borderRadius: 5, alignItems: 'center', justifyContent: 'center',
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
                      <View style={{ position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: C.accent, left: `${((nowMin - DAY_START) / SPAN) * 100}%` }} />
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    {['08:00', '12:00', '16:00', '20:00'].map((h) => (
                      <Text key={h} style={s.tickLabel}>{h}</Text>
                    ))}
                  </View>
                </View>

                <View>
                  {sorted.map((l) => {
                    const isSel = sel?.id === l.id;
                    // "Done" (struck through, greyed) means genuinely status 'Completed'. An overdue but unconfirmed
                    // lesson stays normal and reads Overdue, so it does not look handled while it still needs the
                    // instructor to complete it (faults, grade, payment).
                    const isCompleted = l.status === 'Completed';
                    const isCancelled = l.status === 'Cancelled';
                    const isOverdue = !isCompleted && !isCancelled && toMin(l.end_time) < nowMin;
                    const isDone = isCompleted || isCancelled;
                    const isNext = nextLesson?.id === l.id;
                    const gap = gapAfter.get(l.id);
                    return (
                      <View key={l.id}>
                        <TouchableOpacity
                          style={[s.tlRow, isSel && s.tlRowActive, isDone && { opacity: 0.55 }]}
                          onPress={() => setSelId(l.id)}
                          testID={`v2-home-row-${l.id}`}
                        >
                          <View style={s.tlTime}>
                            <Text style={s.tlStart}>{fmt(toMin(l.start_time))}</Text>
                            <Text style={s.tlEnd}>{fmt(toMin(l.end_time))}</Text>
                          </View>
                          <View style={s.tlRoad}>
                            <View style={s.tlRoadBed} />
                            <View style={s.tlRoadLine} />
                            <View style={[s.tlDot, { backgroundColor: isNext ? C.accent : C.primary, shadowColor: isNext ? C.accent : C.primary }]} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
                            <Text style={[s.tlName, isDone && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
                              {studentName(l.student_id)}
                            </Text>
                            <Text style={s.tlTopic} numberOfLines={1}>{l.topic || l.lesson_type}</Text>
                            {!!l.pickup_address && <Text style={s.tlPickup} numberOfLines={1}>{l.pickup_address}</Text>}
                            {(isDone || isOverdue) && (
                              <Text style={[s.tlStatus, isOverdue && { color: C.warmText }]}>
                                {isCancelled ? 'Cancelled' : isCompleted ? 'Done' : 'Overdue'}
                              </Text>
                            )}
                          </View>
                        </TouchableOpacity>
                        {gap && (
                          <View style={s.gapRow}>
                            <View style={s.tlTime} />
                            <View style={s.tlRoad}>
                              <View style={s.tlRoadBed} />
                              <View style={s.tlRoadLine} />
                            </View>
                            <View style={s.gapText}>
                              <Car size={16} color={C.textMuted} />
                              <Text style={s.gapLabel}>{fmtMinutes(gap.minutes)} until the next lesson</Text>
                              {!!gap.tag && (
                                <Text style={[s.gapTag, gap.tag === 'Tight' && { backgroundColor: C.warmCard, color: C.warmText }]}>{gap.tag}</Text>
                              )}
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
                <TouchableOpacity onPress={() => router.push('/lesson-diary-screen' as any)} style={{ marginHorizontal: 8, marginBottom: 6 }}>
                  <Text style={s.linkText}>Open diary</Text>
                </TouchableOpacity>
              </>
            ) : lessonsLoading || lessonsError ? null : (
              <View style={s.emptyDay} testID="v2-home-empty-day">
                <Text style={s.emptyTitle}>No lessons today</Text>
                <Text style={s.emptyText}>Your day fills in here in time order, with the gap between each lesson.</Text>
                <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/lesson-diary-screen' as any)} testID="v2-home-cta-empty">
                  <Text style={s.emptyBtnText}>Open diary</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Needs attention (paid: renewal deadlines and the ranked action list), then the road briefing */}
          <ActionCentreCard />
          <RoadBriefingCard lessons={todayLessons} students={students} />
          <DeadlinesBanner enabled={paid} />

          {/* Contacts import nudge — auto-hides server-side once dismissed or once the instructor has 3+ students. */}
          <View style={{ marginHorizontal: 20, marginTop: 12 }}>
            <ContactsImportBanner studentCount={students.length} isInstructor />
          </View>

          {/* Referral banner — held back while the setup checklist is showing (or still deciding), so a new
              instructor is not buried in prompts. */}
          {checklistShowing === false && <ReferralBanner />}

          {/* Upgrade banner (Starter tier only) — escalates to a danger colour once the student limit is reached. */}
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
                    {urgency === 'critical' ? "You've reached your limit" : `Upgrade to ${tierById('pro').name}`}
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
          <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 20, marginTop: 12 }}>
            <TouchableOpacity style={[s.qaBtn, s.qaOutline]} onPress={() => router.push('/student-crm-screen' as any)} testID="v2-qa-students">
              <Users size={22} color={C.primary} />
              <Text style={[s.qaText, { color: C.primary }]}>Students</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.qaBtn, { backgroundColor: C.accent }]} onPress={() => router.push('/lesson-diary-screen' as any)} testID="v2-qa-diary">
              <CalendarDays size={22} color={C.ink} />
              <Text style={[s.qaText, { color: C.ink }]}>Diary</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.qaBtn, s.qaOutline, !paid && { borderColor: '#9CA3AF' }]}
              onPress={() => paid ? router.push('/receipts-screen' as any) : setReceiptsPaywallOpen(true)}
              testID="v2-qa-receipts"
            >
              {paid ? <Receipt size={22} color={C.primary} /> : <Lock size={20} color="#6B7280" />}
              <Text style={[s.qaText, { color: paid ? C.primary : '#6B7280' }]}>Receipts</Text>
            </TouchableOpacity>
          </View>

          {showSchoolDashboard && (
            <TouchableOpacity
              style={s.schoolDashBtn}
              onPress={() => router.push('/owner-dashboard-screen' as any)}
              testID="v2-qa-school-dashboard"
            >
              <LayoutDashboard size={18} color="#fff" />
              <Text style={s.schoolDashText}>School dashboard</Text>
              <ChevronRight size={18} color="#fff" />
            </TouchableOpacity>
          )}

          {/* Pending sync banner — only shown when something is actually queued. */}
          <OfflineBanner showPending={false} />
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

          {/* Money this month — real figures */}
          {paid && (
            <View style={[s.card, { paddingHorizontal: 16, paddingBottom: 16 }]}>
              <Heading right={
                <TouchableOpacity
                  onPress={() => setIsEarningsHidden((v) => !v)}
                  style={s.revealBtn}
                  accessibilityRole="button"
                  accessibilityLabel={isEarningsHidden ? 'Reveal earnings' : 'Hide earnings'}
                  testID="v2-toggle-earnings"
                >
                  {isEarningsHidden ? <Eye size={20} color={C.primary} /> : <EyeOff size={20} color={C.primary} />}
                  <Text style={s.revealText}>{isEarningsHidden ? 'Reveal' : 'Hide'}</Text>
                </TouchableOpacity>
              }>Money this month</Heading>
              <View style={s.tileRow2}>
                <View style={s.moneyTile}>
                  <Text style={s.moneyLabel}>Earned month to date</Text>
                  <Text style={s.moneyValue}>{maskEarnings(`£${mtdEarned.toFixed(0)}`, isEarningsHidden)}</Text>
                  <Text style={s.moneyNote}>{mtdLessonCount} lessons</Text>
                </View>
                <View style={s.moneyTile}>
                  <Text style={s.moneyLabel}>Unpaid</Text>
                  <Text style={s.moneyValue}>{maskEarnings(`£${mtdUnpaid.toFixed(0)}`, isEarningsHidden)}</Text>
                </View>
              </View>

              {byMonth.length > 0 && (
                <View>
                  <Text style={s.chartSub}>Last 6 months</Text>
                  <View style={s.chartBars}>
                    {byMonth.map((b, i) => {
                      const isLast = i === byMonth.length - 1;
                      return (
                        <View key={b.label} style={{ flex: 1, alignItems: 'center' }}>
                          {/* Fixed-height slot for the value label, separate from the bar's own track: a near-max bar
                              plus its label would otherwise overflow upward into the heading. */}
                          <View style={{ height: 16, justifyContent: 'flex-end' }}>
                            <Text style={[s.barValue, isLast && { color: C.warmText }]} numberOfLines={1}>
                              {maskEarnings(b.value >= 1000 ? `£${(b.value / 1000).toFixed(1)}k` : `£${b.value.toFixed(0)}`, isEarningsHidden)}
                            </Text>
                          </View>
                          <View style={{ height: 96, width: '100%', justifyContent: 'flex-end', marginTop: 4 }}>
                            <View style={{
                              width: '100%',
                              height: `${Math.max(2, (b.value / maxBar) * 100)}%`,
                              borderTopLeftRadius: 6, borderTopRightRadius: 6,
                              backgroundColor: isLast ? C.accent : C.primary,
                            }} />
                          </View>
                          <Text style={[s.barLabel, { marginTop: 6 }]}>{b.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Pupils */}
          {paid && (
            <View style={{ marginHorizontal: 20, marginTop: 20 }}>
              <Heading>Pupils</Heading>
              <View style={s.pupilGrid}>
                {/* Each tile opens the Students list on the matching filter chip. */}
                <TouchableOpacity style={s.pupilTile} onPress={() => openPupils('Active')} accessibilityRole="button" testID="v2-pupils-active">
                  <Text style={s.pupilValue}>{kpis.active}</Text>
                  <Text style={s.pupilLabel}>Active</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.pupilTile} onPress={() => openPupils('Test Ready')} accessibilityRole="button" testID="v2-pupils-testready">
                  <Text style={s.pupilValue}>{kpis.testReady}</Text>
                  <Text style={s.pupilLabel}>Test ready</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.pupilTile} onPress={() => openPupils('Waitlist')} accessibilityRole="button" testID="v2-pupils-waitlist">
                  <Text style={s.pupilValue}>{kpis.waitlist}</Text>
                  <Text style={s.pupilLabel}>Waiting list</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.pupilTile} onPress={() => openPupils('Passed')} accessibilityRole="button" testID="v2-pupils-passed">
                  <Text style={[s.pupilValue, { color: C.success }]}>{testKpis.passRatePct}%</Text>
                  <Text style={s.pupilLabel}>Pass rate · {testKpis.total} tests</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Where pupils need help — real competency patterns */}
          {paid && patterns.length > 0 && (
            <View style={[s.card, { paddingBottom: 12 }]}>
              <Heading>Where pupils need help</Heading>
              {patterns.slice(0, 5).map((p) => (
                <View key={p.category_key} style={s.helpRow}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={s.helpTopic} numberOfLines={1}>{p.category_name}</Text>
                    <Text style={s.helpCount}>{p.studentsStruggling} of {p.studentsAssessed} pupils</Text>
                  </View>
                  <View style={s.helpTrack}>
                    <View style={[s.helpBar, { width: `${Math.round((p.studentsStruggling / maxStruggling) * 100)}%` }]} />
                  </View>
                </View>
              ))}
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
        onBookNext={(sid) => router.push({ pathname: '/lesson-diary-screen', params: { bookFor: sid } } as any)}
      />

      <PaywallModal
        visible={receiptsPaywallOpen}
        onClose={() => setReceiptsPaywallOpen(false)}
        reason="Receipt scanning and expense tracking is available on DC Pro."
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  outer: { flex: 1, backgroundColor: C.pageBg },
  surface: { flex: 1, backgroundColor: C.surface },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  eyebrow: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, letterSpacing: 0.9, textTransform: 'uppercase', color: C.textMuted },
  greeting: { fontFamily: 'Archivo_800ExtraBold', fontSize: 26, letterSpacing: -0.3, color: C.text, marginTop: 3 },
  tierPill: { minHeight: 32, paddingHorizontal: 10, borderRadius: 7, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' },
  tierPillStarter: { backgroundColor: C.inset, borderWidth: 1, borderColor: C.border },
  tierPillText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: C.primary },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.primary, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 14, color: C.primary },

  // Sign-style card: blue with an inner white hairline, as in the design.
  hero: { marginHorizontal: 16, marginTop: 20, borderRadius: 20, backgroundColor: C.primary, borderWidth: 2, borderColor: C.primary, paddingTop: 18, paddingHorizontal: 12, paddingBottom: 14, gap: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 },
  heroBadge: { fontFamily: 'Archivo_800ExtraBold', fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', backgroundColor: C.accent, color: C.ink, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6, overflow: 'hidden' },
  heroWhen: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: '#fff' },
  heroStudent: { fontFamily: 'Archivo_800ExtraBold', fontSize: 30, letterSpacing: -0.3, color: '#fff' },
  heroTopic: { fontFamily: 'Barlow_500Medium', fontSize: 17, color: '#fff', marginTop: 6 },
  heroPickup: { fontFamily: 'Barlow_500Medium', fontSize: 16, color: 'rgba(255,255,255,.92)', marginTop: 2 },
  heroBtnPrimary: { flex: 1, minHeight: 56, borderRadius: 14, backgroundColor: C.accent, justifyContent: 'center', gap: 9, paddingHorizontal: 14 },
  heroBtnPrimaryText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 17, color: C.ink },
  heroBtnOutline: { flex: 1, minHeight: 56, borderRadius: 14, borderWidth: 2, borderColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 14 },
  heroBtnOutlineText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 17, color: '#fff' },
  heroTools: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  heroToolsText: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: '#fff' },

  card: { marginHorizontal: 16, marginTop: 20, paddingTop: 16, paddingHorizontal: 8, paddingBottom: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 20, gap: 12 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 8 },
  headingBar: { width: 18, height: 4, borderRadius: 2, backgroundColor: C.accent },
  sectionLabel: { fontFamily: 'Archivo_800ExtraBold', fontSize: 13, letterSpacing: 1.3, textTransform: 'uppercase', color: C.textMuted },
  daySummary: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.textMuted },
  linkText: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: C.primary },

  tileRow: { flexDirection: 'row', gap: 8, marginHorizontal: 8 },
  tile: { flex: 1, backgroundColor: C.inset, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  tileValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 26, color: C.text },
  tileLabel: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: C.textMuted, marginTop: 4 },

  timelineTrack: { position: 'relative', height: 30, borderRadius: 8, backgroundColor: C.inset, overflow: 'hidden' },
  blockInitials: { fontFamily: 'Barlow_700Bold', fontSize: 11, color: 'rgba(255,255,255,.92)' },
  tickLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, color: C.textMuted },

  // The timeline: time column, a short stretch of "road" with a dot per lesson, then the details.
  tlRow: { flexDirection: 'row', minHeight: 80, paddingHorizontal: 8, gap: 10, borderRadius: 12 },
  tlRowActive: { backgroundColor: C.blueSoft },
  tlTime: { width: 50, paddingVertical: 13 },
  tlStart: { fontFamily: 'Archivo_800ExtraBold', fontSize: 16, color: C.text },
  tlEnd: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: C.textMuted, marginTop: 2 },
  tlRoad: { width: 20 },
  tlRoadBed: { position: 'absolute', left: 4, top: 0, bottom: 0, width: 12, backgroundColor: C.road },
  // A solid centre line: dashed single-side borders do not render the same on Android and iOS.
  tlRoadLine: { position: 'absolute', left: 9, top: 0, bottom: 0, width: 2, backgroundColor: C.surface },
  tlDot: { position: 'absolute', left: 0, top: 24, width: 20, height: 20, borderRadius: 10, borderWidth: 4, borderColor: C.card, elevation: 0 },
  tlName: { fontFamily: 'Archivo_800ExtraBold', fontSize: 18, color: C.text },
  tlTopic: { fontFamily: 'Barlow_500Medium', fontSize: 16, color: C.text, marginTop: 2 },
  tlPickup: { fontFamily: 'Barlow_500Medium', fontSize: 15, color: C.textMuted, marginTop: 1 },
  tlStatus: { fontFamily: 'Barlow_700Bold', fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', color: C.textMuted, marginTop: 3 },
  gapRow: { flexDirection: 'row', minHeight: 48, paddingHorizontal: 8, gap: 10 },
  gapText: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  gapLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.textMuted },
  gapTag: { fontFamily: 'Archivo_800ExtraBold', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', backgroundColor: C.inset, color: C.textMuted, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 6, overflow: 'hidden' },

  emptyDay: { alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingBottom: 12 },
  emptyTitle: { fontFamily: 'Archivo_800ExtraBold', fontSize: 20, color: C.text },
  emptyText: { fontFamily: 'Barlow_400Regular', fontSize: 16, color: C.textMuted, textAlign: 'center', maxWidth: 300 },
  emptyBtn: { minHeight: 52, paddingHorizontal: 22, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  emptyBtnText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 16, color: C.ink },

  upgradeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 12,
    backgroundColor: C.primary, borderRadius: 16, padding: 13,
  },
  upgradeIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,.2)', alignItems: 'center', justifyContent: 'center' },
  upgradeTitle: { fontFamily: 'Archivo_700Bold', fontSize: 14.5, color: '#fff' },
  upgradeSub: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: 'rgba(255,255,255,.8)', marginTop: 1 },

  qaBtn: { flex: 1, minHeight: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
  qaOutline: { borderWidth: 2, borderColor: C.primary, backgroundColor: 'transparent' },
  qaText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 13 },
  schoolDashBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 9, minHeight: 48, borderRadius: 14, paddingHorizontal: 16, backgroundColor: C.ink },
  schoolDashText: { flex: 1, fontFamily: 'Barlow_700Bold', fontSize: 14, color: '#fff' },

  syncBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 16, marginTop: 12,
    backgroundColor: C.warmCard, borderWidth: 1, borderColor: C.warmBorder, borderRadius: 13, padding: 12,
  },
  syncDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.warmText },
  syncBannerText: { flex: 1, fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.warmText },

  revealBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: C.primary, flexDirection: 'row', alignItems: 'center', gap: 8 },
  revealText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 14, color: C.primary },
  tileRow2: { flexDirection: 'row', gap: 10, marginTop: 2 },
  moneyTile: { flex: 1, backgroundColor: C.inset, borderRadius: 14, padding: 12 },
  moneyLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.textMuted },
  moneyValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 28, color: C.text, marginTop: 4 },
  moneyNote: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: C.textMuted, marginTop: 2 },
  chartSub: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.textMuted, marginBottom: 6 },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderBottomWidth: 3, borderBottomColor: C.border, borderStyle: 'dashed', paddingBottom: 2 },
  barValue: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: C.textMuted },
  barLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.textMuted },

  pupilGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  pupilTile: { flexBasis: '47%', flexGrow: 1, minHeight: 84, padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  pupilValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 32, color: C.text },
  pupilLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 15, color: C.text, marginTop: 6 },

  helpRow: { paddingHorizontal: 8, paddingVertical: 8, gap: 6, minHeight: 52, justifyContent: 'center' },
  helpTopic: { flex: 1, fontFamily: 'Barlow_700Bold', fontSize: 16, color: C.text },
  helpCount: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.textMuted },
  helpTrack: { height: 10, borderRadius: 5, backgroundColor: C.inset },
  helpBar: { height: 10, borderRadius: 5, backgroundColor: C.accent },
});
