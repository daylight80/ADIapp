import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BottomNav } from '../src/BottomNav';
import { useStudents } from '../src/useSupabaseData';
import { listStudentBalances, listHoursBalanceForStudents, type StudentStatus } from '../src/supabaseDb';

/**
 * TRIAL — Students list, from the same Claude Design handoff (23 Aug 2026).
 * Separate route; the live student-crm-screen.tsx is untouched.
 *
 * Behaviour preserved from the source: the same 7 filter chips with live
 * counts, the same search matching (name OR email), and the ?filter=arrears
 * deep-link from the owner dashboard's arrears tile.
 *
 * New in the design, and genuinely useful: tapping a row EXPANDS it inline
 * to reveal quick actions and detail rows, rather than navigating straight
 * to the profile. "Open profile" is one of those actions, so the old
 * behaviour is still one tap away.
 *
 * Deliberately NOT reproduced here: the full add-student form, contacts
 * import, invite-link generation and paywall flows from the source screen.
 * Those are substantial, already-working features — the "+ Add student"
 * button below routes to the real screen rather than shipping a
 * half-built duplicate of them.
 */

const C = {
  surface: '#F5F2EC',
  border: '#E4DED2',
  divider: '#EDE8DE',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  faint: '#A69C8B',
  primary: '#00539F',
  accent: '#FF6B00',
  chipTrack: '#EDE8DE',
};

const STATUS_STYLE: Record<string, { solid: string; bg: string; fg: string }> = {
  New: { solid: '#00539F', bg: '#E5F0FA', fg: '#00539F' },
  Active: { solid: '#047857', bg: '#D1FAE5', fg: '#047857' },
  'Test Ready': { solid: '#C2410C', bg: '#FFF7ED', fg: '#C2410C' },
  Passed: { solid: '#0F172A', bg: '#0F172A', fg: '#FFFFFF' },
  Inactive: { solid: '#A69C8B', bg: '#EDE8DE', fg: '#8A8172' },
  Waitlist: { solid: '#92400E', bg: '#FEF3C7', fg: '#92400E' },
};

type FilterChip = 'All' | StudentStatus;
const FILTERS: FilterChip[] = ['All', 'Active', 'Test Ready', 'New', 'Passed', 'Inactive', 'Waitlist'];

function initialsOf(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function StudentsV2Screen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const { students, loading, refresh } = useStudents();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterChip>('All');
  const [arrearsActive, setArrearsActive] = useState(false);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [hoursBalances, setHoursBalances] = useState<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (params?.filter === 'arrears') setArrearsActive(true);
  }, [params?.filter]);

  useEffect(() => {
    listStudentBalances()
      .then((rows) => {
        const map: Record<string, number> = {};
        for (const r of rows) map[r.student_id] = r.outstanding_gbp;
        setBalances(map);
      })
      .catch(() => {});
  }, [students.length]);

  useEffect(() => {
    if (students.length === 0) return;
    let cancelled = false;
    listHoursBalanceForStudents(students.map((s) => s.id))
      .then((map) => { if (!cancelled) setHoursBalances(map); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [students]);

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const q = search.toLowerCase();
      const matchQ = !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
      const matchF = filter === 'All' || s.status === filter;
      const matchArrears = !arrearsActive || (balances[s.id] ?? 0) > 0;
      return matchQ && matchF && matchArrears;
    });
  }, [students, search, filter, arrearsActive, balances]);

  const counts = useMemo(() => ({
    Active: students.filter((s) => s.status === 'Active').length,
    'Test Ready': students.filter((s) => s.status === 'Test Ready').length,
    New: students.filter((s) => s.status === 'New').length,
    Passed: students.filter((s) => s.status === 'Passed').length,
    Inactive: students.filter((s) => s.status === 'Inactive').length,
    Waitlist: students.filter((s) => s.status === 'Waitlist').length,
  }), [students]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.resolve(refresh?.()).finally(() => setRefreshing(false));
  }, [refresh]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header + search */}
      <View style={s.headerBlock}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <Text style={s.title}>Students</Text>
          <Text style={s.countLine}>
            {filtered.length} of {students.length}
          </Text>
        </View>

        <View style={s.searchWrap}>
          <View style={s.searchDot} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name or email"
            placeholderTextColor={C.faint}
            testID="v2-students-search"
          />
          {!!search && (
            <TouchableOpacity style={s.clearBtn} onPress={() => setSearch('')} testID="v2-clear-search">
              <Text style={s.clearBtnText}>×</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter chips */}
      <View style={{ flexDirection: 'row' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingHorizontal: 20, paddingVertical: 12 }}>
          {FILTERS.map((f) => {
            const active = filter === f;
            const count = f === 'All' ? students.length : counts[f as Exclude<FilterChip, 'All'>];
            return (
              <TouchableOpacity
                key={f}
                style={[s.filterChip, active && s.filterChipActive]}
                onPress={() => setFilter(f)}
                testID={`v2-filter-${f}`}
              >
                <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{f}</Text>
                <Text style={[s.filterCount, active && s.filterCountActive]}>{count}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {arrearsActive && (
        <TouchableOpacity style={s.arrearsBanner} onPress={() => setArrearsActive(false)} testID="v2-clear-arrears">
          <Text style={s.arrearsBannerText}>Showing pupils in arrears only — tap to clear</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading && students.length === 0 ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={{ paddingVertical: 44, alignItems: 'center', gap: 6 }}>
            <Text style={s.emptyTitle}>No students match</Text>
            <Text style={s.emptySub}>Try a different name or clear the filter.</Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {filtered.map((st) => {
              const status = STATUS_STYLE[st.status] || STATUS_STYLE.New;
              const isOpen = expandedId === st.id;
              const owed = balances[st.id] ?? 0;
              const hours = hoursBalances[st.id] ?? 0;
              return (
                <View key={st.id} style={[s.card, isOpen && s.cardOpen]} testID={`v2-student-${st.id}`}>
                  <TouchableOpacity
                    style={s.cardHead}
                    onPress={() => setExpandedId(isOpen ? null : st.id)}
                    testID={`v2-student-toggle-${st.id}`}
                  >
                    <View style={[s.tile, { backgroundColor: status.solid }]}>
                      <Text style={s.tileText}>{initialsOf(st.name)}</Text>
                    </View>

                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      {!!st.test_date && (
                        <Text style={s.testBadge}>
                          Test {new Date(`${st.test_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </Text>
                      )}
                      <Text style={s.name} numberOfLines={1}>{st.name}</Text>
                      <Text style={s.meta} numberOfLines={1}>
                        {st.lessons_count} lesson{st.lessons_count === 1 ? '' : 's'}
                        {st.progress != null ? ` · ${st.progress}% ready` : ''}
                      </Text>
                    </View>

                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[s.statusBadge, { backgroundColor: status.bg, color: status.fg }]}>
                        {st.status}
                      </Text>
                      {owed > 0 ? (
                        <Text style={s.owedBadge}>£{owed.toFixed(2)} due</Text>
                      ) : hours > 0 ? (
                        <Text style={s.hoursBadge}>{hours.toFixed(1)}h left</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>

                  {isOpen && (
                    <View style={{ paddingHorizontal: 14, paddingBottom: 13, gap: 10 }}>
                      <View style={s.actionRow}>
                        <TouchableOpacity
                          style={[s.action, s.actionPrimary]}
                          onPress={() => router.push({ pathname: '/student-lifecycle-screen', params: { id: st.id } } as any)}
                          testID={`v2-open-profile-${st.id}`}
                        >
                          <Text style={s.actionPrimaryText}>Open profile</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.action}
                          onPress={() => router.push('/lesson-diary-screen' as any)}
                          testID={`v2-book-${st.id}`}
                        >
                          <Text style={s.actionText}>Book</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={{ gap: 5 }}>
                        {[
                          { k: 'Email', v: st.email || '—' },
                          { k: 'Phone', v: st.phone || '—' },
                          { k: 'Rate', v: st.hourly_rate ? `£${st.hourly_rate}/hr` : '—' },
                          ...(st.next_lesson
                            ? [{ k: 'Next', v: new Date(st.next_lesson).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) }]
                            : []),
                        ].map((d) => (
                          <View key={d.k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                            <Text style={s.detailKey}>{d.k}</Text>
                            <Text style={s.detailValue} numberOfLines={1}>{d.v}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${Math.min(100, st.progress ?? 0)}%`, backgroundColor: status.solid }]} />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <TouchableOpacity
        style={s.fab}
        onPress={() => router.push('/student-crm-screen' as any)}
        testID="v2-add-student"
      >
        <Text style={s.fabText}>+ Add student</Text>
      </TouchableOpacity>

      <BottomNav role="instructor" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },

  headerBlock: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 30, letterSpacing: -0.75, color: C.text },
  countLine: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.textMuted },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 46, marginTop: 12, paddingHorizontal: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 14 },
  searchDot: { width: 14, height: 14, borderWidth: 2, borderColor: C.faint, borderRadius: 999 },
  searchInput: { flex: 1, minWidth: 0, fontFamily: 'Barlow_500Medium', fontSize: 15, color: C.text },
  clearBtn: { width: 26, height: 26, borderRadius: 999, backgroundColor: C.chipTrack, alignItems: 'center', justifyContent: 'center' },
  clearBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 13, color: C.textMuted },

  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.text, borderColor: C.text },
  filterChipText: { fontFamily: 'Barlow_700Bold', fontSize: 13, color: C.textMuted },
  filterChipTextActive: { color: '#fff' },
  filterCount: { fontFamily: 'Archivo_700Bold', fontSize: 11.5, color: C.faint },
  filterCountActive: { color: 'rgba(255,255,255,.7)' },

  arrearsBanner: { marginHorizontal: 20, marginBottom: 10, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA' },
  arrearsBannerText: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#C2410C' },

  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, overflow: 'hidden' },
  cardOpen: { borderColor: C.text, borderWidth: 1.5 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  tile: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: 'Archivo_800ExtraBold', fontSize: 15, color: '#fff' },
  testBadge: { alignSelf: 'flex-start', fontFamily: 'Archivo_800ExtraBold', fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: '#fff', backgroundColor: C.text, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  name: { fontFamily: 'Archivo_700Bold', fontSize: 16.5, letterSpacing: -0.15, color: C.text },
  meta: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.textMuted2 },
  statusBadge: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 0.9, textTransform: 'uppercase', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  owedBadge: { fontFamily: 'Barlow_700Bold', fontSize: 11.5, color: '#C2410C', backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  hoursBadge: { fontFamily: 'Barlow_700Bold', fontSize: 11.5, color: '#047857', backgroundColor: '#D1FAE5', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },

  actionRow: { flexDirection: 'row', gap: 7, paddingTop: 11, borderTopWidth: 1, borderTopColor: C.divider },
  action: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: '#fff' },
  actionPrimary: { backgroundColor: C.primary, borderColor: C.primary },
  actionText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: C.text },
  actionPrimaryText: { fontFamily: 'Barlow_700Bold', fontSize: 13.5, color: '#fff' },

  detailKey: { fontFamily: 'Barlow_600SemiBold', fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: C.faint, paddingTop: 2 },
  detailValue: { flex: 1, fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: C.text, textAlign: 'right' },

  progressTrack: { height: 4, backgroundColor: C.divider },
  progressFill: { height: '100%' },

  emptyTitle: { fontFamily: 'Archivo_700Bold', fontSize: 17, color: C.text },
  emptySub: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: C.textMuted },

  fab: { position: 'absolute', right: 20, bottom: 96, height: 52, paddingHorizontal: 20, borderRadius: 999, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', shadowColor: C.accent, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 8 },
  fabText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: '#fff' },
});
