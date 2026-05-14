import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from './theme';

export function ProgressBar({ progress, color, height = 8, testID }: { progress: number; color?: string; height?: number; testID?: string }) {
  const c = color || theme.colors.primary;
  const p = Math.max(0, Math.min(100, progress));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]} testID={testID}>
      <View style={[styles.fill, { width: `${p}%`, backgroundColor: c, borderRadius: height / 2 }]} />
    </View>
  );
}

export function Badge({ label, color, bg, testID }: { label: string; color?: string; bg?: string; testID?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg || theme.colors.primaryLight }]} testID={testID}>
      <Text style={[styles.badgeText, { color: color || theme.colors.primary }]}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ status, testID }: { status: 'New' | 'Active' | 'Test Ready' | 'Passed'; testID?: string }) {
  const map = {
    New: { bg: '#FFF7ED', color: theme.colors.accent },
    Active: { bg: '#E5F0FA', color: theme.colors.primary },
    'Test Ready': { bg: '#D1FAE5', color: theme.colors.success },
    Passed: { bg: '#DCFCE7', color: '#15803D' },
  } as const;
  const { bg, color } = map[status];
  return <Badge label={status} bg={bg} color={color} testID={testID} />;
}

export function Card({ children, style, testID }: { children: React.ReactNode; style?: any; testID?: string }) {
  return <View style={[styles.card, style]} testID={testID}>{children}</View>;
}

const styles = StyleSheet.create({
  track: { backgroundColor: theme.colors.border, overflow: 'hidden', width: '100%' },
  fill: { height: '100%' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
  },
});
