import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { useAuth } from '../src/AuthContext';
import {
  listMyLessonNoteQuestions, addLessonNoteQuestion, updateLessonNoteQuestion,
  removeLessonNoteQuestion, reorderLessonNoteQuestions, type LessonNoteQuestion,
} from '../src/supabaseDb';

export default function LessonNoteQuestionsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [questions, setQuestions] = useState<LessonNoteQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const load = async () => {
    if (!user?.instructor_id) return;
    try {
      const rows = await listMyLessonNoteQuestions(user.instructor_id);
      setQuestions(rows);
    } catch (e: any) {
      Alert.alert('Could not load questions', e?.message || 'Please apply Migration 029 first.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user?.instructor_id]);

  const handleAdd = async () => {
    if (!newQuestionText.trim() || !user?.instructor_id) return;
    setAdding(true);
    try {
      const q = await addLessonNoteQuestion(user.instructor_id, newQuestionText);
      setQuestions((prev) => [...prev, q]);
      setNewQuestionText('');
    } catch (e: any) {
      Alert.alert('Could not add question', e?.message || 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingText.trim()) return;
    try {
      await updateLessonNoteQuestion(id, editingText);
      setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, question_text: editingText.trim() } : q)));
      setEditingId(null);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    }
  };

  const handleDelete = (q: LessonNoteQuestion) => {
    Alert.alert(
      'Remove this question?',
      'It will no longer appear on new lesson notes. Any past answers already given are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeLessonNoteQuestion(q.id);
              setQuestions((prev) => prev.filter((x) => x.id !== q.id));
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
    if (targetIndex < 0 || targetIndex >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setQuestions(reordered);
    try {
      await reorderLessonNoteQuestions(reordered.map((q) => q.id));
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
        <Text style={styles.title}>Lesson Note Questions</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Text style={styles.subtitle}>
          These are the questions you'll answer after each lesson. Reorder, edit, or remove them — changes apply to new lesson notes only.
        </Text>

        {questions.map((q, i) => (
          <Card key={q.id} style={styles.qCard} testID={`question-${q.id}`}>
            <View style={styles.reorderCol}>
              <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0} hitSlop={8} testID={`btn-move-up-${q.id}`}>
                <ChevronUp size={16} color={i === 0 ? theme.colors.border : theme.colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => move(i, 1)} disabled={i === questions.length - 1} hitSlop={8} testID={`btn-move-down-${q.id}`}>
                <ChevronDown size={16} color={i === questions.length - 1 ? theme.colors.border : theme.colors.textMuted} />
              </TouchableOpacity>
            </View>

            {editingId === q.id ? (
              <TextInput
                style={styles.editInput}
                value={editingText}
                onChangeText={setEditingText}
                onBlur={() => handleSaveEdit(q.id)}
                onSubmitEditing={() => handleSaveEdit(q.id)}
                autoFocus
                testID={`input-edit-${q.id}`}
              />
            ) : (
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => { setEditingId(q.id); setEditingText(q.question_text); }}
                testID={`btn-edit-${q.id}`}
              >
                <Text style={styles.qText}>{q.question_text}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={() => handleDelete(q)} hitSlop={8} testID={`btn-delete-${q.id}`}>
              <Trash2 size={18} color={theme.colors.danger} />
            </TouchableOpacity>
          </Card>
        ))}

        <Card style={styles.addCard}>
          <TextInput
            style={styles.addInput}
            value={newQuestionText}
            onChangeText={setNewQuestionText}
            placeholder="Add a new question…"
            placeholderTextColor={theme.colors.textMuted}
            onSubmitEditing={handleAdd}
            testID="input-new-question"
          />
          <TouchableOpacity
            style={[styles.addBtn, (!newQuestionText.trim() || adding) && { opacity: 0.5 }]}
            onPress={handleAdd}
            disabled={!newQuestionText.trim() || adding}
            testID="btn-add-question"
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
  qCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  reorderCol: { gap: 2 },
  qText: { fontSize: 15, color: theme.colors.text, fontWeight: '500' },
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
