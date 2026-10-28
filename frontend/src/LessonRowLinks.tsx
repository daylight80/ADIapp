import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Flag, FileCheck } from 'lucide-react-native';
import { theme } from './theme';
import type { SavedRoute } from './routeRecorder';
import type { MockTestAttempt, InstructorLessonNote } from './supabaseDb';
import { mockReportRoute, mockTestLabel } from './mockTestLink';

/** The mock tests run during this lesson's recording(s). Only a test run from the Route Recorder carries a route. */
export function mockTestsForRoutes(attempts: MockTestAttempt[], routes: SavedRoute[]): MockTestAttempt[] {
  const ids = new Set(routes.map((r) => r.id));
  return attempts.filter((a) => !!a.route_id && ids.has(a.route_id));
}

type Props = {
  lessonId: string;
  studentId: string;
  studentName: string;
  routes: SavedRoute[];
  attempts: MockTestAttempt[];
  note?: InstructorLessonNote;
  questionText: Record<string, string>;
};

/** Under a completed lesson on the pupil's Lessons tab: its mock tests, and its private notes (view, edit or add). */
export function LessonRowLinks({ lessonId, studentId, studentName, routes, attempts, note, questionText }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const mocks = mockTestsForRoutes(attempts, routes);
  const answered = Object.entries(note?.answers || {}).filter(([, a]) => a && a.trim());
  const toNotes = () => router.push({ pathname: '/lesson-notes-screen', params: { lessonId, studentId, studentName } } as any);

  return (
    <View style={s.wrap}>
      {mocks.map((m) => (
        <TouchableOpacity
          key={m.id}
          style={s.row}
          onPress={() => router.push(mockReportRoute(m, studentId) as any)}
          testID={`lesson-mock-${m.id}`}
        >
          <Flag size={16} color={theme.colors.accent} />
          <Text style={s.text}>{mockTestLabel(m)}</Text>
        </TouchableOpacity>
      ))}

      {answered.length > 0 ? (
        <>
          <TouchableOpacity style={s.row} onPress={() => setOpen((v) => !v)} testID={`lesson-notes-toggle-${lessonId}`}>
            <FileCheck size={16} color={theme.colors.primary} />
            <Text style={s.text}>{open ? 'Hide my notes' : 'View my notes'}</Text>
          </TouchableOpacity>
          {open && (
            <View style={s.notes} testID={`lesson-notes-${lessonId}`}>
              {answered.map(([qid, answer]) => (
                <View key={qid} style={{ gap: 2 }}>
                  <Text style={s.q}>{questionText[qid] || 'Question'}</Text>
                  <Text style={s.a}>{answer}</Text>
                </View>
              ))}
              <TouchableOpacity onPress={toNotes} testID={`lesson-notes-edit-${lessonId}`}>
                <Text style={s.link}>Edit notes</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : (
        <TouchableOpacity style={s.row} onPress={toNotes} testID={`lesson-notes-add-${lessonId}`}>
          <FileCheck size={16} color={theme.colors.primary} />
          <Text style={s.text}>Add notes</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 10, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  text: { flex: 1, fontSize: 13.5, fontWeight: '700', color: theme.colors.primary },
  notes: { gap: 8, padding: 10, borderRadius: 10, backgroundColor: theme.colors.background },
  q: { fontSize: 12, fontWeight: '700', color: theme.colors.textMuted },
  a: { fontSize: 13.5, color: theme.colors.text },
  link: { fontSize: 13.5, fontWeight: '700', color: theme.colors.primary },
});
