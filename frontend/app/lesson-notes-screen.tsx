import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Settings } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { useAuth } from '../src/AuthContext';
import {
  listMyLessonNoteQuestions, getLessonNotes, saveLessonNotes,
  type LessonNoteQuestion,
} from '../src/supabaseDb';

export default function LessonNotesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ lessonId?: string; studentId?: string; studentName?: string }>();
  const lessonId = typeof params.lessonId === 'string' ? params.lessonId : undefined;
  const studentId = typeof params.studentId === 'string' ? params.studentId : undefined;
  const studentName = typeof params.studentName === 'string' ? params.studentName : undefined;

  const [questions, setQuestions] = useState<LessonNoteQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user?.instructor_id || !lessonId) {
        Alert.alert('Missing lesson', 'Open this from a specific lesson to add notes.');
        router.back();
        return;
      }
      try {
        const [qList, existing] = await Promise.all([
          listMyLessonNoteQuestions(user.instructor_id),
          getLessonNotes(lessonId),
        ]);
        setQuestions(qList);
        setAnswers(existing?.answers || {});
      } catch (e: any) {
        Alert.alert('Could not load lesson notes', e?.message || 'Please apply Migration 029 first.');
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.instructor_id, lessonId]);

  const handleSave = async () => {
    if (!user?.instructor_id || !lessonId || !studentId) return;
    setSaving(true);
    try {
      await saveLessonNotes({ lessonId, studentId, instructorId: user.instructor_id, answers });
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save notes', e?.message || 'Please try again.');
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
            <ArrowLeft size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {studentName ? `Notes — ${studentName}` : 'Lesson Notes'}
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/lesson-note-questions-screen' as any)}
            style={styles.iconBtn}
            testID="btn-edit-questions"
            accessibilityLabel="Edit questions"
          >
            <Settings size={20} color={theme.colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {questions.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>
                You don't have any lesson note questions set up yet.
              </Text>
              <TouchableOpacity
                style={styles.setupBtn}
                onPress={() => router.push('/lesson-note-questions-screen' as any)}
                testID="btn-setup-questions"
              >
                <Text style={styles.setupBtnText}>Set up questions</Text>
              </TouchableOpacity>
            </Card>
          ) : (
            questions.map((q) => (
              <Card key={q.id} style={{ gap: 8 }}>
                <Text style={styles.questionLabel}>{q.question_text}</Text>
                <TextInput
                  style={styles.answerInput}
                  value={answers[q.id] || ''}
                  onChangeText={(text) => setAnswers((prev) => ({ ...prev, [q.id]: text }))}
                  placeholder="Your notes…"
                  placeholderTextColor={theme.colors.textMuted}
                  multiline
                  testID={`input-answer-${q.id}`}
                />
              </Card>
            ))
          )}

          {questions.length > 0 && (
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
              testID="btn-save-lesson-notes"
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save notes</Text>}
            </TouchableOpacity>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },
  questionLabel: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  answerInput: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.colors.text,
    backgroundColor: theme.colors.surface, minHeight: 60, textAlignVertical: 'top',
  },
  emptyText: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', marginBottom: 12 },
  setupBtn: {
    backgroundColor: theme.colors.primary, height: 44, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  setupBtnText: { color: '#fff', fontWeight: '700' },
  saveBtn: {
    backgroundColor: theme.colors.primary, height: 50, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
