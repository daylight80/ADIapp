import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Platform, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Users, ChevronRight, Crown, Check, ArrowRight } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import { supabase } from '../src/supabaseClient';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type SchoolInstructor = {
  id: string;
  full_name: string;
  adi_number: string | null;
  auth_user_id: string | null;
  is_owner: boolean;
};
type SchoolStudent = {
  id: string;
  full_name: string;
  email: string | null;
  status: string | null;
  instructor_id: string | null;
  progress: number | null;
};

export default function ManageAssignmentsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const [instructors, setInstructors] = useState<SchoolInstructor[]>([]);
  const [students, setStudents] = useState<SchoolStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection state — students staged for batch reassign
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Filter — which instructor's students are we viewing? null = unassigned summary
  const [filterInstructorId, setFilterInstructorId] = useState<string | 'all'>('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid) throw new Error('Not signed in');

      // Get the owner's school
      const { data: school, error: schoolErr } = await supabase
        .from('driving_schools')
        .select('id, owner_auth_id, business_name')
        .eq('owner_auth_id', uid)
        .maybeSingle();
      if (schoolErr) throw schoolErr;
      if (!school) throw new Error('You are not the owner of any school.');

      const [insRes, stuRes] = await Promise.all([
        supabase.from('instructors')
          .select('id, full_name, adi_number, auth_user_id')
          .eq('school_id', school.id)
          .order('full_name'),
        supabase.from('students')
          .select('id, full_name, email, status, instructor_id, progress')
          .eq('school_id', school.id)
          .order('full_name'),
      ]);
      if (insRes.error) throw insRes.error;
      if (stuRes.error) throw stuRes.error;

      const ownerId = school.owner_auth_id;
      const insList: SchoolInstructor[] = (insRes.data || []).map((r: any) => ({
        id: r.id, full_name: r.full_name, adi_number: r.adi_number ?? null,
        auth_user_id: r.auth_user_id ?? null, is_owner: r.auth_user_id === ownerId,
      }));
      const stuList: SchoolStudent[] = (stuRes.data || []).map((r: any) => ({
        id: r.id, full_name: r.full_name, email: r.email ?? null,
        status: r.status ?? null, instructor_id: r.instructor_id ?? null,
        progress: r.progress ?? 0,
      }));
      setInstructors(insList);
      setStudents(stuList);
    } catch (e: any) {
      setError(e?.message || 'Could not load assignments.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); load(); };

  const instructorById = useMemo(() => {
    const m = new Map<string, SchoolInstructor>();
    instructors.forEach((i) => m.set(i.id, i));
    return m;
  }, [instructors]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    students.forEach((s) => {
      if (s.instructor_id) m.set(s.instructor_id, (m.get(s.instructor_id) || 0) + 1);
    });
    return m;
  }, [students]);

  const visibleStudents = useMemo(() => {
    if (filterInstructorId === 'all') return students;
    return students.filter((s) => s.instructor_id === filterInstructorId);
  }, [students, filterInstructorId]);

  const toggleStudent = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllVisible = () => setSelected(new Set(visibleStudents.map((s) => s.id)));
  const clearSelection  = () => setSelected(new Set());

  const reassignTo = async (newInstructorId: string) => {
    if (selected.size === 0) {
      Alert.alert('No students selected', 'Tick the students you want to move first.');
      return;
    }
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const resp = await fetch(`${BACKEND}/api/v2/students/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          assignments: Array.from(selected).map((sid) => ({
            student_id: sid, new_instructor_id: newInstructorId,
          })),
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.detail || `Reassign failed (HTTP ${resp.status})`);
      const target = instructorById.get(newInstructorId)?.full_name || 'the chosen instructor';
      Alert.alert(
        'Reassigned',
        `${json.moved} student${json.moved === 1 ? '' : 's'} moved to ${target}.` +
          (json.skipped ? `\n${json.skipped} skipped.` : ''),
      );
      clearSelection();
      setPickerOpen(false);
      load();
    } catch (e: any) {
      Alert.alert('Reassign failed', e?.message || 'Could not move the selected students.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Student assignments</Text>
        <View style={{ width: 38 }} />
      </View>

      {error ? (
        <Card style={{ marginHorizontal: 16, borderColor: theme.colors.danger, borderWidth: 1 }}>
          <Text style={{ color: theme.colors.danger }}>{error}</Text>
        </Card>
      ) : null}

      {/* Instructor filter rail */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railRow}
        testID="instructor-rail"
      >
        <RailChip
          label={`All · ${students.length}`}
          active={filterInstructorId === 'all'}
          onPress={() => setFilterInstructorId('all')}
        />
        {instructors.map((i) => (
          <RailChip
            key={i.id}
            label={`${i.is_owner ? '👑 ' : ''}${i.full_name} · ${counts.get(i.id) || 0}`}
            active={filterInstructorId === i.id}
            onPress={() => setFilterInstructorId(i.id)}
          />
        ))}
      </ScrollView>

      {/* Selection toolbar */}
      {selected.size > 0 && (
        <View style={styles.selBar}>
          <Text style={styles.selBarText}>
            {selected.size} selected
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={clearSelection} style={styles.selBarBtnGhost} testID="btn-clear-sel">
              <Text style={styles.selBarBtnGhostText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setPickerOpen(true)} style={styles.selBarBtn}
              testID="btn-move-to"
            >
              <ArrowRight size={14} color="#fff" />
              <Text style={styles.selBarBtnText}>Move to…</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        testID="students-list"
      >
        {visibleStudents.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No students here</Text>
            <Text style={styles.emptySub}>
              {filterInstructorId === 'all'
                ? 'Your school has no students yet.'
                : 'This instructor has no assigned students.'}
            </Text>
          </Card>
        ) : (
          <>
            {filterInstructorId === 'all' && (
              <TouchableOpacity onPress={selectAllVisible} style={styles.selectAllBtn} testID="btn-select-all">
                <Text style={styles.selectAllText}>Select all visible</Text>
              </TouchableOpacity>
            )}

            {visibleStudents.map((s) => {
              const ins = s.instructor_id ? instructorById.get(s.instructor_id) : null;
              const checked = selected.has(s.id);
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.row, checked && styles.rowChecked]}
                  onPress={() => toggleStudent(s.id)}
                  testID={`row-${s.id}`}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                    {checked && <Check size={14} color="#fff" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{s.full_name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {ins ? `${ins.is_owner ? '👑 ' : ''}${ins.full_name}` : '⚠ Unassigned'}
                      {s.status ? ` · ${s.status}` : ''}
                    </Text>
                  </View>
                  {s.progress != null ? (
                    <Text style={styles.progress}>{Math.round(s.progress)}%</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </>
        )}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Picker sheet — where to move the selected students */}
      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`Move ${selected.size} student${selected.size === 1 ? '' : 's'} to…`}
        testID="sheet-move-to"
      >
        {instructors.length === 0 ? (
          <Text style={styles.empty}>No instructors available.</Text>
        ) : (
          instructors.map((i) => (
            <TouchableOpacity
              key={i.id}
              style={styles.pickRow}
              onPress={() => reassignTo(i.id)}
              disabled={saving}
              testID={`pick-${i.id}`}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.pickName}>{i.full_name}</Text>
                  {i.is_owner && (
                    <View style={styles.ownerPill}>
                      <Crown size={10} color="#fff" />
                      <Text style={styles.ownerPillText}>OWNER</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.pickSub}>
                  {counts.get(i.id) || 0} student{(counts.get(i.id) || 0) === 1 ? '' : 's'} currently
                  {i.adi_number ? ` · ADI #${i.adi_number}` : ''}
                </Text>
              </View>
              {saving ? <ActivityIndicator color={theme.colors.primary} /> : <ChevronRight size={18} color={theme.colors.textMuted} />}
            </TouchableOpacity>
          ))
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

function RailChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.railChip, active && styles.railChipActive]}
    >
      <Text style={[styles.railChipText, active && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, justifyContent: 'space-between' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },

  railRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  railChip: { backgroundColor: theme.colors.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: theme.colors.border },
  railChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  railChipText: { fontSize: 13, color: theme.colors.text },

  selBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.colors.primaryLight, paddingHorizontal: 16, paddingVertical: 8 },
  selBarText: { fontSize: 13, fontWeight: '700', color: theme.colors.primary },
  selBarBtn: { backgroundColor: theme.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  selBarBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  selBarBtnGhost: { paddingHorizontal: 8, paddingVertical: 8, borderRadius: 8 },
  selBarBtnGhostText: { color: theme.colors.primary, fontWeight: '600', fontSize: 13 },

  list: { padding: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  rowChecked: { backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.primary },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkboxChecked: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  rowName: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  rowSub: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  progress: { fontSize: 12, fontWeight: '700', color: theme.colors.success },

  selectAllBtn: { alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 6, marginBottom: 4 },
  selectAllText: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },

  emptyCard: { alignItems: 'center', paddingVertical: 32, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  emptySub: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center', paddingHorizontal: 24 },
  empty: { textAlign: 'center', color: theme.colors.textMuted, padding: 16 },

  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  pickName: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  pickSub: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  ownerPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  ownerPillText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
});
