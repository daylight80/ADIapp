import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/AuthContext';
import { supabase } from '../src/supabaseClient';
import { isFranchiseTier, schoolDisplayName } from '../src/tiers';
import {
  listTestOutcomesForSchool, computeTestKpis, type TestOutcome, getArrearsSummary,
} from '../src/supabaseDb';

/**
 * TRIAL — Owner Dashboard, from the same Claude Design handoff (23 Aug
 * 2026). Separate route; the live owner-dashboard-screen.tsx is untouched.
 *
 * Unlike the home screen, this one was ALREADY on real data — it uses the
 * /v2/school/leaderboard and /v2/school/today backend endpoints. The fetch
 * logic, monthTrend() maths, revenue-privacy masking, and needs-attention
 * rules below are reproduced from the source screen deliberately rather
 * than reinvented, so behaviour stays identical and only the visuals change.
 *
 * Revenue privacy note: isRevenueHidden deliberately starts TRUE on every
 * mount and is never persisted — same as the source. That's intentional
 * (an owner shouldn't have revenue accidentally left visible in front of a
 * student), not an oversight to "fix".
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
  const [testOutcomes, setTestOutcomes] = useState<TestOutcome[]>([]);
  const [arrears, setArrears] = useState<{ count: number; total_gbp: number }>({ count: 0, total_gbp: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('revenue_month');
  const [isRevenueHidden, setIsRevenueHidden] = useState(true);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const headers = { Authorization: `Bearer ${token}` };

      const lr = await fetch(`${BACKEND}/api/v2/school/leaderboard`, { headers });
      if (!lr.ok) {
        const errBody = await lr.json().catch(() => ({}));
        throw new Error(errBody?.detail || `Leaderboard load failed (HTTP ${lr.status})`);
      }
      const lbJson = (await lr.json()) as Leaderboard;
      setLeaderboard(lbJson);

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
              <Text style={s.linkText}>Log a test</Text>
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

        {leaderboard?.can_add_instructor && (
          <TouchableOpacity style={s.inviteBtn} onPress={() => router.push('/manage-assignments-screen' as any)} testID="v2-invite-instructor">
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
      </ScrollView>
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
  linkText: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: C.primary },

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
});
