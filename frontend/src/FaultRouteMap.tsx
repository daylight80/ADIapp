import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Polyline, Text as SvgText } from 'react-native-svg';
import { theme } from './theme';
import { Card } from './ui';
import { labelForKey } from './dl25Items';
import { locateFaults, type FaultEvent, type FaultType } from './faultEvents';
import { sketchLines, sketchProjector } from './routeSketch';
import type { SavedRoute } from './routeRecorder';

const SIZE = 280;
const COLOUR: Record<FaultType, string> = {
  driving: theme.colors.faultDriving,
  serious: theme.colors.faultSerious,
  dangerous: theme.colors.faultDangerous,
};
const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * The recorded route drawn as a line, with a numbered dot where each mock test fault was marked and a timed list
 * underneath. A fault sits at the route point closest in time to when it was marked. Shows nothing if the route has
 * fewer than two points or there are no faults.
 */
export function FaultRouteMap({ route, events, testID = 'fault-route-map' }: { route: SavedRoute; events: FaultEvent[]; testID?: string }) {
  const located = useMemo(() => locateFaults(events, route.points), [events, route.points]);
  const lines = useMemo(() => sketchLines(route.points, SIZE, 14), [route.points]);
  const project = useMemo(() => sketchProjector(route.points, SIZE, 14), [route.points]);
  if (!project || located.length === 0) return null;

  return (
    <Card style={{ gap: 12 }} testID={testID}>
      <Text style={s.title}>Where the faults happened</Text>
      <View style={{ alignItems: 'center' }}>
        <Svg width={SIZE} height={SIZE} testID={`${testID}-sketch`}>
          {lines.map((pts, i) => (
            <Polyline key={i} points={pts} fill="none" stroke={theme.colors.primary} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" opacity={0.5} />
          ))}
          {located.map((f, i) => {
            const [x, y] = project(f.lat, f.lng);
            return (
              <React.Fragment key={`${f.t}-${i}`}>
                <Circle cx={x} cy={y} r={9} fill={COLOUR[f.type]} stroke="#fff" strokeWidth={2} testID={`${testID}-dot-${i + 1}`} />
                <SvgText x={x} y={y + 3.5} fontSize={10} fontWeight="bold" fill="#fff" textAnchor="middle">{String(i + 1)}</SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
      <View style={{ gap: 8 }}>
        {located.map((f, i) => (
          <View key={`${f.t}-${i}`} style={s.row} testID={`${testID}-row-${i + 1}`}>
            <View style={[s.badge, { backgroundColor: COLOUR[f.type] }]}><Text style={s.badgeText}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{labelForKey(f.key)}</Text>
              <Text style={s.meta}>{f.type[0].toUpperCase() + f.type.slice(1)} · {clock(f.t)}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={s.note}>Placed by time on the recorded route, so a fault marked while paused sits at the nearest point.</Text>
    </Card>
  );
}

const s = StyleSheet.create({
  title: { ...theme.font.h3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  label: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  meta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 1 },
  note: { fontSize: 11, color: theme.colors.textMuted },
});
