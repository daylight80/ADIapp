import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, TextInput, Modal, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { UserPlus, X, ArrowLeft, ArrowLeftRight, Eye, EyeOff } from 'lucide-react-native';
import { useAuth } from '../src/AuthContext';
import { supabase } from '../src/supabaseClient';
import { DateField } from '../src/DateTimeFields';
import { isFranchiseTier, schoolDisplayName, tierById } from '../src/tiers';
import { copyToClipboard, openSmsComposer } from '../src/tools';
import {
  listTestOutcomesForSchool, computeTestKpis, type TestOutcome, getArrearsSummary,
  getMySchoolProfile, buildInstructorInviteLink, type InvitedInstructor,
} from '../src/supabaseDb';
import { inviteInstructor } from '../src/useSupabaseData';
import { formatDate } from '../src/dateFormat';
import { BOARD_SORTS, sortBoard, boardBarPct, boardMain, boardSub, revenueBars, todayTotals, type BoardSort } from '../src/schoolBoard';

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
  border: '#E3DED3',
  divider: '#EDE8DE',
  inset: '#F1EEE7',
  text: '#0F172A',
  textMuted: '#475569',
  textMuted2: '#475569',
  primary: '#00539F',
  primaryLight: '#E5F0FA',
  accent: '#FF6B00',
  ink: '#0F172A',
  success: '#047857',
  warnBg: '#FFF0DC',
  warnBorder: '#FED7AA',
  warnText: '#8A4400',
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

function Heading({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={s.headingRow}>
      <View style={s.headingBar} />
      <Text style={[s.sectionLabel, { flex: 1 }]}>{children}</Text>
      {right}
    </View>
  );
}

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
        : (process.env.EXPO_PUBLIC_APP_URL || 'https://webapp.drivingschoolsolutions.co.uk');
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
  const [sortKey, setSortKey] = useState<BoardSort>('revenue_month');
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
    return sortBoard(leaderboard.rows, sortKey);
  }, [leaderboard, sortKey]);

  const issues = useMemo(() => {
    const list: { key: string; title: string; onPress: () => void }[] = [];
    // Only a Franchise school can be "at its limit"; a solo Pro instructor at 1 of 1 is normal.
    if (leaderboard && isFranchise && !leaderboard.can_add_instructor) {
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
  }, [leaderboard, isFranchise, arrears, isRevenueHidden, router]);

  const recentPracticals = useMemo(
    () => testOutcomes.filter((t) => t.test_type === 'practical').slice(0, 5),
    [testOutcomes],
  );

  const fmtTime = (iso: string) => {
    if (!iso) return '';
    const t = iso.split('T')[1] || iso;
    return t.slice(0, 5);
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

  const schoolName = schoolDisplayName(user?.tier, leaderboard?.business_name, user?.name, user?.adi_number);
  const bars = revenueBars(leaderboard?.totals.revenue_month || 0, leaderboard?.totals_prev_month.revenue_month || 0);
  const todaySummary = todayTotals(today);
  const showAddInstructor = isOwner && (isFranchise || !!leaderboard?.can_add_instructor);
  const kpis: { key: string; value: string; label: string; note?: string; warn?: boolean }[] = [
    { key: 'lessons', value: String(leaderboard?.totals.lessons_month ?? 0), label: 'Lessons this month', note: lessonTrend?.text },
    { key: 'students', value: String(leaderboard?.totals.students_active ?? 0), label: 'Active pupils' },
    {
      key: 'pass', value: `${leaderboard?.totals.pass_rate ?? 0}%`, label: 'Pass rate',
      note: testKpis.practicalTotal > 0 ? `${testKpis.practicalTotal} practical tests` : undefined,
    },
    {
      key: 'owed', value: maskRevenue(`£${arrears.total_gbp}`, isRevenueHidden), label: 'Money owed',
      note: arrears.count > 0 ? `${arrears.count} pupil${arrears.count === 1 ? '' : 's'}` : 'Nobody owes anything', warn: arrears.count > 0,
    },
  ];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} />}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          {/* This screen has no bottom nav, so it needs its own way back to Home
              (added when Home gained a School dashboard entry, 26 Sept 2026). */}
          <TouchableOpacity style={s.backBtn} onPress={() => router.replace('/home-screen' as any)} testID="btn-back-home">
            <ArrowLeft size={18} color={C.textMuted2} />
            <Text style={s.backBtnText}>Home</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={s.ownerLabel}>Owner view · {new Date().toLocaleDateString('en-GB', { month: 'long' })}</Text>
                <Text style={s.tierPill}>{leaderboard?.tier || 'starter'}</Text>
              </View>
              <Text style={s.schoolName} numberOfLines={2}>{schoolName}</Text>
              <Text style={s.subline}>
                {leaderboard?.seat_count || 1} instructor{(leaderboard?.seat_count || 1) === 1 ? '' : 's'}
                {leaderboard?.seat_limit ? ` of ${leaderboard.seat_limit} seats` : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={s.avatar}
              onPress={() => router.push('/profile-screen' as any)}
              accessibilityRole="button"
              accessibilityLabel="Account: school owner"
              testID="v2-owner-avatar"
            >
              <Text style={s.avatarText}>{(schoolName || 'S').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!!error && (
          <View style={s.errorCard}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Revenue — sign-style card with this month against last month */}
        <View style={s.revenueCard} testID="v2-revenue-card">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
            <Text style={s.revenueLabel}>Revenue this month</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setIsRevenueHidden((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ selected: !isRevenueHidden }}
              testID="v2-toggle-revenue"
            >
              {isRevenueHidden ? <Eye size={20} color="#fff" /> : <EyeOff size={20} color="#fff" />}
              <Text style={s.eyeBtnText}>{isRevenueHidden ? 'Reveal' : 'Hide'}</Text>
            </TouchableOpacity>
          </View>
          <View style={s.revenueValueRow}>
            <Text style={s.revenueValue} testID="v2-revenue-value">
              {maskRevenue(`£${(leaderboard?.totals.revenue_month || 0).toFixed(0)}`, isRevenueHidden)}
            </Text>
            {!!revTrend && (
              <Text style={[s.trendPill, revTrend.direction === 'down' && s.trendPillDown]}>{revTrend.text}</Text>
            )}
          </View>
          <View style={{ paddingHorizontal: 4, gap: 8 }}>
            <View>
              <View style={s.revenueBarHead}>
                <Text style={s.revenueBarLabel}>This month</Text>
                <Text style={s.revenueBarLabel}>{maskRevenue(`£${(leaderboard?.totals.revenue_month || 0).toFixed(0)}`, isRevenueHidden)}</Text>
              </View>
              <View style={s.revenueBarTrack}><View style={[s.revenueBarFill, { width: `${bars.currentPct}%`, backgroundColor: C.accent }]} /></View>
            </View>
            <View>
              <View style={s.revenueBarHead}>
                <Text style={s.revenueBarLabel}>Last month</Text>
                <Text style={s.revenueBarLabel}>{maskRevenue(`£${(leaderboard?.totals_prev_month.revenue_month || 0).toFixed(0)}`, isRevenueHidden)}</Text>
              </View>
              <View style={s.revenueBarTrack}><View style={[s.revenueBarFill, { width: `${bars.previousPct}%`, backgroundColor: '#fff' }]} /></View>
            </View>
          </View>
        </View>

        {/* Key figures */}
        <View style={s.kpiGrid}>
          {kpis.map((k) => (
            <View key={k.key} style={[s.kpiTile, k.warn && s.kpiTileWarn]} testID={`v2-kpi-${k.key}`}>
              <Text style={[s.kpiValue, k.warn && { color: C.warnText }]}>{k.value}</Text>
              <Text style={[s.kpiLabel, k.warn && { color: C.warnText }]}>{k.label}</Text>
              {!!k.note && <Text style={[s.kpiNote, k.warn && { color: C.warnText }]}>{k.note}</Text>}
            </View>
          ))}
        </View>

        {/* Needs attention */}
        {issues.length > 0 ? (
          <View style={s.attentionCard} testID="v2-needs-attention">
            <Text style={s.attentionLabel}>Needs attention</Text>
            <View style={{ marginTop: 7 }}>
              {issues.map((i, idx) => (
                <TouchableOpacity
                  key={i.key}
                  style={[s.attentionRow, idx > 0 && { borderTopWidth: 1, borderTopColor: 'rgba(138,68,0,.2)' }]}
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

        {/* Leaderboard */}
        <View style={s.card}>
          <Heading>{isFranchise ? 'Instructor leaderboard' : 'Your performance'}</Heading>
          {isFranchise && (
            <View style={s.segment} accessibilityRole="tablist" testID="v2-sort-leaderboard">
              {BOARD_SORTS.map((o) => (
                <TouchableOpacity
                  key={o.key}
                  style={[s.segmentBtn, sortKey === o.key && s.segmentBtnOn]}
                  onPress={() => setSortKey(o.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: sortKey === o.key }}
                  testID={`v2-sort-${o.key}`}
                >
                  <Text style={[s.segmentText, sortKey === o.key && { color: '#fff' }]} numberOfLines={1}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View>
            {sortedRows.map((r, idx) => (
              <View key={r.instructor_id} style={s.boardRow} testID={`v2-board-${r.instructor_id}`}>
                {isFranchise && <Text style={[s.rankBadge, idx === 0 && s.rankBadgeFirst]}>{idx + 1}</Text>}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                      <Text style={s.boardName} numberOfLines={1}>{r.full_name}</Text>
                      {r.is_owner && <Text style={s.ownerBadge}>OWNER</Text>}
                    </View>
                    <Text style={s.boardMain}>{boardMain(r, sortKey, isRevenueHidden)}</Text>
                  </View>
                  <Text style={s.boardSub} numberOfLines={1}>
                    {r.adi_number ? `ADI ${r.adi_number}` : 'No ADI number'} · {boardSub(r, sortKey, isRevenueHidden)}
                  </Text>
                  <View style={s.boardTrack}>
                    <View style={[s.boardFill, { width: `${boardBarPct(r[sortKey], sortKey, sortedRows)}%`, backgroundColor: idx === 0 && isFranchise ? C.accent : C.primary }]} />
                  </View>
                </View>
              </View>
            ))}
          </View>

          {!isFranchise && (
            <TouchableOpacity style={s.upsellCard} onPress={() => router.push('/pricing-screen' as any)} testID="v2-upsell">
              <Text style={s.upsellText}>
                Add instructors and see a ranked leaderboard on Franchise tier (from £{tierById('franchise').price_gbp}/mo).
              </Text>
              <Text style={s.upsellChevron}>›</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Today across the school — Franchise tier only, real-time via /api/v2/school/today. */}
        {isFranchise && (
          <View style={s.card}>
            <Heading right={<Text style={s.sectionLinkText}>{today.length} lesson{today.length === 1 ? '' : 's'}</Text>}>Today across the school</Heading>
            <View style={s.tileRow}>
              <View style={s.tile}><Text style={s.tileValue}>{todaySummary.lessons}</Text><Text style={s.tileLabel}>lessons today</Text></View>
              <View style={s.tile}><Text style={s.tileValue}>{todaySummary.instructors}</Text><Text style={s.tileLabel}>instructors working</Text></View>
              <View style={s.tile}><Text style={s.tileValue}>{todaySummary.done}</Text><Text style={s.tileLabel}>done so far</Text></View>
            </View>
            {today.length === 0 ? (
              <View>
                <Text style={s.emptyMuted}>Nothing scheduled today across the school.</Text>
                <TouchableOpacity style={[s.allocViewBtn, { alignSelf: 'flex-start', marginTop: 9 }]} onPress={() => router.push('/lesson-diary-screen' as any)} testID="v2-btn-empty-go-diary">
                  <Text style={s.allocViewBtnText}>Open diary</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ gap: 2 }}>
                {today.map((t) => (
                  <View key={t.lesson_id} style={s.todayRow} testID={`v2-today-${t.lesson_id}`}>
                    <View style={s.todayTimePill}>
                      <Text style={s.todayTimeText}>{fmtTime(t.start_time)}</Text>
                      <Text style={s.todayTimeEnd}>{fmtTime(t.end_time)}</Text>
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

        {/* Test performance */}
        <View style={s.card}>
          <Heading right={
            <TouchableOpacity onPress={() => router.push('/student-crm-screen' as any)}>
              <Text style={s.sectionLinkText}>Log a test</Text>
            </TouchableOpacity>
          }>Test performance</Heading>
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
            <View style={{ paddingTop: 12, borderTopWidth: 1, borderTopColor: C.divider }}>
              <Text style={s.perfRecentLabel}>Most recent practical results</Text>
              <View style={{ marginTop: 10, gap: 9 }}>
                {recentPracticals.map((t) => (
                  <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <Text style={[s.resultPill, t.result === 'pass' ? s.resultPass : s.resultFail]}>
                      {t.result === 'pass' ? 'PASS' : 'FAIL'}
                    </Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.resultTitle} numberOfLines={1}>
                        {formatDate(`${t.test_date}T00:00:00`)}
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

        {/* Student allocations by date range — Franchise tier only. Counts students per instructor added within the range. */}
        {isFranchise && (
          <View style={s.card}>
            <Heading>Student allocations</Heading>
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
              <View style={s.errorInline}><Text style={s.errorText}>{allocError}</Text></View>
            ) : allocRows && allocRows.length === 0 ? (
              <Text style={s.emptyMuted}>No students added in this date range.</Text>
            ) : allocRows ? (
              <View>
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

        {/* Quick actions */}
        <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 20 }}>
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
      </ScrollView>

      {/* Owner actions, always in reach: the design's bottom bar. Add instructor opens the same form as before. */}
      {(showAddInstructor || isFranchise) && (
        <View style={s.dock} testID="v2-owner-dock">
          {showAddInstructor && (
            <TouchableOpacity style={s.dockPrimary} onPress={() => setAddInstructorOpen(true)} accessibilityRole="button" testID="btn-add-instructor">
              <UserPlus size={22} color={C.ink} />
              <Text style={s.dockPrimaryText}>Add instructor</Text>
            </TouchableOpacity>
          )}
          {isFranchise && (
            <TouchableOpacity style={s.dockOutline} onPress={() => router.push('/manage-assignments-screen' as any)} accessibilityRole="button" testID="v2-dock-reassign">
              <ArrowLeftRight size={22} color={C.primary} />
              <Text style={s.dockOutlineText}>Reassign pupils</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

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
              Share this link with {inviteResult?.name.split(' ')[0]} — they&apos;ll set their own password and be added to your school automatically.
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
                  `Hi ${inviteResult.name.split(' ')[0]}, you've been added as an instructor on DualControl. Tap to set your password: ${inviteResult.link}`,
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

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 6 },
  backBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: C.textMuted2 },
  ownerLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, letterSpacing: 0.9, textTransform: 'uppercase', color: C.textMuted },
  tierPill: { fontFamily: 'Barlow_700Bold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: C.primary, backgroundColor: C.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  schoolName: { fontFamily: 'Archivo_800ExtraBold', fontSize: 24, letterSpacing: -0.3, color: C.text, marginTop: 3 },
  subline: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: C.textMuted2, marginTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.primary, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 14, color: C.primary },

  errorCard: { marginHorizontal: 16, marginTop: 14, backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 14, padding: 13 },
  errorInline: { backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 14, padding: 13 },
  errorText: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: '#B91C1C' },

  attentionCard: { marginHorizontal: 16, marginTop: 16, backgroundColor: C.warnBg, borderWidth: 1, borderColor: C.warnBorder, borderRadius: 16, padding: 13 },
  attentionLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.warnText },
  attentionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  attentionRowText: { flex: 1, fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.warnText },
  attentionChevron: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: C.warnChevron },

  allClearRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 16 },
  allClearTick: { width: 18, height: 18, borderRadius: 999, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' },
  allClearTickText: { color: '#fff', fontSize: 10, fontFamily: 'Barlow_700Bold' },
  allClearText: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: C.textMuted2, flex: 1 },

  // Sign-style card: blue with an orange pill, as in the design.
  revenueCard: { marginHorizontal: 16, marginTop: 20, backgroundColor: C.primary, borderWidth: 2, borderColor: C.primary, borderRadius: 20, paddingTop: 16, paddingHorizontal: 12, paddingBottom: 16, gap: 14 },
  revenueLabel: { fontFamily: 'Archivo_800ExtraBold', fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#fff' },
  eyeBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyeBtnText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 14, color: '#fff' },
  revenueValueRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, paddingHorizontal: 4 },
  revenueValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 40, color: '#fff' },
  trendPill: { fontFamily: 'Archivo_800ExtraBold', fontSize: 13, color: C.ink, backgroundColor: C.accent, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, overflow: 'hidden' },
  trendPillDown: { backgroundColor: '#FECACA' },
  revenueBarHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  revenueBarLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: '#fff' },
  revenueBarTrack: { height: 14, borderRadius: 7, backgroundColor: 'rgba(255,255,255,.2)', overflow: 'hidden' },
  revenueBarFill: { height: 14, borderRadius: 7 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: 16, marginTop: 20 },
  kpiTile: { flexBasis: '47%', flexGrow: 1, minHeight: 96, padding: 14, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  kpiTileWarn: { backgroundColor: C.warnBg, borderColor: C.warnBorder },
  kpiValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 30, color: C.text },
  kpiLabel: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: C.text, marginTop: 6 },
  kpiNote: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: C.textMuted, marginTop: 2 },

  card: { marginHorizontal: 16, marginTop: 20, padding: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 20, gap: 12 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingBar: { width: 18, height: 4, borderRadius: 2, backgroundColor: C.accent },
  sectionLabel: { fontFamily: 'Archivo_800ExtraBold', fontSize: 13, letterSpacing: 1.3, textTransform: 'uppercase', color: C.textMuted },
  sectionLinkText: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: C.primary },

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
  segment: { flexDirection: 'row', gap: 4, backgroundColor: C.inset, borderRadius: 14, padding: 4 },
  segmentBtn: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  segmentBtnOn: { backgroundColor: C.primary },
  segmentText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 13, color: C.text },

  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingVertical: 8 },
  rankBadge: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', textAlign: 'center', lineHeight: 32, fontFamily: 'Archivo_800ExtraBold', fontSize: 15, color: C.primary, backgroundColor: C.primaryLight },
  rankBadgeFirst: { color: C.ink, backgroundColor: C.accent },
  boardName: { fontFamily: 'Archivo_800ExtraBold', fontSize: 17, color: C.text, flexShrink: 1 },
  ownerBadge: { fontFamily: 'Archivo_800ExtraBold', fontSize: 9, letterSpacing: 1.2, color: C.ink, backgroundColor: C.accent, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  boardMain: { fontFamily: 'Archivo_800ExtraBold', fontSize: 20, color: C.text },
  boardSub: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: C.textMuted, marginTop: 1 },
  boardTrack: { height: 8, borderRadius: 4, backgroundColor: C.inset, marginTop: 6, overflow: 'hidden' },
  boardFill: { height: 8, borderRadius: 4 },

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

  tileRow: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: C.inset, borderRadius: 12, padding: 10 },
  tileValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 24, color: C.text },
  tileLabel: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: C.textMuted, marginTop: 4 },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8 },
  todayTimePill: { alignItems: 'center', width: 46 },
  todayTimeText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 14, color: C.text },
  todayTimeEnd: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.textMuted },
  todayStudent: { fontFamily: 'Barlow_700Bold', fontSize: 16, color: C.text },
  todaySub: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: C.textMuted, marginTop: 1 },
  todayStatus: { fontFamily: 'Barlow_700Bold', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, overflow: 'hidden' },

  // The design's bottom bar of owner actions.
  dock: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  dockPrimary: { flex: 1, minHeight: 56, borderRadius: 14, backgroundColor: C.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dockPrimaryText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 15, color: C.ink },
  dockOutline: { flex: 1, minHeight: 56, borderRadius: 14, borderWidth: 2, borderColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dockOutlineText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 15, color: C.primary },

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
