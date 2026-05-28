import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
  Alert, TextInput, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Trophy, Users, CalendarDays, PoundSterling, TrendingUp, Plus, Mail, LogOut,
  ChevronRight, Crown, ArrowUpDown, Receipt,
} from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import { useAuth } from '../src/AuthContext';
import { supabase } from '../src/supabaseClient';

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('revenue_month');

  // Invite-instructor sheet
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', adi_number: '' });

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
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Crown size={18} color={theme.colors.accent} />
              <Text style={styles.headerEyebrow}>School Owner</Text>
            </View>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {leaderboard?.business_name || 'Your driving school'}
            </Text>
            <Text style={styles.headerSub}>{monthLabel}</Text>
          </View>
          <TouchableOpacity onPress={signOut} style={styles.iconBtn} testID="btn-signout">
            <LogOut size={20} color={theme.colors.textMuted} />
          </TouchableOpacity>
        </View>

        {error ? (
          <Card style={{ marginHorizontal: 16, borderColor: theme.colors.danger, borderWidth: 1 }}>
            <Text style={{ color: theme.colors.danger }}>{error}</Text>
          </Card>
        ) : null}

        {/* School-wide KPIs */}
        <View style={styles.kpiGrid}>
          <KPI label="Active students" value={String(leaderboard?.totals.students_active ?? 0)}
               icon={<Users size={20} color={theme.colors.primary} />} bg={theme.colors.primaryLight} />
          <KPI label="Lessons (mo)" value={String(leaderboard?.totals.lessons_month ?? 0)}
               icon={<CalendarDays size={20} color={theme.colors.info} />} bg="#E0F2FE" />
          <KPI label="Revenue (mo)" value={`£${(leaderboard?.totals.revenue_month ?? 0).toFixed(0)}`}
               icon={<PoundSterling size={20} color={theme.colors.success} />} bg="#D1FAE5" />
          <KPI label="Pass rate" value={`${leaderboard?.totals.pass_rate ?? 0}%`}
               icon={<TrendingUp size={20} color={theme.colors.accent} />} bg="#FFF7ED" />
        </View>

        {/* Owner quick actions */}
        <View style={styles.qaRow}>
          <TouchableOpacity style={[styles.qa, { backgroundColor: theme.colors.primary }]}
                            onPress={() => setInviteOpen(true)} testID="qa-invite-instructor">
            <Mail size={18} color="#fff" />
            <Text style={styles.qaText}>Invite instructor</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.qa, { backgroundColor: theme.colors.accent }]}
                            onPress={() => router.push('/student-crm-screen')} testID="qa-students">
            <Users size={18} color="#fff" />
            <Text style={styles.qaText}>Students</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.qa, { backgroundColor: '#0EA5E9' }]}
                            onPress={() => router.push('/receipts-screen' as any)} testID="qa-receipts">
            <Receipt size={18} color="#fff" />
            <Text style={styles.qaText}>Receipts</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.qa, { backgroundColor: '#8B5CF6' }]}
                            onPress={() => router.push('/manage-assignments-screen' as any)}
                            testID="qa-assignments">
            <ArrowUpDown size={18} color="#fff" />
            <Text style={styles.qaText}>Assignments</Text>
          </TouchableOpacity>
        </View>

        {/* Per-instructor leaderboard */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Trophy size={18} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>Instructor leaderboard</Text>
          </View>
          <SortPicker value={sortKey} onChange={setSortKey} />
        </View>

        {sortedRows.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No instructors yet</Text>
            <Text style={styles.emptySub}>Tap "Invite instructor" to add your first colleague.</Text>
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
                <Text style={styles.lbRevenue}>£{r.revenue_month.toFixed(0)}</Text>
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
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing scheduled today</Text>
            <Text style={styles.emptySub}>The whole school has a quiet day. Use the time for admin tasks.</Text>
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
        title="Invite an instructor"
        testID="sheet-invite-instructor"
      >
        <Text style={styles.sheetIntro}>
          We'll email a Supabase Auth invite. They'll set their own password and join your school automatically.
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
      </BottomSheet>
    </SafeAreaView>
  );
}

function KPI({ label, value, icon, bg }: { label: string; value: string; icon: React.ReactNode; bg: string }) {
  return (
    <View style={[styles.kpi, { backgroundColor: bg }]} testID={`kpi-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
        {icon}
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
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, gap: 12 },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  headerEyebrow: { fontSize: 11, fontWeight: '800', color: theme.colors.accent, letterSpacing: 0.6, textTransform: 'uppercase' },
  headerTitle: { ...theme.font.h2, marginTop: 2 },
  headerSub: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, marginBottom: 12 },
  kpi: { width: '47%', minHeight: 80, borderRadius: 14, padding: 12, gap: 8 },
  kpiLabel: { fontSize: 12, color: theme.colors.textMuted, fontWeight: '600' },
  kpiValue: { fontSize: 22, fontWeight: '800', color: theme.colors.text },

  qaRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  qa: { flex: 1, height: 50, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  qaText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text },
  sectionSub: { fontSize: 12, color: theme.colors.textMuted },

  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  sortChipText: { fontSize: 12, fontWeight: '700', color: theme.colors.text },

  lbCard: { marginHorizontal: 16, marginBottom: 10, gap: 10 },
  lbHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lbRank: { fontSize: 14, fontWeight: '800', color: theme.colors.textMuted, width: 26 },
  lbName: { fontSize: 15, fontWeight: '700', color: theme.colors.text, flexShrink: 1 },
  lbSub: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  lbRevenue: { fontSize: 16, fontWeight: '800', color: theme.colors.primary },
  lbStats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 8 },
  statValue: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  statLabel: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },

  ownerPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  ownerPillText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },

  todayCard: { marginHorizontal: 16, marginBottom: 8 },
  timePill: { width: 60, alignItems: 'center', backgroundColor: theme.colors.primaryLight, paddingVertical: 6, borderRadius: 8 },
  timeText: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
  todayStudent: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  todaySub: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },

  emptyCard: { marginHorizontal: 16, marginBottom: 10, alignItems: 'center', paddingVertical: 24, gap: 4 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  emptySub: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', paddingHorizontal: 16 },

  // Sheet
  sheetIntro: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 8, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: theme.colors.background, color: theme.colors.text },
  sendBtn: { marginTop: 16, height: 50, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
