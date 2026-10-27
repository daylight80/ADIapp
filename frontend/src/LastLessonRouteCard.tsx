import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { theme } from './theme';
import { listRoutesForStudent, fmtDistance, fmtDuration, type SavedRoute, type RoutePoint } from './routeRecorder';

type LessonLite = { id: string; date: string; start_time?: string | null; status: string };

/** The pupil's most recent completed lesson, or null. */
export function lastCompletedLesson<T extends LessonLite>(lessons: T[]): T | null {
  const done = lessons.filter((l) => l.status === 'Completed');
  done.sort((a, b) => `${b.date}${b.start_time || ''}`.localeCompare(`${a.date}${a.start_time || ''}`));
  return done[0] ?? null;
}

/** Scale GPS points into a size x size box, one line per run (a pause starts a new line). Needs 2+ points. */
export function sketchLines(points: RoutePoint[], size: number, pad = 6): string[] {
  if (points.length < 2) return [];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  // Longitude degrees are shorter than latitude degrees away from the equator.
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const w = Math.max((maxLng - minLng) * k, 1e-9);
  const h = Math.max(maxLat - minLat, 1e-9);
  const scale = (size - 2 * pad) / Math.max(w, h);
  const lines: string[][] = [];
  points.forEach((p, i) => {
    if (i === 0 || p.brk) lines.push([]);
    const x = pad + (p.lng - minLng) * k * scale + ((size - 2 * pad) - w * scale) / 2;
    const y = pad + (maxLat - p.lat) * scale + ((size - 2 * pad) - h * scale) / 2;
    lines[lines.length - 1].push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return lines.filter((l) => l.length > 1).map((l) => l.join(' '));
}

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
