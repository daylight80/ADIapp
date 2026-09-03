import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Settings, Sparkles } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { useAuth } from '../src/AuthContext';
import { supabase } from '../src/supabaseClient';
import {
  listMyLessonNoteQuestions, getLessonNotes, saveLessonNotes,
  type LessonNoteQuestion,
} from '../src/supabaseDb';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function LessonNotesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ lessonId?: string; studentId?: string; studentName?: string }>();
  const lessonId = typeof params.lessonId === 'string' ? params.lessonId : undefined;
  const studentId = typeof params.studentId === 'string' ? params.studentId : undefined;
  const studentName = typeof params.studentName === 'string' ? params.studentName : undefined;

  const [questions, setQuestions] = useState<LessonNoteQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notesSaved, setNotesSaved] = useState(false);
  const [debrief, setDebrief] = useState<string | null>(null);
  const [generatingDebrief, setGeneratingDebrief] = useState(false);
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
        setNotesSaved(!!existing);
        setDebrief(existing?.ai_debrief || null);
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
      // Stays on screen now instead of navigating back immediately (2 Sept
      // 2026) — added so the instructor can generate an AI debrief right
      // after saving, without leaving and reopening this screen. The back
      // arrow in the header still leaves whenever they're actually done.
      setNotesSaved(true);
    } catch (e: any) {
      Alert.alert('Could not save notes', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // AI-generated debrief (2 Sept 2026) — text version, per Grant's
  // decision after comparing against a voice-note approach. Turns the
  // notes just saved into a short, polished, student-facing summary via
  // the backend (which owns the Anthropic call — the app never talks to
  // Claude directly). Requires a fresh save first (see notesSaved), so
  // the debrief is always generated from what's actually on screen, not
  // stale, previously-saved answers.
  const handleGenerateDebrief = async () => {
    if (!lessonId) return;
    setGeneratingDebrief(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const resp = await fetch(`${BACKEND}/api/v2/lessons/${lessonId}/debrief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.detail || `Debrief generation failed (HTTP ${resp.status})`);
      setDebrief(json.debrief);
    } catch (e: any) {
      Alert.alert('Could not generate debrief', e?.message || 'Please try again.');
    } finally {
      setGeneratingDebrief(false);
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
                  onChangeText={(text) => { setAnswers((prev) => ({ ...prev, [q.id]: text })); setNotesSaved(false); }}
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

          {questions.length > 0 && (
            <TouchableOpacity
              style={[styles.debriefBtn, (!notesSaved || generatingDebrief) && { opacity: 0.5 }]}
              onPress={handleGenerateDebrief}
              disabled={!notesSaved || generatingDebrief}
              testID="btn-generate-debrief"
            >
              {generatingDebrief ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <>
                  <Sparkles size={16} color={theme.colors.primary} />
                  <Text style={styles.debriefBtnText}>
                    {debrief ? 'Regenerate AI debrief' : 'Generate AI debrief'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
          {questions.length > 0 && !notesSaved && (
            <Text style={styles.debriefHint}>Save your notes first to generate a debrief.</Text>
          )}

          {debrief && (
            <Card style={{ gap: 6 }} testID="debrief-card">
              <Text style={styles.debriefLabel}>AI DEBRIEF {studentName ? `FOR ${studentName.toUpperCase()}` : ''}</Text>
              <Text style={styles.debriefText}>{debrief}</Text>
            </Card>
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
  debriefBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 46, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.primary, marginTop: 4,
  },
  debriefBtnText: { color: theme.colors.primary, fontWeight: '700', fontSize: 14 },
  debriefHint: { fontSize: 12.5, color: theme.colors.textMuted, textAlign: 'center', marginTop: 2 },
  debriefLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: theme.colors.textMuted },
  debriefText: { fontSize: 14.5, color: theme.colors.text, lineHeight: 21 },
});
