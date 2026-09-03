import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import {
  listSyllabusCategories, addSyllabusCategory, renameSyllabusCategory,
  removeSyllabusCategory, reorderSyllabusCategories, type SyllabusCategory,
} from '../src/supabaseDb';

/**
 * Categories within one custom syllabus (2 Sept 2026) — the second half of
 * the customizable/multiple DVSA syllabuses feature. Structure mirrors
 * lesson-note-questions-screen.tsx closely (same add/edit/reorder/remove
 * shape), operating on instructor_syllabus_categories instead.
 */
export default function SyllabusCategoriesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ syllabusId?: string; syllabusName?: string }>();
  const syllabusId = typeof params.syllabusId === 'string' ? params.syllabusId : '';
  const syllabusName = typeof params.syllabusName === 'string' ? params.syllabusName : 'Syllabus';

  const [categories, setCategories] = useState<SyllabusCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const load = async () => {
    if (!syllabusId) return;
    try {
      const rows = await listSyllabusCategories(syllabusId);
      setCategories(rows);
    } catch (e: any) {
      Alert.alert('Could not load categories', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [syllabusId]);

  const handleAdd = async () => {
    if (!newName.trim() || !syllabusId) return;
    setAdding(true);
    try {
      const c = await addSyllabusCategory(syllabusId, newName);
      setCategories((prev) => [...prev, c]);
      setNewName('');
    } catch (e: any) {
      Alert.alert('Could not add category', e?.message || 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingText.trim()) return;
    try {
      await renameSyllabusCategory(id, editingText);
      setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name: editingText.trim() } : c)));
      setEditingId(null);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    }
  };

  const handleDelete = (c: SyllabusCategory) => {
    Alert.alert(
      'Remove this category?',
      'It will no longer be offered when applying this syllabus to a new student. Progress already recorded for any student is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeSyllabusCategory(c.id);
              setCategories((prev) => prev.filter((x) => x.id !== c.id));
            } catch (e: any) {
              Alert.alert('Could not remove', e?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  };

  const move = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categories.length) return;
    const reordered = [...categories];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setCategories(reordered);
    try {
      await reorderSyllabusCategories(reordered.map((c) => c.id));
    } catch {
      load(); // fall back to server order if the reorder failed to save
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
        <Text style={styles.title}>{syllabusName}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Text style={styles.subtitle}>
          The categories in this syllabus. Reorder, edit, or remove them — applies to any student you add this
          syllabus to from now on.
        </Text>

        {categories.map((c, i) => (
          <Card key={c.id} style={styles.cCard} testID={`category-${c.id}`}>
            <View style={styles.reorderCol}>
              <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0} hitSlop={8} testID={`btn-move-up-${c.id}`}>
                <ChevronUp size={16} color={i === 0 ? theme.colors.border : theme.colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => move(i, 1)} disabled={i === categories.length - 1} hitSlop={8} testID={`btn-move-down-${c.id}`}>
                <ChevronDown size={16} color={i === categories.length - 1 ? theme.colors.border : theme.colors.textMuted} />
              </TouchableOpacity>
            </View>

            {editingId === c.id ? (
              <TextInput
                style={styles.editInput}
                value={editingText}
                onChangeText={setEditingText}
                onBlur={() => handleSaveEdit(c.id)}
                onSubmitEditing={() => handleSaveEdit(c.id)}
                autoFocus
                testID={`input-edit-${c.id}`}
              />
            ) : (
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => { setEditingId(c.id); setEditingText(c.name); }}
                testID={`btn-edit-${c.id}`}
              >
                <Text style={styles.cText}>{c.name}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={() => handleDelete(c)} hitSlop={8} testID={`btn-delete-${c.id}`}>
              <Trash2 size={18} color={theme.colors.danger} />
            </TouchableOpacity>
          </Card>
        ))}

        <Card style={styles.addCard}>
          <TextInput
            style={styles.addInput}
            value={newName}
            onChangeText={setNewName}
            placeholder="Add a category…"
            placeholderTextColor={theme.colors.textMuted}
            onSubmitEditing={handleAdd}
            testID="input-new-category"
          />
          <TouchableOpacity
            style={[styles.addBtn, (!newName.trim() || adding) && { opacity: 0.5 }]}
            onPress={handleAdd}
            disabled={!newName.trim() || adding}
            testID="btn-add-category"
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
  cCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  reorderCol: { gap: 2 },
  cText: { fontSize: 15, color: theme.colors.text, fontWeight: '500' },
  editInput: {
    flex: 1, fontSize: 15, color: theme.colors.text, fontWeight: '500',
    borderBottomWidth: 1, borderBottomColor: theme.colors.primary, paddingVertical: 2,
  },
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
