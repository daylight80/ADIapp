import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Plus, Trash2, ChevronRight, BookOpen } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { useAuth } from '../src/AuthContext';
import {
  listMySyllabuses, addSyllabus, removeSyllabus, type InstructorSyllabus,
} from '../src/supabaseDb';

/**
 * Customizable/multiple DVSA syllabuses (2 Sept 2026), per Grant's three
 * direct choices: separate, additional syllabuses alongside the standard
 * DVSA one (e.g. Motorway, Pass Plus) — the fixed 28-item DVSA_SYLLABUS
 * stays exactly as it is, never touched here; per-instructor scope; fully
 * custom categories within each new syllabus, managed on the next screen
 * (syllabus-categories-screen.tsx).
 */
export default function SyllabusesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [syllabuses, setSyllabuses] = useState<InstructorSyllabus[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    if (!user?.instructor_id) return;
    try {
      const rows = await listMySyllabuses(user.instructor_id);
      setSyllabuses(rows);
    } catch (e: any) {
      Alert.alert('Could not load syllabuses', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user?.instructor_id]);

  const handleAdd = async () => {
    if (!newName.trim() || !user?.instructor_id) return;
    setAdding(true);
    try {
      const s = await addSyllabus(user.instructor_id, newName);
      setSyllabuses((prev) => [...prev, s]);
      setNewName('');
      router.push({ pathname: '/syllabus-categories-screen', params: { syllabusId: s.id, syllabusName: s.name } });
    } catch (e: any) {
      Alert.alert('Could not add syllabus', e?.message || 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = (s: InstructorSyllabus) => {
    Alert.alert(
      `Remove "${s.name}"?`,
      'Its categories will no longer be offered for new students. Progress already recorded for any student is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeSyllabus(s.id);
              setSyllabuses((prev) => prev.filter((x) => x.id !== s.id));
            } catch (e: any) {
              Alert.alert('Could not remove', e?.message || 'Please try again.');
            }
          },
        },
      ],
    );
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
        <Text style={styles.title}>My Syllabuses</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Text style={styles.subtitle}>
          The standard 28-category DVSA syllabus is always available for every student. Add your own syllabuses
          here too — e.g. Motorway confidence, Pass Plus — each with its own categories to track.
        </Text>

        {syllabuses.map((s) => (
          <TouchableOpacity
            key={s.id}
            onPress={() => router.push({ pathname: '/syllabus-categories-screen', params: { syllabusId: s.id, syllabusName: s.name } })}
            testID={`syllabus-${s.id}`}
          >
            <Card style={styles.sCard}>
              <BookOpen size={18} color={theme.colors.primary} />
              <Text style={styles.sName}>{s.name}</Text>
              <TouchableOpacity onPress={() => handleDelete(s)} hitSlop={8} testID={`btn-delete-${s.id}`}>
                <Trash2 size={17} color={theme.colors.danger} />
              </TouchableOpacity>
              <ChevronRight size={17} color={theme.colors.textMuted} />
            </Card>
          </TouchableOpacity>
        ))}

        <Card style={styles.addCard}>
          <TextInput
            style={styles.addInput}
            value={newName}
            onChangeText={setNewName}
            placeholder="e.g. Motorway confidence"
            placeholderTextColor={theme.colors.textMuted}
            onSubmitEditing={handleAdd}
            testID="input-new-syllabus"
          />
          <TouchableOpacity
            style={[styles.addBtn, (!newName.trim() || adding) && { opacity: 0.5 }]}
            onPress={handleAdd}
            disabled={!newName.trim() || adding}
            testID="btn-add-syllabus"
          >
            {adding ? <ActivityIndicator size="small" color="#fff" /> : <Plus size={18} color="#fff" />}
          </TouchableOpacity>
        </Card>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },
  subtitle: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 18, marginBottom: 4 },
  sCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  sName: { flex: 1, fontSize: 15, color: theme.colors.text, fontWeight: '600' },
  addCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addInput: {
    flex: 1, fontSize: 15, color: theme.colors.text,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  addBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
});
