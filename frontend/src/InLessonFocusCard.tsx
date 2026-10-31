import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { UserRound } from 'lucide-react-native';
import { theme } from './theme';
import { getLessonById } from './supabaseDb';
import { useAuth } from './AuthContext';
import { LastLessonFocusCard, useLastLessonFocus } from './LastLessonFocusCard';
import { InLessonTopicsCard } from './InLessonTopicsCard';

/**
 * What the instructor needs in front of them while recording a lesson: the goal and the practice points from the
 * pupil's last lesson, the briefing written for this one, the topics planned for it, and a way into the pupil's profile
 * to look at their competencies. The profile opens over this screen, which stays mounted underneath, so recording carries on.
 */
export function InLessonFocusCard({ lessonId, studentId, studentName }: { lessonId: string; studentId: string; studentName?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [lesson, setLesson] = useState<{ date: string; start_time: string; plan_brief?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getLessonById(lessonId).then((l) => { if (alive && l) setLesson(l as any); }).catch(() => {});
    return () => { alive = false; };
  }, [lessonId]);

  const focus = useLastLessonFocus(
    studentId, user?.instructor_id ?? undefined,
    lesson?.date && lesson?.start_time ? new Date(`${lesson.date}T${lesson.start_time}:00`).toISOString() : null,
    !!lesson,
  );
  const first = (studentName || 'pupil').split(' ')[0];

  return (
    <View style={s.wrap} testID="in-lesson-focus">
      <LastLessonFocusCard focus={focus} />
      {!!lesson?.plan_brief?.trim() && (
        <View style={s.brief} testID="focus-briefing">
          <Text style={s.briefLabel}>Briefing for this lesson</Text>
          <Text style={s.briefText}>{lesson.plan_brief}</Text>
        </View>
      )}
      <InLessonTopicsCard lessonId={lessonId} studentId={studentId} studentName={studentName} />
      <TouchableOpacity
        style={s.profileBtn}
        onPress={() => router.push({ pathname: '/student-lifecycle-screen', params: { id: studentId, tab: 'competency' } } as any)}
        accessibilityLabel={`Open ${first}'s profile and competencies`}
        testID="btn-open-pupil-profile"
      >
        <UserRound size={18} color={theme.colors.primary} />
        <Text style={s.profileText}>{first}&apos;s profile and competencies</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignSelf: 'stretch', marginTop: 8 },
  brief: { backgroundColor: theme.colors.background, borderRadius: 12, padding: 12, gap: 4, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  briefLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.colors.textMuted },
  briefText: { fontSize: 14, lineHeight: 20, color: theme.colors.text },
  profileBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, marginTop: 10, borderRadius: 12, borderWidth: 1.5, borderColor: theme.colors.primary },
  profileText: { fontSize: 14.5, fontWeight: '700', color: theme.colors.primary },
});
