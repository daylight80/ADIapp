import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from './theme';
import { Card } from './ui';
import { BUFFER_CHOICES, DEFAULT_BUFFER_MINUTES } from './diary/buffer';
import { getMyDefaultTravelMinutes, setMyDefaultTravelMinutes } from './supabaseDb';

/**
 * Profile > Travel buffer. The minutes new lessons leave after them to get to the next one. The diary
 * shows each lesson's own buffer as a lighter strip under it, and you can still change it per lesson.
 */
export function TravelBufferCard() {
  const [minutes, setMinutes] = useState(DEFAULT_BUFFER_MINUTES);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getMyDefaultTravelMinutes().then((n) => { if (active) setMinutes(n); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const pick = async (n: number) => {
    const previous = minutes;
    setMinutes(n);
    setError(null);
    try {
      setMinutes(await setMyDefaultTravelMinutes(n));
    } catch (e: any) {
      setMinutes(previous);
      setError(e?.message || 'Could not save. Please try again.');
    }
  };

  return (
    <Card style={{ gap: 10 }} testID="travel-buffer-card">
      <Text style={styles.title}>Travel buffer</Text>
      <Text style={styles.hint}>
        Time left after a lesson to get to the next one. The diary shows it under each lesson, and new lessons start with this.
      </Text>
      <View style={styles.row}>
        {BUFFER_CHOICES.map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.chip, minutes === n && styles.chipActive]}
            onPress={() => pick(n)}
            testID={`travel-buffer-${n}`}
          >
            <Text style={[styles.chipText, minutes === n && styles.chipTextActive]}>{n === 0 ? 'None' : `${n} min`}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!!error && <Text style={[styles.hint, { color: theme.colors.danger }]} testID="travel-buffer-error">{error}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 12.5, color: theme.colors.textMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minWidth: 62, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 12.5, fontWeight: '600', color: theme.colors.text, textAlign: 'center' },
  chipTextActive: { color: '#fff' },
});
