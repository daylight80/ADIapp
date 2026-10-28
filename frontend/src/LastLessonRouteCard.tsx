import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { theme } from './theme';
import { listRoutesForStudent, fmtDistance, fmtDuration, type SavedRoute } from './routeRecorder';
import { sketchLines } from './routeSketch';

type LessonLite = { id: string; date: string; start_time?: string | null; status: string };

/** The pupil's most recent completed lesson, or null. */
export function lastCompletedLesson<T extends LessonLite>(lessons: T[]): T | null {
  const done = lessons.filter((l) => l.status === 'Completed');
  done.sort((a, b) => `${b.date}${b.start_time || ''}`.localeCompare(`${a.date}${a.start_time || ''}`));
  return done[0] ?? null;
}

export { sketchLines };

const SIZE = 120;

/** Paid plans only (route recording is a paid feature): shows last lesson's route, or nudges when none was recorded. */
export function LastLessonRouteCard({ studentId, lessons }: { studentId: string; lessons: LessonLite[] }) {
  const [routes, setRoutes] = useState<SavedRoute[] | null>(null);
  const last = lastCompletedLesson(lessons);

  useEffect(() => {
    let alive = true;
    listRoutesForStudent(studentId).then((r) => { if (alive) setRoutes(r); }).catch(() => { if (alive) setRoutes([]); });
    return () => { alive = false; };
  }, [studentId]);

  if (!last || !routes) return null;
  const route = routes.find((r) => r.lessonId === last.id);

  if (!route) {
    return (
      <View style={s.card} testID="last-route-missing">
        <Text style={s.title}>Last lesson ({last.date})</Text>
        <Text style={s.body}>No route recorded. Next time, tap Start lesson to record it.</Text>
      </View>
    );
  }

  const lines = sketchLines(route.points, SIZE);
  return (
    <View style={s.card} testID="last-route-card">
      <View style={s.row}>
        <Svg width={SIZE} height={SIZE} testID="last-route-sketch">
          {lines.map((pts, i) => (
            <Polyline key={i} points={pts} fill="none" stroke={theme.colors.primary} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          ))}
        </Svg>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Last lesson ({last.date})</Text>
          <Text style={s.body}>{fmtDistance(route.distanceMeters)} in {fmtDuration(route.durationSec)}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 12, color: theme.colors.textMuted, fontWeight: '800', letterSpacing: 0.5 },
  body: { fontSize: 14.5, color: theme.colors.text, fontWeight: '600' },
});
