import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Route as RouteIcon, Navigation as NavIcon, Share2 } from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { listRoutesForStudent, fmtDistance, fmtDuration, type SavedRoute } from './routeRecorder';
import { openRouteInMaps, shareRouteGpx } from './routeShare';
import { formatDate } from './dateFormat';

/**
 * The routes recorded for a pupil. They are stored encrypted on the phone that recorded them, not on the
 * server, so this only finds routes recorded on this device (the instructor's phone).
 */
export function useStudentRoutes(studentId: string): SavedRoute[] {
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  useFocusEffect(useCallback(() => {
    let alive = true;
    listRoutesForStudent(studentId).then((r) => { if (alive) setRoutes(r); }).catch(() => { if (alive) setRoutes([]); });
    return () => { alive = false; };
  }, [studentId]));
  return routes;
}

/** The route rows: name, date, distance, time, the instructor's private notes, and Maps and GPX buttons. */
export function RouteRows({ routes }: { routes: SavedRoute[] }) {
  return (
    <>
      {routes.map((r) => (
        <View key={r.id} style={styles.row} testID={`student-route-${r.id}`}>
          <View style={styles.icon}><RouteIcon size={18} color={theme.colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
            <Text style={styles.meta}>
              {formatDate(r.startedAt)}
              {' · '}{fmtDistance(r.distanceMeters)} · {fmtDuration(r.durationSec)}
            </Text>
            {!!r.notes && <Text style={styles.notes} numberOfLines={3} testID={`route-notes-${r.id}`}>{r.notes}</Text>}
          </View>
          <TouchableOpacity onPress={() => openRouteInMaps(r)} style={styles.btn} accessibilityLabel="Open route in Google Maps" testID={`route-maps-${r.id}`}>
            <NavIcon size={18} color={theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => shareRouteGpx(r)} style={styles.btn} accessibilityLabel="Share route as GPX" testID={`route-gpx-${r.id}`}>
            <Share2 size={18} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
      ))}
    </>
  );
}

/**
 * Routes that couldn't be matched to one of the pupil's lessons (see lessonRoutes.ts). Routes that did match
 * are shown on their lesson instead. Instructor side only: the pupil's own screens never use this.
 */
export function StudentRoutesCard({ routes }: { routes: SavedRoute[] }) {
  if (routes.length === 0) return null;
  return (
    <Card style={{ gap: 10 }} testID="unmatched-routes-card">
      <Text style={styles.title}>Recorded routes</Text>
      <RouteRows routes={routes} />
      <Text style={styles.note}>Kept on this phone only.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { ...theme.font.h3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  meta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  notes: { fontSize: 12.5, color: theme.colors.text, marginTop: 4, fontStyle: 'italic' },
  btn: { padding: 8 },
  note: { fontSize: 11, color: theme.colors.textMuted },
});
