import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ClipboardList } from 'lucide-react-native';
import { listMyLessonNoteQuestions, getLastLessonFocus } from './supabaseDb';
import { theme } from './theme';
import { formatDate } from './dateFormat';

type Focus = { lessonDate: string; practice: string | null; goal: string | null };

/** The practice and goal answers from the pupil's most recent earlier lesson notes, for the lesson that starts at `beforeISO`. */
export function useLastLessonFocus(studentId: string | undefined, instructorId: string | undefined, beforeISO: string | null, enabled: boolean): Focus | null {
  const [focus, setFocus] = useState<Focus | null>(null);
  useEffect(() => {
    setFocus(null);
    if (!enabled || !studentId || !instructorId || !beforeISO) return;
    let alive = true;
    (async () => {
      try {
        const questions = await listMyLessonNoteQuestions(instructorId);
        const f = await getLastLessonFocus(studentId, beforeISO, questions);
        if (alive) setFocus(f);
      } catch { /* the card is a convenience: no card is better than an error */ }
    })();
    return () => { alive = false; };
  }, [studentId, instructorId, beforeISO, enabled]);
  return focus;
}

/**
 * "From last lesson" at the top of a lesson's tools: what needed more practice and the goal for this lesson, from the
 * notes written after the pupil's previous lesson. Instructor only. Shows nothing when there is nothing to show.
 */
export function LastLessonFocusCard({ focus }: { focus: Focus | null }) {
  if (!focus || (!focus.practice && !focus.goal)) return null;
  return (
    <View style={s.card} testID="last-lesson-focus">
      <View style={s.head}>
        <ClipboardList size={16} color={theme.colors.primary} />
        <Text style={s.title}>From last lesson ({formatDate(focus.lessonDate)})</Text>
      </View>
      {!!focus.goal && (
        <Text style={s.line} testID="focus-goal"><Text style={s.label}>Goal for this lesson: </Text>{focus.goal}</Text>
      )}
      {!!focus.practice && (
        <Text style={s.line} testID="focus-practice"><Text style={s.label}>Needs more practice: </Text>{focus.practice}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: theme.colors.primaryLight, borderRadius: 12, padding: 12, gap: 6, marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.colors.primary },
  line: { fontSize: 14, lineHeight: 20, color: theme.colors.text },
  label: { fontWeight: '700' },
});
