import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, TextInput, Modal, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { UserPlus, X } from 'lucide-react-native';
import { useAuth } from '../src/AuthContext';
import { supabase } from '../src/supabaseClient';
import { DateField } from '../src/DateTimeFields';
import { isFranchiseTier, schoolDisplayName } from '../src/tiers';
import { copyToClipboard, openSmsComposer } from '../src/tools';
import {
  listTestOutcomesForSchool, computeTestKpis, type TestOutcome, getArrearsSummary,
  getMySchoolProfile, buildInstructorInviteLink, type InvitedInstructor,
} from '../src/supabaseDb';
import { inviteInstructor } from '../src/useSupabaseData';

/**
 * Owner Dashboard — redesigned visual direction from the Claude Design
 * handoff (23 Aug 2026), promoted to live on 24 Aug 2026 after review as
 * owner-dashboard-v2-screen. This is now the real, live owner dashboard.
 *
 * This screen was already on real data before the redesign — it uses the
 * /v2/school/leaderboard and /v2/school/today backend endpoints. The fetch
 * logic, monthTrend() maths, revenue-privacy masking, and needs-attention
 * rules are reproduced from the original deliberately rather than
 * reinvented, so behaviour stays identical and only the visuals changed.
 *
 * Two whole sections ported in as part of promoting this to live (24 Aug
 * 2026) — both franchise-tier only, and both missing from the original v2
 * trial since the design never covered them:
 *   - "Today across the school" — real-time via /api/v2/school/today
 *   - "Student allocations" — a date-range report via
 *     /api/v2/school/student-allocations, counting new students per
 *     instructor in the chosen range
 *
 * Revenue privacy note: isRevenueHidden deliberately starts TRUE on every
 * mount and is never persisted. That's intentional (an owner shouldn't
 * have revenue accidentally left visible in front of a student), not an
 * oversight to "fix".
 *
 * Worth knowing, unrelated to this swap: nothing anywhere in the app
 * currently links to this route at all, not even before this change —
 * owners must be reaching it by typing the URL directly or some other
 * path not yet found. Pre-existing, not something this swap caused.
 */

const C = {
  pageBg: '#DCD6CA',
  surface: '#F5F2EC',
  border: '#E4DED2',
  divider: '#EDE8DE',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  primary: '#00539F',
  primaryLight: '#E5F0FA',
  accent: '#FF6B00',
  ink: '#0F172A',
  success: '#047857',
  warnBg: '#FEF3C7',
  warnBorder: '#FDE68A',
  warnText: '#92400E',
  warnChevron: '#B45309',
  warmBg: '#FFF7ED',
  warmBorder: '#FED7AA',
};

const REVENUE_MASK = '£•••';
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

function maskRevenue(value: string, hidden: boolean): string {
  return hidden ? REVENUE_MASK : value;
}

function monthTrend(current: number, previous: number, formatDelta: (n: number) => string) {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) return { direction: 'up' as const, text: 'New this month' };
  const deltaPct = Math.round(((current - previous) / previous) * 100);
  if (deltaPct === 0) return { direction: 'flat' as const, text: 'Same as last month' };
  return { direction: deltaPct > 0 ? ('up' as const) : ('down' as const), text: `${formatDelta(deltaPct)} vs last month` };
}

type LeaderboardRow = {
  instructor_id: string; full_name: string; adi_number: string | null; is_owner: boolean;
  students_active: number; lessons_month: number; revenue_month: number; pass_rate: number;
};
type Leaderboard = {
  school_id: string; business_name: string | null; month_iso: string; tier: string;
  seat_count: number; seat_limit: number | null; can_add_instructor: boolean;
  totals: { students_active: number; lessons_month: number; revenue_month: number; pass_rate: number };
  totals_prev_month: { lessons_month: number; revenue_month: number };
  rows: LeaderboardRow[];
};
type SortKey = 'revenue_month' | 'lessons_month' | 'students_active' | 'pass_rate';

type TodayLesson = {
  lesson_id: string;
  instructor_id: string;
  instructor_name: string;
  student_id: string | null;
  student_name: string | null;
  start_time: string;
  end_time: string;
  status: string;
  topic: string | null;
  pickup_address: string | null;
};
type StudentAllocationRow = {
  instructor_id: string;
  full_name: string;
  student_count: number;
};
type StudentAllocationResponse = {
  school_id: string;
  from_date: string;
  to_date: string;
  total: number;
  rows: StudentAllocationRow[];
};

const SORT_LABEL: Record<SortKey, string> = {
  revenue_month: 'Revenue',
  lessons_month: 'Lessons',
  students_active: 'Students',
  pass_rate: 'Pass rate',
};

export default function OwnerDashboardV2Screen() {
  const router = useRouter();
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [today, setToday] = useState<TodayLesson[]>([]);
  const [testOutcomes, setTestOutcomes] = useState<TestOutcome[]>([]);
  const [arrears, setArrears] = useState<{ count: number; total_gbp: number }>({ count: 0, total_gbp: 0 });
  const [loading, setLoading] = useState(true);

  // Owner-only "Add instructor" (25 Aug 2026). isOwner is derived from
  // getMySchoolProfile() itself filtering .eq('owner_auth_id', uid) — it
  // naturally returns null for a non-owner instructor, so a non-null
  // result IS the owner check, no separate query needed. This is a UX
  // gate only; RLS (ins_owner_all policy) is the actual security boundary
  // regardless of what this screen shows or hides.
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    getMySchoolProfile().then((school) => setIsOwner(!!school)).catch(() => setIsOwner(false));
  }, []);

  const [addInstructorOpen, setAddInstructorOpen] = useState(false);
  const [aiFullName, setAiFullName] = useState('');
  const [aiAdiNumber, setAiAdiNumber] = useState('');
  const [aiMobile, setAiMobile] = useState('');
  const [aiEmail, setAiEmail] = useState('');
  const [aiAddress, setAiAddress] = useState('');
  const [aiCarMake, setAiCarMake] = useState('');
  const [aiCarModel, setAiCarModel] = useState('');
  const [aiNumberPlate, setAiNumberPlate] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{ link: string; name: string; mobile: string } | null>(null);

  const resetAddInstructorForm = () => {
    setAiFullName(''); setAiAdiNumber(''); setAiMobile(''); setAiEmail('');
    setAiAddress(''); setAiCarMake(''); setAiCarModel(''); setAiNumberPlate('');
    setAiError(null);
  };

  const submitAddInstructor = async () => {
    setAiError(null);
    if (!aiFullName.trim()) { setAiError("Please enter the instructor's full name"); return; }
    if (!aiAdiNumber.trim()) { setAiError('Please enter their ADI/PDI number'); return; }
    if (!aiMobile.trim()) { setAiError('Please enter their mobile number'); return; }
    if (!aiEmail.trim() || !aiEmail.includes('@')) { setAiError('Please enter a valid email address'); return; }
    setAiBusy(true);
    try {
      const created: InvitedInstructor = await inviteInstructor({
        full_name: aiFullName.trim(),
        adi_number: aiAdiNumber.trim(),
        mobile_number: aiMobile.trim(),
        email: aiEmail.trim(),
        address: aiAddress.trim(),
        car_make: aiCarMake.trim(),
        car_model: aiCarModel.trim(),
        number_plate: aiNumberPlate.trim(),
      });
      const appOrigin = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.EXPO_PUBLIC_APP_URL || 'https://adiapp.netlify.app');
      const link = buildInstructorInviteLink(created, appOrigin);
      setAddInstructorOpen(false);
      resetAddInstructorForm();
      setInviteResult({ link, name: created.full_name, mobile: aiMobile.trim() });
    } catch (e: any) {
      setAiError(e?.message || 'Could not add instructor');
    } finally {
      setAiBusy(false);
    }
  };
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('revenue_month');
  const [isRevenueHidden, setIsRevenueHidden] = useState(true);

  // Student allocations by date range — Franchise tier only. Counts
  // students per instructor whose created_at (first-added date) falls in
  // the range. Ported in as part of promoting this screen to live.
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;
  const [allocFrom, setAllocFrom] = useState(monthStartStr);
  const [allocTo, setAllocTo] = useState(todayStr);
  const [allocRows, setAllocRows] = useState<StudentAllocationRow[] | null>(null);
  const [allocLoading, setAllocLoading] = useState(false);
  const [allocError, setAllocError] = useState<string | null>(null);

  const fetchAllocations = useCallback(async () => {
    setAllocLoading(true);
    setAllocError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const params = new URLSearchParams({ from_date: allocFrom, to_date: allocTo });
      const r = await fetch(`${BACKEND}/api/v2/school/student-allocations?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error(errBody?.detail || `Failed to load allocations (HTTP ${r.status})`);
      }
      const json = (await r.json()) as StudentAllocationResponse;
      setAllocRows(json.rows);
    } catch (e: any) {
      setAllocError(e?.message || 'Could not load student allocations.');
    } finally {
      setAllocLoading(false);
    }
  }, [allocFrom, allocTo]);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const headers = { Authorization: `Bearer ${token}` };

      const [lr, tr] = await Promise.all([
        fetch(`${BACKEND}/api/v2/school/leaderboard`, { headers }),
        fetch(`${BACKEND}/api/v2/school/today`, { headers }),
      ]);
      if (!lr.ok) {
        const errBody = await lr.json().catch(() => ({}));
        throw new Error(errBody?.detail || `Leaderboard load failed (HTTP ${lr.status})`);
      }
      const lbJson = (await lr.json()) as Leaderboard;
      const todayJson = tr.ok ? ((await tr.json()) as TodayLesson[]) : [];
      setLeaderboard(lbJson);
      setToday(todayJson);

      if (lbJson?.school_id) {
        try {
          setTestOutcomes(await listTestOutcomesForSchool(lbJson.school_id));
        } catch {
          setTestOutcomes([]);
        }
        try {
          setArrears(await getArrearsSummary());
        } catch {
          setArrears({ count: 0, total_gbp: 0 });
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load the school dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-fetch allocations once we know the school is Franchise tier — no
  // point calling the endpoint for solo owners who won't see the section.
  useEffect(() => {
    if (leaderboard?.tier === 'franchise' && allocRows === null && !allocLoading) {
      fetchAllocations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboard?.tier]);

  const testKpis = computeTestKpis(testOutcomes);
  const isFranchise = isFranchiseTier(leaderboard?.tier);

  const sortedRows = useMemo(() => {
    if (!leaderboard?.rows) return [];
    return [...leaderboard.rows].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
  }, [leaderboard, sortKey]);

  const issues = useMemo(() => {
    const list: { key: string; title: string; onPress: () => void }[] = [];
    if (leaderboard && !leaderboard.can_add_instructor) {
      list.push({ key: 'seats', title: 'Instructor seat limit reached', onPress: () => router.push('/pricing-screen' as any) });
    }
    if (arrears.count > 0) {
      list.push({
        key: 'arrears',
        title: `${arrears.count} pupil${arrears.count === 1 ? '' : 's'} owing ${maskRevenue(`£${arrears.total_gbp}`, isRevenueHidden)}`,
        onPress: () => router.push({ pathname: '/student-crm-screen', params: { filter: 'arrears' } } as any),
      });
    }
    return list;
  }, [leaderboard, arrears, isRevenueHidden, router]);

  const recentPracticals = useMemo(
    () => testOutcomes.filter((t) => t.test_type === 'practical').slice(0, 5),
    [testOutcomes],
  );

  const fmtTime = (iso: string) => {
    if (!iso) return '';
    const t = iso.split('T')[1] || iso;
    return t.slice(0, 5);
  };

  const cycleSort = () => {
    const keys: SortKey[] = ['revenue_month', 'lessons_month', 'students_active', 'pass_rate'];
    setSortKey(keys[(keys.indexOf(sortKey) + 1) % keys.length]);
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const revTrend = leaderboard && !isRevenueHidden
    ? monthTrend(leaderboard.totals.revenue_month, leaderboard.totals_prev_month.revenue_month, (n) => `${n > 0 ? '+' : ''}${n}%`)
    : null;
  const lessonTrend = leaderboard
    ? monthTrend(leaderboard.totals.lessons_month, leaderboard.totals_prev_month.lessons_month, (n) => `${n > 0 ? '+' : ''}${n}%`)
    : null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Text style={s.ownerLabel}>School owner</Text>
            <Text style={s.tierPill}>{leaderboard?.tier || 'starter'}</Text>
          </View>
          <Text style={s.schoolName} numberOfLines={2}>
            {schoolDisplayName(user?.tier, leaderboard?.business_name, user?.name, user?.adi_number)}
          </Text>
          <Text style={s.subline}>
            {leaderboard?.seat_count || 1} instructor{(leaderboard?.seat_count || 1) === 1 ? '' : 's'}
            {leaderboard?.seat_limit ? ` of ${leaderboard.seat_limit} seats` : ''}
          </Text>
          {isOwner && isFranchise && (
            <TouchableOpacity
              style={s.addInstructorBtn}
              onPress={() => setAddInstructorOpen(true)}
              testID="btn-add-instructor"
            >
              <UserPlus size={16} color="#fff" />
              <Text style={s.addInstructorBtnText}>Add instructor</Text>
            </TouchableOpacity>
          )}
        </View>

        {!!error && (
          <View style={s.errorCard}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Needs attention */}
        {issues.length > 0 ? (
          <View style={s.attentionCard} testID="v2-needs-attention">
            <Text style={s.attentionLabel}>Needs attention</Text>
            <View style={{ marginTop: 7 }}>
              {issues.map((i, idx) => (
                <TouchableOpacity
                  key={i.key}
                  style={[s.attentionRow, idx > 0 && { borderTopWidth: 1, borderTopColor: 'rgba(146,64,14,.15)' }]}
                  onPress={i.onPress}
                  testID={`v2-issue-${i.key}`}
                >
                  <Text style={s.attentionRowText}>{i.title}</Text>
                  <Text style={s.attentionChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <View style={s.allClearRow} testID="v2-all-clear">
            <View style={s.allClearTick}><Text style={s.allClearTickText}>✓</Text></View>
            <Text style={s.allClearText}>All caught up — no arrears, seats available.</Text>
          </View>
        )}

        {/* Revenue hero */}
        <View style={s.revenueCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <Text style={s.revenueLabel}>Revenue this month</Text>
            <TouchableOpacity style={s.eyeBtn} onPress={() => setIsRevenueHidden((v) => !v)} testID="v2-toggle-revenue">
              <Text style={s.eyeBtnText}>{isRevenueHidden ? 'Show' : 'Hide'}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 9 }}>
            <Text style={s.revenueValue}>
              {maskRevenue(`£${(leaderboard?.totals.revenue_month || 0).toFixed(0)}`, isRevenueHidden)}
            </Text>
            {!!revTrend && (
              <Text style={[s.trendText, revTrend.direction === 'down' && { color: '#FCA5A5' }]}>{revTrend.text}</Text>
            )}
          </View>
          <View style={s.revenueStatsRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.heroStatValue}>{leaderboard?.totals.students_active ?? 0}</Text>
              <Text style={s.heroStatKey}>Active students</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroStatValue}>{leaderboard?.totals.lessons_month ?? 0}</Text>
              <Text style={s.heroStatKey}>Lessons</Text>
              {!!lessonTrend && (
                <Text style={[s.heroStatTrend, lessonTrend.direction === 'down' && { color: '#FCA5A5' }]}>
                  {lessonTrend.text}
                </Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroStatValue}>{leaderboard?.totals.pass_rate ?? 0}%</Text>
              <Text style={s.heroStatKey}>Pass rate</Text>
            </View>
          </View>
        </View>

        {/* Test performance */}
        <View style={{ marginHorizontal: 20, marginTop: 22 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text style={s.sectionLabel}>Test performance</Text>
            <TouchableOpacity onPress={() => router.push('/student-crm-screen' as any)}>
              <Text style={s.sectionLinkText}>Log a test</Text>
            </TouchableOpacity>
          </View>
          <View style={s.perfCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <View>
                <Text style={s.perfPct}>{testKpis.practicalPassRatePct}%</Text>
                <Text style={s.perfPctLabel}>Practical pass rate</Text>
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={s.perfBarTrack}>
                  <View style={[s.perfBarFill, { width: `${testKpis.practicalPassRatePct}%` }]} />
                </View>
                <Text style={s.perfSplit}>
                  {testKpis.practicalPasses} passed · {testKpis.practicalTotal - testKpis.practicalPasses} failed
                  {' '}of {testKpis.practicalTotal}
                </Text>
              </View>
            </View>

            {recentPracticals.length > 0 && (
              <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.divider }}>
                <Text style={s.perfRecentLabel}>Most recent practical results</Text>
                <View style={{ marginTop: 10, gap: 9 }}>
                  {recentPracticals.map((t) => (
                    <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                      <Text style={[s.resultPill, t.result === 'pass' ? s.resultPass : s.resultFail]}>
                        {t.result === 'pass' ? 'PASS' : 'FAIL'}
                      </Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.resultTitle} numberOfLines={1}>
                          {new Date(`${t.test_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                        <Text style={s.resultMeta} numberOfLines={1}>
                          {t.driving_faults != null ? `${t.driving_faults} driving faults` : 'Practical test'}
                          {t.serious_faults ? ` · ${t.serious_faults} serious` : ''}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Quick actions */}
        <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 20, marginTop: 20 }}>
          {[
            { label: 'Students', route: '/student-crm-screen' },
            { label: 'Receipts', route: '/receipts-screen' },
            { label: 'Assignments', route: '/manage-assignments-screen' },
            { label: 'School', route: '/school-profile-screen' },
          ].map((a) => (
            <TouchableOpacity key={a.label} style={s.quickAction} onPress={() => router.push(a.route as any)} testID={`v2-qa-${a.label}`}>
              <Text style={s.quickActionText}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Was previously mislabeled — linked to /manage-assignments-screen
            (student reassignment, not an invite flow at all). The label
            and can_add_instructor gating (a seat-availability check) both
            clearly signal this was always meant to open the real
            add-instructor flow, just wired to the wrong destination.
            Found 1 Sept 2026 while confirming how Franchise
            multi-instructor schools work. Also added the missing isOwner
            check — this button's own form is owner-only, matching the
            other Add Instructor button elsewhere on this same page. */}
        {isOwner && leaderboard?.can_add_instructor && (
          <TouchableOpacity style={s.inviteBtn} onPress={() => setAddInstructorOpen(true)} testID="v2-invite-instructor">
            <Text style={s.inviteBtnText}>+ Invite instructor</Text>
          </TouchableOpacity>
        )}

        {/* Leaderboard */}
        <View style={{ marginHorizontal: 20, marginTop: 22 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <Text style={s.sectionLabel}>{isFranchise ? 'Instructor leaderboard' : 'Your performance'}</Text>
            {isFranchise && (
              <TouchableOpacity style={s.sortBtn} onPress={cycleSort} testID="v2-sort-leaderboard">
                <Text style={s.sortBtnText}>{SORT_LABEL[sortKey]} ⇅</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={{ marginTop: 9, gap: 8 }}>
            {sortedRows.map((r, idx) => (
              <View key={r.instructor_id} style={s.boardCard} testID={`v2-board-${r.instructor_id}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  {isFranchise && <Text style={s.rankBadge}>{idx + 1}</Text>}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.boardName} numberOfLines={1}>{r.full_name}</Text>
                      {r.is_owner && <Text style={s.ownerBadge}>OWNER</Text>}
                    </View>
                    <Text style={s.boardAdi}>{r.adi_number ? `ADI ${r.adi_number}` : 'No ADI number'}</Text>
                  </View>
                  <Text style={s.boardRevenue}>{maskRevenue(`£${r.revenue_month.toFixed(0)}`, isRevenueHidden)}</Text>
                </View>
                <View style={s.boardStatsRow}>
                  {[
                    { k: 'Students', v: String(r.students_active) },
                    { k: 'Lessons', v: String(r.lessons_month) },
                    { k: 'Pass rate', v: `${r.pass_rate}%` },
                  ].map((st) => (
                    <View key={st.k} style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={s.boardStatValue}>{st.v}</Text>
                      <Text style={s.boardStatKey}>{st.k}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>

          {!isFranchise && (
            <TouchableOpacity style={s.upsellCard} onPress={() => router.push('/pricing-screen' as any)} testID="v2-upsell">
              <Text style={s.upsellText}>
                Add instructors and see a ranked leaderboard on Franchise tier (£39.99/mo).
              </Text>
              <Text style={s.upsellChevron}>›</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Student allocations by date range — Franchise tier only.
            Counts students per instructor added within the range. */}
        {isFranchise && (
          <View style={{ marginHorizontal: 20, marginTop: 22 }}>
            <Text style={s.sectionLabel}>Student allocations</Text>
            <View style={s.allocRow}>
              <View style={{ flex: 1 }}>
                <DateField value={allocFrom} onChange={setAllocFrom} testID="v2-alloc-from" />
              </View>
              <Text style={s.allocSep}>to</Text>
              <View style={{ flex: 1 }}>
                <DateField value={allocTo} onChange={setAllocTo} testID="v2-alloc-to" />
              </View>
              <TouchableOpacity style={s.allocViewBtn} onPress={fetchAllocations} disabled={allocLoading} testID="v2-btn-view-allocations">
                {allocLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.allocViewBtnText}>View</Text>}
              </TouchableOpacity>
            </View>

            {allocError ? (
              <View style={s.errorCard}><Text style={s.errorText}>{allocError}</Text></View>
            ) : allocRows && allocRows.length === 0 ? (
              <View style={s.perfCard}><Text style={s.emptyMuted}>No students added in this date range.</Text></View>
            ) : allocRows ? (
              <View style={s.perfCard}>
                {allocRows.map((r, i) => (
                  <View key={r.instructor_id} style={[s.allocResultRow, i === allocRows.length - 1 && { borderBottomWidth: 0 }]} testID={`v2-alloc-row-${r.instructor_id}`}>
                    <Text style={s.allocResultName} numberOfLines={1}>{r.full_name}</Text>
                    <Text style={s.allocResultCount}>{r.student_count}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}

        {/* Today across the school — Franchise tier only, real-time via
            /api/v2/school/today. */}
        {isFranchise && (
          <View style={{ marginHorizontal: 20, marginTop: 22, marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={s.sectionLabel}>Today across the school</Text>
              <Text style={s.sectionLinkText}>{today.length} lesson{today.length === 1 ? '' : 's'}</Text>
            </View>
            {today.length === 0 ? (
              <View style={s.perfCard}>
                <Text style={s.emptyMuted}>Nothing scheduled today across the school.</Text>
                <TouchableOpacity style={[s.allocViewBtn, { alignSelf: 'flex-start', marginTop: 9 }]} onPress={() => router.push('/lesson-diary-screen' as any)} testID="v2-btn-empty-go-diary">
                  <Text style={s.allocViewBtnText}>Open diary</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ marginTop: 9, gap: 8 }}>
                {today.map((t) => (
                  <View key={t.lesson_id} style={s.todayCard} testID={`v2-today-${t.lesson_id}`}>
                    <View style={s.todayTimePill}>
                      <Text style={s.todayTimeText}>{fmtTime(t.start_time)}</Text>
                      <Text style={s.todayTimeText}>{fmtTime(t.end_time)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.todayStudent} numberOfLines={1}>{t.student_name || '(no student)'}</Text>
                      <Text style={s.todaySub} numberOfLines={1}>{t.instructor_name}{t.topic ? ` · ${t.topic}` : ''}</Text>
                    </View>
                    <Text style={[
                      s.todayStatus,
                      t.status === 'Cancelled' ? { backgroundColor: '#FEE2E2', color: '#B91C1C' }
                        : t.status === 'Completed' ? { backgroundColor: '#D1FAE5', color: '#047857' }
                        : { backgroundColor: C.primaryLight, color: C.primary },
                    ]}>
                      {t.status}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Add instructor form — owner-only (25 Aug 2026). Fields per Grant's
          exact list: full name, ADI/PDI number, mobile, email, address,
          car make/model, number plate. Name/ADI/mobile/email are required
          to actually send a usable invite; address and car details are
          asked for but not blocking, since an owner may not have every
          detail to hand yet when first adding someone. */}
      <Modal
        visible={addInstructorOpen}
        transparent
        animationType="slide"
        onRequestClose={() => !aiBusy && setAddInstructorOpen(false)}
      >
        <View style={s.formBackdrop}>
          <View style={s.formCard} testID="add-instructor-form">
            <View style={s.formHeader}>
              <Text style={s.formTitle}>Add instructor</Text>
              <TouchableOpacity onPress={() => !aiBusy && setAddInstructorOpen(false)} testID="add-instructor-close">
                <X size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
              <Text style={s.formLabel}>Full name *</Text>
              <TextInput style={s.formInput} value={aiFullName} onChangeText={setAiFullName} placeholder="e.g. Priya Shah" placeholderTextColor={C.textMuted} testID="ai-full-name" />
              <Text style={s.formLabel}>ADI/PDI number *</Text>
              <TextInput style={s.formInput} value={aiAdiNumber} onChangeText={setAiAdiNumber} placeholder="e.g. 123456" placeholderTextColor={C.textMuted} testID="ai-adi-number" />
              <Text style={s.formLabel}>Mobile number *</Text>
              <TextInput style={s.formInput} value={aiMobile} onChangeText={setAiMobile} keyboardType="phone-pad" placeholder="07700 900000" placeholderTextColor={C.textMuted} testID="ai-mobile" />
              <Text style={s.formLabel}>Email address *</Text>
              <TextInput style={s.formInput} value={aiEmail} onChangeText={setAiEmail} autoCapitalize="none" keyboardType="email-address" placeholder="name@example.co.uk" placeholderTextColor={C.textMuted} testID="ai-email" />
              <Text style={s.formLabel}>Address</Text>
              <TextInput style={s.formInput} value={aiAddress} onChangeText={setAiAddress} placeholder="12 High Street" placeholderTextColor={C.textMuted} testID="ai-address" />
              <Text style={s.formLabel}>Car make</Text>
              <TextInput style={s.formInput} value={aiCarMake} onChangeText={setAiCarMake} placeholder="e.g. Vauxhall" placeholderTextColor={C.textMuted} testID="ai-car-make" />
              <Text style={s.formLabel}>Car model</Text>
              <TextInput style={s.formInput} value={aiCarModel} onChangeText={setAiCarModel} placeholder="e.g. Corsa" placeholderTextColor={C.textMuted} testID="ai-car-model" />
              <Text style={s.formLabel}>Number plate</Text>
              <TextInput style={s.formInput} value={aiNumberPlate} onChangeText={(v) => setAiNumberPlate(v.toUpperCase())} autoCapitalize="characters" placeholder="AB12 CDE" placeholderTextColor={C.textMuted} testID="ai-number-plate" />
              {!!aiError && <Text style={s.formError}>{aiError}</Text>}
              <View style={{ height: 8 }} />
            </ScrollView>
            <TouchableOpacity
              style={[s.formSubmitBtn, aiBusy && { opacity: 0.6 }]}
              onPress={submitAddInstructor}
              disabled={aiBusy}
              testID="ai-submit"
            >
              {aiBusy ? <ActivityIndicator color="#fff" /> : <Text style={s.formSubmitBtnText}>Generate invite link</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Invite link result — same copy/SMS pattern as the student invite. */}
      <Modal
        visible={!!inviteResult}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteResult(null)}
      >
        <View style={s.formBackdrop}>
          <View style={[s.formCard, { maxHeight: undefined }]} testID="invite-link-result">
            <View style={s.formHeader}>
              <Text style={s.formTitle}>Invite link ready</Text>
              <TouchableOpacity onPress={() => setInviteResult(null)} testID="invite-result-close">
                <X size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={s.formHint}>
              Share this link with {inviteResult?.name.split(' ')[0]} — they'll set their own password and be added to your school automatically.
            </Text>
            <View style={s.linkBox} testID="invite-link-value">
              <Text style={s.linkText} numberOfLines={2}>{inviteResult?.link}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
              <TouchableOpacity
                style={[s.linkBtn, { backgroundColor: C.primary }]}
                onPress={() => inviteResult && copyToClipboard(inviteResult.link)}
                testID="invite-copy"
              >
                <Text style={s.linkBtnText}>Copy link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.linkBtn, { backgroundColor: '#EA580C' }]}
                onPress={() => inviteResult && openSmsComposer(
                  inviteResult.mobile,
                  `Hi ${inviteResult.name.split(' ')[0]}, you've been added as an instructor on ADI Pro. Tap to set your password: ${inviteResult.link}`,
                )}
                testID="invite-sms"
              >
                <Text style={s.linkBtnText}>Send via SMS</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },

  ownerLabel: { fontFamily: 'Archivo_800ExtraBold', fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: C.accent },
  tierPill: { fontFamily: 'Barlow_700Bold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: C.primary, backgroundColor: C.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  schoolName: { fontFamily: 'Archivo_800ExtraBold', fontSize: 22, letterSpacing: -0.45, color: C.text, marginTop: 5 },
  subline: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.textMuted2, marginTop: 2 },

  errorCard: { marginHorizontal: 20, marginTop: 14, backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 14, padding: 13 },
  errorText: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: '#B91C1C' },

  attentionCard: { marginHorizontal: 20, marginTop: 14, backgroundColor: C.warnBg, borderWidth: 1, borderColor: C.warnBorder, borderRadius: 16, padding: 13 },
  attentionLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.warnText },
  attentionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  attentionRowText: { flex: 1, fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.warnText },
  attentionChevron: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: C.warnChevron },

  allClearRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 14 },
  allClearTick: { width: 18, height: 18, borderRadius: 999, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' },
  allClearTickText: { color: '#fff', fontSize: 10, fontFamily: 'Barlow_700Bold' },
  allClearText: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: C.textMuted2, flex: 1 },

  revenueCard: { marginHorizontal: 20, marginTop: 14, backgroundColor: C.ink, borderRadius: 20, padding: 17 },
  revenueLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.7, textTransform: 'uppercase', color: 'rgba(255,255,255,.5)' },
  eyeBtn: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(255,255,255,.14)' },
  eyeBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 11.5, color: '#fff' },
  revenueValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 40, letterSpacing: -1.3, color: '#fff' },
  trendText: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#6EE7B7', paddingBottom: 6 },
  revenueStatsRow: { flexDirection: 'row', marginTop: 15, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.16)' },
  heroStatValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 22, letterSpacing: -0.4, color: '#fff' },
  heroStatKey: { fontFamily: 'Barlow_600SemiBold', fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2 },
  heroStatTrend: { fontFamily: 'Barlow_600SemiBold', fontSize: 10.5, color: '#6EE7B7', marginTop: 2 },

  sectionLabel: { fontFamily: 'Barlow_700Bold', fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: C.textMuted },
  // Fixed a real, silent duplicate-StyleSheet-key bug (1 Sept 2026): this
  // was also named `linkText`, identical to the muted, informational one
  // further down (for the invite-link display text) — JS's last-key-wins
  // behavior meant this one was dead, and the two tappable section links
  // below ("Log a test", "N lessons") were silently rendering in muted
  // grey instead of the intended primary-colored, link-like text.
  sectionLinkText: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: C.primary },

  perfCard: { marginTop: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 15 },
  perfPct: { fontFamily: 'Archivo_800ExtraBold', fontSize: 42, letterSpacing: -1.3, color: C.success },
  perfPctLabel: { fontFamily: 'Barlow_700Bold', fontSize: 9.5, letterSpacing: 1.3, textTransform: 'uppercase', color: C.textMuted, marginTop: 1 },
  perfBarTrack: { height: 8, borderRadius: 999, backgroundColor: C.divider, overflow: 'hidden' },
  perfBarFill: { height: '100%', borderRadius: 999, backgroundColor: '#10B981' },
  perfSplit: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, color: C.textMuted2 },
  perfRecentLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.textMuted },
  resultPill: { fontFamily: 'Archivo_800ExtraBold', fontSize: 9, letterSpacing: 1.2, color: '#fff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, overflow: 'hidden' },
  resultPass: { backgroundColor: '#10B981' },
  resultFail: { backgroundColor: '#EF4444' },
  resultTitle: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: C.text },
  resultMeta: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.textMuted2, marginTop: 1 },

  quickAction: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 12 },
  quickActionText: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: C.text },
  inviteBtn: { marginHorizontal: 20, marginTop: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,83,159,.25)', borderRadius: 12, backgroundColor: C.primaryLight },
  inviteBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: C.primary },

  sortBtn: { height: 32, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 9, backgroundColor: '#fff' },
  sortBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: C.text },

  boardCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14 },
  rankBadge: { fontFamily: 'Archivo_800ExtraBold', fontSize: 15, color: C.textMuted, width: 20 },
  boardName: { fontFamily: 'Archivo_700Bold', fontSize: 15.5, color: C.text, flexShrink: 1 },
  ownerBadge: { fontFamily: 'Archivo_800ExtraBold', fontSize: 8.5, letterSpacing: 1.2, color: '#fff', backgroundColor: C.accent, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  boardAdi: { fontFamily: 'Barlow_500Medium', fontSize: 11.5, color: C.textMuted2, marginTop: 2 },
  boardRevenue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 17, color: C.text },
  boardStatsRow: { flexDirection: 'row', marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.divider },
  boardStatValue: { fontFamily: 'Archivo_700Bold', fontSize: 17, color: C.text },
  boardStatKey: { fontFamily: 'Barlow_600SemiBold', fontSize: 11, color: C.textMuted2, marginTop: 1 },

  upsellCard: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.warmBg, borderWidth: 1, borderColor: C.warmBorder, borderRadius: 14, padding: 13 },
  upsellText: { flex: 1, fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 18, color: C.warnText },
  upsellChevron: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: C.warnChevron },

  emptyMuted: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: C.textMuted },

  allocRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  allocSep: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, color: C.textMuted },
  allocViewBtn: { height: 42, paddingHorizontal: 16, borderRadius: 11, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  allocViewBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13, color: '#fff' },
  allocResultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider },
  allocResultName: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.text, flex: 1 },
  allocResultCount: { fontFamily: 'Archivo_700Bold', fontSize: 17, color: C.text },

  todayCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 13 },
  todayTimePill: { alignItems: 'center', paddingHorizontal: 9 },
  todayTimeText: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: C.text },
  todayStudent: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },
  todaySub: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.textMuted2, marginTop: 1 },
  todayStatus: { fontFamily: 'Barlow_700Bold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },

  addInstructorBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', marginTop: 12, height: 42, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.primary },
  addInstructorBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: '#fff' },

  formBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  formCard: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: '86%' },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  formTitle: { fontFamily: 'Archivo_800ExtraBold', fontSize: 19, color: C.text },
  formLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: C.textMuted, marginTop: 12, marginBottom: 5 },
  formInput: { height: 46, paddingHorizontal: 13, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.surface, fontFamily: 'Barlow_400Regular', fontSize: 14, color: C.text },
  formError: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#B91C1C', marginTop: 12 },
  formSubmitBtn: { marginTop: 16, minHeight: 50, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  formSubmitBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: '#fff' },
  formHint: { fontFamily: 'Barlow_400Regular', fontSize: 13.5, lineHeight: 19, color: C.textMuted },

  linkBox: { marginTop: 12, backgroundColor: C.surface, borderRadius: 12, padding: 12 },
  linkText: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.textMuted2 },
  linkBtn: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linkBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: '#fff' },
});
