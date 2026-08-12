import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Users,
  TrendingUp,
  CheckCircle2,
  CalendarDays,
  PoundSterling,
  Clock,
  LogOut,
  Plus,
  Crown,
  ChevronRight,
  Receipt,
} from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { mockDb } from '../src/mockDb';
import { isCurrentUserSchoolOwner } from '../src/supabaseDb';
import { Card, LockedFeature } from '../src/ui';
import { BottomNav } from '../src/BottomNav';
import { SimpleBarChart } from '../src/SimpleBarChart';
import { isPaidTier, tierById } from '../src/tiers';
import { ContactsImportBanner } from '../src/ContactsImportBanner';
import { useInstructorTestOutcomes } from '../src/useSupabaseData';
import { computeTestKpis } from '../src/supabaseDb';
import { Trophy } from 'lucide-react-native';

export default function InstructorHomeScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [roleChecked, setRoleChecked] = useState(false);
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  // Auto-redirect school owners to the dedicated owner dashboard.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const isOwner = await isCurrentUserSchoolOwner();
        if (active && isOwner) {
          router.replace('/owner-dashboard-screen' as any);
          return;
        }
      } catch {
        // fall through to standard instructor home
      }
      if (active) setRoleChecked(true);
    })();
    return () => { active = false; };
  }, [router]);

  const kpis = mockDb.getKPIs();
  const mtd = mockDb.getMTDStats();
  const todayLessons = mockDb.listTodayLessons();
  const earnings = mockDb.getEarningsByMonth();

  // Real DVSA test outcomes — drives the Pass Rate KPI and the breakdown card.
  // Only fetched for paid tiers (Growth+) per user spec; the hook itself is
  // cheap (single SELECT) but we still gate display below.
  const { rows: testOutcomes } = useInstructorTestOutcomes();
  const testKpis = computeTestKpis(testOutcomes);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  if (!roleChecked) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good day,</Text>
          <Text style={styles.name} testID="instructor-name">
            {user?.name || 'Instructor'}
          </Text>
        </View>
        <TouchableOpacity onPress={signOut} style={styles.logoutBtn} testID="btn-logout">
          <LogOut size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        testID="instructor-home-scroll"
      >
        {/* Onboarding — Import students from device Contacts.
            Auto-hides once handled (server-side via instructors.contacts_import_dismissed_at)
            or once the instructor has ≥3 students. */}
        <ContactsImportBanner studentCount={kpis.total} isInstructor={true} />

        {/* Upgrade banner (Starter tier only) */}
        {!isPaidTier(user?.tier) && (
          <TouchableOpacity
            style={styles.upgradeBanner}
            onPress={() => router.push('/pricing-screen')}
            testID="upgrade-banner"
            activeOpacity={0.9}
          >
            <View style={styles.upgradeIcon}>
              <Crown size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.upgradeTitle}>Upgrade to {tierById('growth').name}</Text>
              <Text style={styles.upgradeSub}>
                {kpis.total}/{tierById(user?.tier).student_limit} students used · unlock more students + invoicing from £{tierById('growth').price_gbp}/mo
              </Text>
            </View>
            <ChevronRight size={20} color="#fff" />
          </TouchableOpacity>
        )}
        {isPaidTier(user?.tier) && (
          <View style={styles.proBadgeBar} testID="pro-active-bar">
            <Crown size={16} color={theme.colors.accent} />
            <Text style={styles.proBadgeText}>{tierById(user?.tier).name} plan active</Text>
            <TouchableOpacity onPress={() => router.push('/pricing-screen')} testID="manage-billing">
              <Text style={styles.manageLink}>Manage</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* KPI Grid + MTD + Earnings — Growth tier and above */}
        {isPaidTier(user?.tier) ? (
          <>
            <View style={[styles.kpiGrid, isTablet && styles.kpiGridTablet]} testID="kpi-grid">
              <KPI
                label="Pass Rate"
                value={testKpis.total > 0 ? `${testKpis.passRatePct}%` : '—'}
                icon={<TrendingUp size={20} color={theme.colors.success} />}
                bg="#D1FAE5"
              />
              <KPI label="Active Students" value={kpis.active.toString()} icon={<Users size={20} color={theme.colors.primary} />} bg={theme.colors.primaryLight} />
              <KPI label="Test Ready" value={kpis.testReady.toString()} icon={<CheckCircle2 size={20} color={theme.colors.accent} />} bg="#FFF7ED" />
              <KPI label="Completed" value={kpis.completed.toString()} icon={<CalendarDays size={20} color={theme.colors.info} />} bg="#E0F2FE" />
            </View>

            {/* Test Performance — Practical-only (instructors focus on practical tests). */}
            <Card style={styles.testPerfCard} testID="card-test-performance">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Trophy size={16} color={theme.colors.primary} />
                <Text style={styles.testPerfTitle}>Test performance</Text>
              </View>
              {testKpis.practicalTotal === 0 ? (
                <Text style={styles.testPerfEmpty}>
                  No practical test outcomes logged yet. Open a student profile → "Log test" to record results.
                </Text>
              ) : (
                <>
                  <View style={styles.testPerfRow}>
                    <View style={styles.testPerfTile}>
                      <Text style={styles.testPerfLabel}>Practical</Text>
                      <Text style={[styles.testPerfValue, { color: theme.colors.success }]}>{testKpis.practicalPassRatePct}%</Text>
                      <Text style={styles.testPerfMeta}>
                        {testKpis.practicalPasses}/{testKpis.practicalTotal} passed
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </Card>
          </>
        ) : (
          <LockedFeature
            icon={<TrendingUp size={20} color={theme.colors.accent} />}
            title="KPI dashboard locked"
            subtitle="Track pass rate, active students, test-ready learners and MTD earnings — included from Growth tier (£14.99/mo)."
            testID="locked-kpi-card"
          />
        )}

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick actions</Text>
        <View style={styles.quickActions} testID="quick-actions">
          <TouchableOpacity
            style={[styles.qaBtn, styles.qaStudents]}
            onPress={() => router.push('/student-crm-screen')}
            testID="qa-students"
          >
            <Users size={20} color="#fff" />
            <Text style={styles.qaText}>Students</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.qaBtn, styles.qaDiary]}
            onPress={() => router.push('/lesson-diary-screen')}
            testID="qa-diary"
          >
            <CalendarDays size={20} color="#fff" />
            <Text style={styles.qaText}>Diary</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.qaBtn, styles.qaReceipts]}
            onPress={() => router.push('/receipts-screen' as any)}
            testID="qa-receipts"
          >
            <Receipt size={20} color="#fff" />
            <Text style={styles.qaText}>Receipts</Text>
          </TouchableOpacity>
        </View>

        {/* MTD Status — Growth+ */}
        {isPaidTier(user?.tier) && (
          <Card style={styles.mtdCard} testID="mtd-card">
            <Text style={styles.cardTitle}>Month to Date</Text>
            <View style={styles.mtdRow}>
              <View style={styles.mtdItem}>
                <View style={[styles.mtdIcon, { backgroundColor: theme.colors.primaryLight }]}>
                  <CalendarDays size={18} color={theme.colors.primary} />
                </View>
                <Text style={styles.mtdValue}>{mtd.lessons}</Text>
                <Text style={styles.mtdLabel}>Lessons</Text>
              </View>
              <View style={styles.mtdDivider} />
              <View style={styles.mtdItem}>
                <View style={[styles.mtdIcon, { backgroundColor: '#FFF7ED' }]}>
                  <PoundSterling size={18} color={theme.colors.accent} />
                </View>
                <Text style={styles.mtdValue}>£{mtd.earnings.toLocaleString()}</Text>
                <Text style={styles.mtdLabel}>Earnings</Text>
              </View>
            </View>
          </Card>
        )}

        {/* Earnings Chart — Growth+ */}
        {isPaidTier(user?.tier) && (
          <Card style={styles.chartCard} testID="earnings-chart-card">
            <Text style={styles.cardTitle}>Earnings (last 6 months)</Text>
            <SimpleBarChart
              data={earnings.map((e) => ({ label: e.month, value: e.value }))}
              color={theme.colors.primary}
              height={180}
            />
          </Card>
        )}

        {/* Today's lessons */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's lessons</Text>
          <TouchableOpacity onPress={() => router.push('/lesson-diary-screen')} testID="view-all-lessons">
            <Text style={styles.linkText}>View all</Text>
          </TouchableOpacity>
        </View>
        {todayLessons.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>No lessons scheduled for today.</Text>
          </Card>
        ) : (
          todayLessons.map((l) => {
            const s = mockDb.getStudent(l.student_id);
            return (
              <Card key={l.id} style={styles.lessonItem} testID={`today-lesson-${l.id}`}>
                <View style={styles.lessonTime}>
                  <Clock size={16} color={theme.colors.primary} />
                  <Text style={styles.lessonTimeText}>
                    {l.start_time} - {l.end_time}
                  </Text>
                </View>
                <Text style={styles.lessonStudent}>{s?.name || 'Student'}</Text>
                <Text style={styles.lessonTopic}>{l.topic}</Text>
              </Card>
            );
          })
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      <BottomNav role="instructor" />
    </SafeAreaView>
  );
}

function KPI({ label, value, icon, bg }: { label: string; value: string; icon: React.ReactNode; bg: string }) {
  return (
    <View style={styles.kpiCard} testID={`kpi-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <View style={[styles.kpiIcon, { backgroundColor: bg }]}>{icon}</View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  greeting: { ...theme.font.caption },
  name: { ...theme.font.h2 },
  logoutBtn: { padding: 8, borderRadius: 8 },
  scroll: { padding: 16, gap: 16, paddingBottom: 96 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpiGridTablet: {},
  kpiCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 10,
  },
  kpiIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontSize: 22, fontWeight: '700', color: theme.colors.text },
  kpiLabel: { ...theme.font.caption },
  sectionTitle: { ...theme.font.h3, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  linkText: { color: theme.colors.primary, fontWeight: '600', fontSize: 14 },
  quickActions: { flexDirection: 'row', gap: 12 },
  qaBtn: {
    flex: 1,
    height: 56,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  qaStudents: { backgroundColor: theme.colors.accent },
  qaDiary: { backgroundColor: theme.colors.primary },
  qaReceipts: { backgroundColor: '#0EA5E9' },
  // Test Performance card (Growth+ only — DVSA test_outcomes aggregate)
  testPerfCard: { marginBottom: 12, gap: 10 },
  testPerfTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  testPerfEmpty: { fontSize: 12, color: theme.colors.textMuted, lineHeight: 18 },
  testPerfRow: { flexDirection: 'row', gap: 8 },
  testPerfTile: {
    flex: 1, padding: 10, borderRadius: 10,
    backgroundColor: theme.colors.background,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: 'center', gap: 2,
  },
  testPerfLabel: { fontSize: 11, fontWeight: '700', color: theme.colors.textMuted, letterSpacing: 0.4 },
  testPerfValue: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  testPerfMeta: { fontSize: 10, color: theme.colors.textMuted },
  qaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  mtdCard: { gap: 12 },
  cardTitle: { ...theme.font.h3 },
  mtdRow: { flexDirection: 'row', alignItems: 'center' },
  mtdItem: { flex: 1, alignItems: 'center', gap: 6 },
  mtdIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  mtdValue: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  mtdLabel: { ...theme.font.caption },
  mtdDivider: { width: 1, height: 60, backgroundColor: theme.colors.border },
  chartCard: { gap: 12 },
  lessonItem: { gap: 6 },
  lessonTime: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lessonTimeText: { fontWeight: '600', color: theme.colors.primary, fontSize: 13 },
  lessonStudent: { fontWeight: '700', fontSize: 16, color: theme.colors.text },
  lessonTopic: { color: theme.colors.textMuted, fontSize: 13 },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', padding: 12 },
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    padding: 14,
  },
  upgradeIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  upgradeTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  upgradeSub: { color: '#ffffffdd', fontSize: 12, marginTop: 2 },
  proBadgeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  proBadgeText: { color: theme.colors.accent, fontWeight: '700', flex: 1 },
  manageLink: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },
});
