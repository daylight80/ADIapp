import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
  Alert, TextInput, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Trophy, Users, CalendarDays, PoundSterling, TrendingUp, Plus, Mail, LogOut,
  ChevronRight, Crown, ArrowUpDown, Receipt, Award, CircleX, AlertTriangle, UserPlus,
  Eye, EyeOff,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../src/theme';

import { Card, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import { useAuth } from '../src/AuthContext';
import { supabase } from '../src/supabaseClient';
import {
  listTestOutcomesForSchool, computeTestKpis, type TestOutcome,
  getArrearsSummary,
} from '../src/supabaseDb';

/**
 * AsyncStorage key used to persist the instructor's Privacy Mode preference
 * for masking revenue figures on the dashboard. Stored as '1' / '0'.
 * Namespaced with the `adi_pro_` prefix to avoid clashing with other apps.
 */
const REVENUE_PRIVACY_KEY = 'adi_pro_revenue_privacy_mode';

/** Stand-in shown when Privacy Mode is on. Renders as e.g. `£•••`. */
const REVENUE_MASK = '£•••';

/** Return either the masked placeholder or the original revenue string. */
function maskRevenue(value: string, hidden: boolean): string {
  return hidden ? REVENUE_MASK : value;
}

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type LeaderboardRow = {
  instructor_id: string;
  full_name: string;
  adi_number: string | null;
  is_owner: boolean;
  students_active: number;
  lessons_month: number;
  revenue_month: number;
  pass_rate: number;
};
type Leaderboard = {
  school_id: string;
  business_name: string | null;
  month_iso: string;
  tier: string;
  seat_count: number;
  seat_limit: number | null;     // null = unlimited
  can_add_instructor: boolean;
  totals: { students_active: number; lessons_month: number; revenue_month: number; pass_rate: number };
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

type SortKey = 'revenue_month' | 'lessons_month' | 'students_active' | 'pass_rate';

export default function OwnerDashboardScreen() {
  const router = useRouter();
  const { signOut, user } = useAuth();

  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [today, setToday] = useState<TodayLesson[]>([]);
  const [testOutcomes, setTestOutcomes] = useState<TestOutcome[]>([]);
  const [arrears, setArrears] = useState<{ count: number; total_gbp: number }>({ count: 0, total_gbp: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('revenue_month');

  // Invite-instructor sheet
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', adi_number: '' });

  // ---------------------------------------------------------------------------
  // Privacy Mode — masks financial earnings on the dashboard so an instructor
  // can show the screen to a student in the tuition vehicle without revealing
  // sensitive revenue figures. Persisted per-device via AsyncStorage so the
  // preference survives app restarts.
  // ---------------------------------------------------------------------------
  const [isRevenueHidden, setIsRevenueHidden] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(REVENUE_PRIVACY_KEY);
        if (stored === '1') setIsRevenueHidden(true);
      } catch {
        // best-effort — silently ignore storage read failures
      }
    })();
  }, []);
  const toggleRevenuePrivacy = useCallback(() => {
    setIsRevenueHidden((prev) => {
      const next = !prev;
      // Fire-and-forget — UI updates immediately; persistence happens in bg.
      AsyncStorage.setItem(REVENUE_PRIVACY_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const headers = { Authorization: `Bearer ${token}` };

      const [lr, tr] = await Promise.all([
        fetch(`${BACKEND}/api/v2/school/leaderboard`, { headers }),
        fetch(`${BACKEND}/api/v2/school/today`,       { headers }),
      ]);
      if (!lr.ok) {
        const errBody = await lr.json().catch(() => ({}));
        throw new Error(errBody?.detail || `Leaderboard load failed (HTTP ${lr.status})`);
      }
      const lbJson = (await lr.json()) as Leaderboard;
      const todayJson = tr.ok ? ((await tr.json()) as TodayLesson[]) : [];
      setLeaderboard(lbJson);
      setToday(todayJson);

      // Pull every test outcome across all instructors in this school.
      // Used by the "Test performance" card below the KPI grid.
      if (lbJson?.school_id) {
        try {
          const outcomes = await listTestOutcomesForSchool(lbJson.school_id);
          setTestOutcomes(outcomes);
        } catch (e) {
          // Non-fatal — empty state will render instead.
          // eslint-disable-next-line no-console
          console.warn('[owner] listTestOutcomesForSchool failed', e);
          setTestOutcomes([]);
        }

        // Arrears summary — count + total £ owed across the school. Backed by
        // Migration 022 view `students_with_balance`. Non-fatal if the view
        // isn't applied yet — the tile then shows "0 owing" and the user can
        // still navigate to the Students screen normally.
        try {
          const summary = await getArrearsSummary();
          setArrears(summary);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[owner] getArrearsSummary failed', e);
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
  const onRefresh = () => { setRefreshing(true); fetchAll(); };

  const sortedRows = useMemo(() => {
    if (!leaderboard) return [];
    return [...leaderboard.rows].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
  }, [leaderboard, sortKey]);

  // Aggregate KPIs across every test outcome in the school.
  // Theory tests are ignored at the KPI level — instructors focus on practical.
  const testKpis = useMemo(() => computeTestKpis(testOutcomes), [testOutcomes]);
  // Look up instructor name + student name for the 5 most recent results
  // so we can show them inline on the Test performance card.
  const instructorNameById = useMemo(() => {
    const m: Record<string, string> = {};
    leaderboard?.rows.forEach((r) => { m[r.instructor_id] = r.full_name; });
    return m;
  }, [leaderboard]);
  // Only practical results are surfaced in the "Most recent results" list
  // for consistency with the practical-only KPI.
  const recentOutcomes = useMemo(
    () => testOutcomes.filter((o) => o.test_type === 'practical').slice(0, 5),
    [testOutcomes],
  );

  const inviteInstructor = async () => {
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(inviteForm.email.trim())) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    setInviting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const resp = await fetch(`${BACKEND}/api/v2/instructors/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: inviteForm.email.trim(),
          full_name: inviteForm.full_name.trim() || undefined,
          adi_number: inviteForm.adi_number.trim() || undefined,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.detail || `Invite failed (HTTP ${resp.status})`);
      const ok = json?.sent !== false;
      Alert.alert(
        ok ? 'Invite sent' : 'Already a member',
        json?.detail || `Invite issued to ${inviteForm.email}.`,
      );
      setInviteOpen(false);
      setInviteForm({ email: '', full_name: '', adi_number: '' });
      fetchAll();
    } catch (e: any) {
      Alert.alert('Invite failed', e?.message || 'Could not send the invite.');
    } finally {
      setInviting(false);
    }
  };

  const fmtTime = (iso: string) => {
    if (!iso) return '';
    const t = iso.split('T')[1] || iso;
    return t.slice(0, 5);
  };
  const monthLabel = leaderboard?.month_iso
    ? new Date(leaderboard.month_iso + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : '';

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        testID="owner-dashboard-scroll"
      >
        {/* ============================================================
            HEADER — school name + instructor seat count
            ============================================================ */}
        <View style={styles.headerBlock}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Crown size={14} color={theme.colors.accent} />
              <Text style={styles.headerEyebrow}>School Owner</Text>
              {leaderboard?.tier && (
                <View style={[styles.tierPill, leaderboard.tier === 'franchise' ? styles.tierPillFranchise : styles.tierPillStarter]}>
                  <Text style={styles.tierPillText}>{leaderboard.tier.toUpperCase()}</Text>
                </View>
              )}
            </View>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {leaderboard?.business_name || 'Your driving school'}
            </Text>
            <Text style={styles.headerSub}>
              {monthLabel}
              {leaderboard
                ? ` · ${leaderboard.seat_count}/${leaderboard.seat_limit ?? '∞'} instructor seat${(leaderboard.seat_limit ?? 0) === 1 ? '' : 's'}`
                : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={signOut} style={styles.iconBtn} testID="btn-signout">
            <LogOut size={20} color={theme.colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* ============================================================
            ALERT BANNER — system warnings (seat-limit, etc.)
            Only renders when there is an actionable warning.
            ============================================================ */}
        {leaderboard && !leaderboard.can_add_instructor && (
          <TouchableOpacity
            style={styles.alertBanner}
            onPress={() => setInviteOpen(true)}
            activeOpacity={0.85}
            testID="alert-seat-limit"
          >
            <View style={styles.alertIconWrap}>
              <AlertTriangle size={16} color={theme.colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Seat limit reached</Text>
              <Text style={styles.alertSub}>
                Upgrade to add another instructor.
              </Text>
            </View>
            <ChevronRight size={18} color={theme.colors.textMuted} />
          </TouchableOpacity>
        )}

        {error ? (
          <Card style={{ marginHorizontal: 16, borderColor: theme.colors.danger, borderWidth: 1 }}>
            <Text style={{ color: theme.colors.danger }}>{error}</Text>
          </Card>
        ) : null}

        {/* School-wide KPIs */}
        <View style={styles.kpiGrid}>
          <KPI label="Active students" value={String(leaderboard?.totals.students_active ?? 0)}
               icon={<Users size={16} color={theme.colors.primary} />} tone={theme.colors.primaryLight} />
          <KPI label="Lessons (mo)" value={String(leaderboard?.totals.lessons_month ?? 0)}
               icon={<CalendarDays size={16} color={theme.colors.info} />} tone="#E0F2FE" />
          <KPI label="Revenue (mo)" value={maskRevenue(`£${(leaderboard?.totals.revenue_month ?? 0).toFixed(0)}`, isRevenueHidden)}
               icon={<PoundSterling size={16} color={theme.colors.success} />} tone="#D1FAE5"
               headerAccessory={
                 <TouchableOpacity
                   onPress={toggleRevenuePrivacy}
                   style={styles.privacyToggle}
                   hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                   accessibilityRole="button"
                   accessibilityLabel={isRevenueHidden ? 'Show revenue figures' : 'Hide revenue figures'}
                   accessibilityState={{ selected: isRevenueHidden }}
                   testID="btn-toggle-revenue-privacy"
                 >
                   {isRevenueHidden
                     ? <EyeOff size={16} color={theme.colors.textMuted} />
                     : <Eye size={16} color={theme.colors.textMuted} />}
                 </TouchableOpacity>
               }
          />
          <KPI label="Pass rate" value={`${leaderboard?.totals.pass_rate ?? 0}%`}
               icon={<TrendingUp size={16} color={theme.colors.accent} />} tone="#FFF7ED" />
        </View>

        {/* ============================================================
            ARREARS TILE — taps through to a filtered Students list
            showing only pupils with outstanding payments.
            ============================================================ */}
        <TouchableOpacity
          style={[styles.arrearsTile, arrears.count > 0 && styles.arrearsTileActive]}
          onPress={() => router.push({ pathname: '/student-crm-screen', params: { filter: 'arrears' } } as any)}
          activeOpacity={0.85}
          testID="tile-students-in-arrears"
          accessibilityRole="button"
          accessibilityLabel={`Students in arrears, ${arrears.count} students owing ${maskRevenue(`£${arrears.total_gbp}`, isRevenueHidden)}`}
        >
          <View style={[styles.arrearsIconWrap, arrears.count > 0 && { backgroundColor: '#FEF2F2' }]}>
            <AlertTriangle size={18} color={arrears.count > 0 ? theme.colors.danger : theme.colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.arrearsTitle}>Students in arrears</Text>
            <Text style={styles.arrearsSub}>
              {arrears.count === 0
                ? 'All pupil payments are up to date.'
                : `${arrears.count} pupil${arrears.count === 1 ? '' : 's'} owing ${maskRevenue(`£${arrears.total_gbp}`, isRevenueHidden)}`}
            </Text>
          </View>
          <ChevronRight size={18} color={theme.colors.textMuted} />
        </TouchableOpacity>

        {/* ------- Test Performance card ---------------------------------- */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Award size={18} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Test performance</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/student-crm-screen')} testID="btn-log-test">
            <Text style={styles.linkText}>Log a test</Text>
          </TouchableOpacity>
        </View>
        <Card style={styles.perfCard} testID="card-test-performance">
          {testKpis.total === 0 ? (
            <View style={styles.perfEmptyCompact} testID="empty-test-performance">
              <Text style={styles.perfEmptyCompactText}>
                No practical tests logged yet. Tap a student to record their first result.
              </Text>
              <TouchableOpacity
                style={styles.compactBtn}
                onPress={() => router.push('/student-crm-screen')}
                testID="btn-empty-go-students"
              >
                <Text style={styles.compactBtnText}>Open Students</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.perfTopRow}>
                <View style={styles.perfBigNumberBox}>
                  <Text style={styles.perfBigNumber}>{testKpis.practicalPassRatePct}%</Text>
                  <Text style={styles.perfBigLabel}>PRACTICAL PASS RATE</Text>
                  <Text style={styles.perfBigSub}>
                    {testKpis.practicalPasses} pass · {testKpis.practicalTotal - testKpis.practicalPasses} fail · {testKpis.practicalTotal} total
                  </Text>
                </View>
                <View style={styles.perfBreakdown}>
                  <BreakdownRow
                    label="Practical"
                    pct={testKpis.practicalPassRatePct}
                    pass={testKpis.practicalPasses}
                    total={testKpis.practicalTotal}
                  />
                </View>
              </View>
              {recentOutcomes.length > 0 && (
                <>
                  <View style={styles.perfDivider} />
                  <Text style={styles.perfRecentLabel}>Most recent practical results</Text>
                  {recentOutcomes.map((o) => {
                    const passed = o.result === 'pass';
                    return (
                      <View key={o.id} style={styles.perfRecentRow} testID={`recent-outcome-${o.id}`}>
                        <View style={[styles.perfRecentBadge, { backgroundColor: passed ? theme.colors.success : theme.colors.danger }]}>
                          {passed ? <Trophy size={12} color="#fff" /> : <CircleX size={12} color="#fff" />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.perfRecentTitle} numberOfLines={1}>
                            {passed ? 'Pass' : 'Fail'}
                            {o.test_centre ? ` · ${o.test_centre}` : ''}
                          </Text>
                          <Text style={styles.perfRecentMeta} numberOfLines={1}>
                            {new Date(o.test_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {instructorNameById[o.instructor_id] ? ` · ${instructorNameById[o.instructor_id]}` : ''}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </>
          )}
        </Card>

        {/* ============================================================
            QUICK ACTIONS — Students is the primary action, others outline.
            "Invite instructor" has moved into the alert banner / header.
            ============================================================ */}
        <View style={styles.qaRow}>
          <TouchableOpacity
            style={[styles.qa, styles.qaPrimary]}
            onPress={() => router.push('/student-crm-screen')}
            testID="qa-students"
            activeOpacity={0.85}
          >
            <Users size={18} color="#fff" />
            <Text style={styles.qaPrimaryText}>Students</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.qa, styles.qaSecondary]}
            onPress={() => router.push('/receipts-screen' as any)}
            testID="qa-receipts"
            activeOpacity={0.85}
          >
            <Receipt size={18} color={theme.colors.text} />
            <Text style={styles.qaSecondaryText}>Receipts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.qa, styles.qaSecondary]}
            onPress={() => router.push('/manage-assignments-screen' as any)}
            testID="qa-assignments"
            activeOpacity={0.85}
          >
            <ArrowUpDown size={18} color={theme.colors.text} />
            <Text style={styles.qaSecondaryText}>Assignments</Text>
          </TouchableOpacity>
        </View>

        {/* Inline "Invite instructor" CTA — only when there's seat capacity
            and the alert banner is therefore hidden. Keeps the action
            discoverable without the noisy multi-coloured tile row. */}
        {leaderboard?.can_add_instructor && (
          <TouchableOpacity
            style={styles.inviteCta}
            onPress={() => setInviteOpen(true)}
            testID="qa-invite-instructor"
            activeOpacity={0.85}
          >
            <UserPlus size={16} color={theme.colors.primary} />
            <Text style={styles.inviteCtaText}>Invite instructor</Text>
          </TouchableOpacity>
        )}

        {/* Per-instructor leaderboard */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Trophy size={18} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Instructor leaderboard</Text>
          </View>
          <SortPicker value={sortKey} onChange={setSortKey} />
        </View>

        {sortedRows.length === 0 ? (
          <Card style={styles.emptyCardCompact}>
            <Text style={styles.emptyCompactText}>
              No instructors yet. Add your first colleague to start growing.
            </Text>
            <TouchableOpacity
              style={styles.compactBtn}
              onPress={() => setInviteOpen(true)}
              testID="btn-empty-invite-instructor"
            >
              <Text style={styles.compactBtnText}>Invite</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          sortedRows.map((r, i) => (
            <Card key={r.instructor_id} style={styles.lbCard} testID={`lb-row-${r.instructor_id}`}>
              <View style={styles.lbHeader}>
                <Text style={styles.lbRank}>#{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.lbName} numberOfLines={1}>{r.full_name}</Text>
                    {r.is_owner && (
                      <View style={styles.ownerPill}>
                        <Crown size={10} color="#fff" />
                        <Text style={styles.ownerPillText}>OWNER</Text>
                      </View>
                    )}
                  </View>
                  {r.adi_number ? <Text style={styles.lbSub}>ADI #{r.adi_number}</Text> : null}
                </View>
                <Text style={styles.lbRevenue}>{maskRevenue(`£${r.revenue_month.toFixed(0)}`, isRevenueHidden)}</Text>
              </View>
              <View style={styles.lbStats}>
                <Stat label="Lessons" value={String(r.lessons_month)} />
                <Stat label="Students" value={String(r.students_active)} />
                <Stat label="Pass rate" value={`${r.pass_rate}%`} />
              </View>
            </Card>
          ))
        )}

        {/* Today's live diary */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <CalendarDays size={18} color={theme.colors.primary} />
            <Text style={styles.sectionTitle}>Today across the school</Text>
          </View>
          <Text style={styles.sectionSub}>{today.length} lesson{today.length === 1 ? '' : 's'}</Text>
        </View>

        {today.length === 0 ? (
          <Card style={styles.emptyCardCompact}>
            <Text style={styles.emptyCompactText}>
              Nothing scheduled today across the school.
            </Text>
            <TouchableOpacity
              style={styles.compactBtn}
              onPress={() => router.push('/lesson-diary-screen')}
              testID="btn-empty-go-diary"
            >
              <Text style={styles.compactBtnText}>Open diary</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          today.map((t) => (
            <Card key={t.lesson_id} style={styles.todayCard} testID={`today-${t.lesson_id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.timePill}>
                  <Text style={styles.timeText}>{fmtTime(t.start_time)}</Text>
                  <Text style={styles.timeText}>{fmtTime(t.end_time)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.todayStudent} numberOfLines={1}>
                    {t.student_name || '(no student)'}
                  </Text>
                  <Text style={styles.todaySub} numberOfLines={1}>
                    👤 {t.instructor_name}{t.topic ? ` · ${t.topic}` : ''}
                  </Text>
                </View>
                <Badge color={t.status === 'Cancelled' ? theme.colors.danger
                          : t.status === 'Completed' ? theme.colors.success
                          : theme.colors.info}>
                  {t.status}
                </Badge>
              </View>
            </Card>
          ))
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Invite-instructor bottom sheet */}
      <BottomSheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={leaderboard?.can_add_instructor ? 'Invite an instructor' : 'Upgrade to add instructors'}
        testID="sheet-invite-instructor"
      >
        {!leaderboard?.can_add_instructor ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.sheetIntro}>
              Your current <Text style={{ fontWeight: '700' }}>{leaderboard?.tier?.toUpperCase()}</Text> plan
              includes 1 instructor seat. Upgrade to the <Text style={{ fontWeight: '700' }}>Franchise</Text> tier
              for unlimited instructors and per-seat billing.
            </Text>
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: theme.colors.accent }]}
              onPress={() => { setInviteOpen(false); router.push('/pricing-screen'); }}
              testID="btn-upgrade-franchise"
            >
              <Text style={styles.sendBtnText}>View Franchise plan</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setInviteOpen(false)} style={{ alignSelf: 'center', marginTop: 8 }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>Not now</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.sheetIntro}>
              We&apos;ll email a Supabase Auth invite. They&apos;ll set their own password and join your school automatically.
            </Text>
            <Text style={styles.label}>Email address</Text>
            <TextInput
              style={styles.input}
              value={inviteForm.email}
              onChangeText={(t) => setInviteForm({ ...inviteForm, email: t })}
              placeholder="instructor@example.co.uk"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              testID="input-invite-email"
            />

            <Text style={styles.label}>Full name (optional)</Text>
            <TextInput
              style={styles.input}
              value={inviteForm.full_name}
              onChangeText={(t) => setInviteForm({ ...inviteForm, full_name: t })}
              placeholder="Jordan Lee"
              placeholderTextColor={theme.colors.textMuted}
              testID="input-invite-name"
            />

            <Text style={styles.label}>ADI number (optional)</Text>
            <TextInput
              style={styles.input}
              value={inviteForm.adi_number}
              onChangeText={(t) => setInviteForm({ ...inviteForm, adi_number: t })}
              placeholder="123456"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="number-pad"
              testID="input-invite-adi"
            />

            <TouchableOpacity
              style={[styles.sendBtn, inviting && { opacity: 0.6 }]}
              onPress={inviteInstructor}
              disabled={inviting}
              testID="btn-send-invite"
            >
              {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendBtnText}>Send invite</Text>}
            </TouchableOpacity>
          </>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

function KPI({ label, value, icon, tone, headerAccessory }: { label: string; value: string; icon: React.ReactNode; tone: string; headerAccessory?: React.ReactNode }) {
  return (
    <View style={styles.kpi} testID={`kpi-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <View style={styles.kpiHeader}>
        <View style={[styles.kpiIconBadge, { backgroundColor: tone }]}>
          {icon}
        </View>
        <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
        {headerAccessory}
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function BreakdownRow({ label, pct, pass, total }: { label: string; pct: number; pass: number; total: number }) {
  const hasData = total > 0;
  const tone = !hasData ? theme.colors.textMuted : pct >= 60 ? theme.colors.success : pct >= 40 ? theme.colors.accent : theme.colors.danger;
  return (
    <View style={styles.breakdownRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.breakdownLabel}>{label}</Text>
        <View style={styles.breakdownBarBg}>
          <View style={[styles.breakdownBarFill, { width: `${hasData ? pct : 0}%`, backgroundColor: tone }]} />
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', minWidth: 64 }}>
        <Text style={[styles.breakdownPct, { color: tone }]}>{hasData ? `${pct}%` : '—'}</Text>
        <Text style={styles.breakdownCount}>{hasData ? `${pass}/${total}` : 'No tests'}</Text>
      </View>
    </View>
  );
}

function SortPicker({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  const options: { key: SortKey; label: string }[] = [
    { key: 'revenue_month',   label: 'Revenue' },
    { key: 'lessons_month',   label: 'Lessons' },
    { key: 'students_active', label: 'Students' },
    { key: 'pass_rate',       label: 'Pass rate' },
  ];
  return (
    <TouchableOpacity
      style={styles.sortChip}
      testID="btn-sort"
      onPress={() => {
        const idx = options.findIndex((o) => o.key === value);
        const next = options[(idx + 1) % options.length];
        onChange(next.key);
      }}
    >
      <ArrowUpDown size={12} color={theme.colors.text} />
      <Text style={styles.sortChipText}>{options.find((o) => o.key === value)?.label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { paddingBottom: 32 },

  // ----- Header --------------------------------------------------------------
  headerBlock: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, gap: 12,
  },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  headerEyebrow: { fontSize: 11, fontWeight: '800', color: theme.colors.accent, letterSpacing: 0.6, textTransform: 'uppercase' },
  tierPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  tierPillStarter: { backgroundColor: theme.colors.textMuted },
  tierPillFranchise: { backgroundColor: theme.colors.success },
  tierPillText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.4 },
  headerTitle: { ...theme.font.h2, marginTop: 4 },
  headerSub: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },

  // ----- Alert banner (system warnings) -------------------------------------
  alertBanner: {
    marginHorizontal: 16, marginBottom: 14,
    padding: 12, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FEF3C7', // warm amber tint
    borderWidth: 1, borderColor: '#FDE68A',
  },
  alertIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#FFFBEB',
    alignItems: 'center', justifyContent: 'center',
  },
  alertTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  alertSub: { fontSize: 12, color: '#92400E', opacity: 0.85, marginTop: 1 },

  // ----- KPI cards (white, generous padding, icon-badge aligned to label) ---
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, marginBottom: 14 },
  kpi: {
    width: '47%',
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  kpiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kpiIconBadge: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  kpiLabel: { fontSize: 12, color: theme.colors.textMuted, fontWeight: '600', flex: 1 },
  kpiValue: { fontSize: 24, fontWeight: '800', color: theme.colors.text, lineHeight: 28 },

  // ----- Arrears tile (full-width, taps through to filtered Students list) ----
  arrearsTile: {
    marginHorizontal: 16, marginBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  arrearsTileActive: {
    backgroundColor: '#FFFBFB',
    borderColor: '#FECACA',
  },
  arrearsIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: theme.colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  arrearsTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  arrearsSub: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },

  // Privacy Mode toggle — small visible 28×28 button on the 8pt grid, but
  // the touch target is expanded to 52×52 via hitSlop above (well over the
  // 44 px minimum) so it's easy to tap while driving with a learner.
  privacyToggle: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },

  // ----- Quick actions (1 primary + 2 outline) ------------------------------
  qaRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  qa: {
    flex: 1, height: 48, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  qaPrimary: { backgroundColor: theme.colors.accent },
  qaPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  qaSecondary: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  qaSecondaryText: { color: theme.colors.text, fontWeight: '600', fontSize: 13 },
  qaText: { color: '#fff', fontWeight: '700', fontSize: 13 }, // kept for backwards-compat (unused)
  inviteCta: {
    marginHorizontal: 16, marginBottom: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 40, borderRadius: 10,
    backgroundColor: theme.colors.primaryLight,
    borderWidth: 1, borderColor: theme.colors.primary + '33',
  },
  inviteCtaText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },

  // ----- Section headers, sort chip -----------------------------------------
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text },
  sectionSub: { fontSize: 12, color: theme.colors.textMuted },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  sortChipText: { fontSize: 12, fontWeight: '700', color: theme.colors.text },

  // ----- Leaderboard cards --------------------------------------------------
  lbCard: { marginHorizontal: 16, marginBottom: 10, gap: 10 },
  lbHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lbRank: { fontSize: 14, fontWeight: '800', color: theme.colors.textMuted, width: 26 },
  lbName: { fontSize: 15, fontWeight: '700', color: theme.colors.text, flexShrink: 1 },
  // ADI number — bumped from #64748B (4.6:1) to #475569 (7.2:1) for WCAG AAA on white
  lbSub: { fontSize: 11, color: '#475569', marginTop: 2, fontWeight: '600' },
  lbRevenue: { fontSize: 16, fontWeight: '800', color: theme.colors.primary },
  lbStats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 8 },
  statValue: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  statLabel: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  linkText: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },

  // ----- Test performance card ----------------------------------------------
  perfCard: { marginHorizontal: 16, marginBottom: 12, padding: 16, gap: 12 },
  perfEmpty: { alignItems: 'center', paddingVertical: 16, gap: 6 }, // (legacy, unused)
  perfEmptyTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginTop: 6 },
  perfEmptySub: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 17 },
  perfEmptyCompact: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 4,
  },
  perfEmptyCompactText: {
    flex: 1, fontSize: 13, color: theme.colors.text, lineHeight: 18,
  },
  perfTopRow: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  perfBigNumberBox: {
    backgroundColor: theme.colors.primaryLight,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
    flexBasis: '40%',
  },
  perfBigNumber: { fontSize: 32, fontWeight: '900', color: theme.colors.primary, lineHeight: 36 },
  perfBigLabel: { fontSize: 10, color: theme.colors.primary, fontWeight: '800', letterSpacing: 0.8, marginTop: 4 },
  perfBigSub: { fontSize: 11, color: theme.colors.text, marginTop: 4, textAlign: 'center' },
  perfBreakdown: { flex: 1, gap: 12, justifyContent: 'center' },
  breakdownRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  breakdownLabel: { fontSize: 12, fontWeight: '700', color: theme.colors.text, marginBottom: 4 },
  breakdownBarBg: {
    height: 8, borderRadius: 4, backgroundColor: theme.colors.border, overflow: 'hidden',
  },
  breakdownBarFill: { height: '100%', borderRadius: 4 },
  breakdownPct: { fontSize: 16, fontWeight: '800' },
  breakdownCount: { fontSize: 11, color: theme.colors.textMuted, fontWeight: '600' },
  perfDivider: { height: 1, backgroundColor: theme.colors.border, marginTop: 4 },
  perfRecentLabel: {
    fontSize: 11, color: theme.colors.textMuted, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  perfRecentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  perfRecentBadge: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  perfRecentTitle: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
  perfRecentMeta: { fontSize: 11, color: theme.colors.textMuted, marginTop: 1 },

  ownerPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  ownerPillText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },

  todayCard: { marginHorizontal: 16, marginBottom: 8 },
  timePill: { width: 60, alignItems: 'center', backgroundColor: theme.colors.primaryLight, paddingVertical: 6, borderRadius: 8 },
  timeText: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
  todayStudent: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  todaySub: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },

  // ----- Empty-state cards (compact: single sentence + inline button) -------
  emptyCard: { marginHorizontal: 16, marginBottom: 10, alignItems: 'center', paddingVertical: 24, gap: 4 }, // legacy
  emptyTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  emptySub: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', paddingHorizontal: 16 },
  emptyCardCompact: {
    marginHorizontal: 16, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  emptyCompactText: {
    flex: 1, fontSize: 13, color: theme.colors.text, lineHeight: 18,
  },
  compactBtn: {
    paddingHorizontal: 14, height: 34,
    borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  compactBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Sheet
  sheetIntro: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 8, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: theme.colors.background, color: theme.colors.text },
  sendBtn: { marginTop: 16, height: 50, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
