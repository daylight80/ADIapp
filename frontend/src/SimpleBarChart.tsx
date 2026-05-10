import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from './theme';

export type ChartDatum = { label: string; value: number };

type Props = {
  data: ChartDatum[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
  testID?: string;
};

export function SimpleBarChart({ data, color, height = 180, formatValue, testID }: Props) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barColor = color || theme.colors.primary;
  const fmt = formatValue || ((v: number) => `£${Math.round(v)}`);

  return (
    <View style={[styles.container, { height }]} testID={testID}>
      <View style={styles.bars}>
        {data.map((d, i) => {
          const h = max > 0 ? (d.value / max) * (height - 40) : 0;
          return (
            <View key={`${d.label}-${i}`} style={styles.barCol}>
              <Text style={styles.value}>{fmt(d.value)}</Text>
              <View style={[styles.bar, { height: h, backgroundColor: barColor }]} />
              <Text style={styles.label}>{d.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  bars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    gap: 8,
  },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '70%', maxWidth: 36, minHeight: 4, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  value: { fontSize: 10, color: theme.colors.textMuted, marginBottom: 4 },
  label: { fontSize: 11, color: theme.colors.text, marginTop: 6, fontWeight: '600' },
});
