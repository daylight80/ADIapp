import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from './theme';
import { CONFIDENCE_LABELS } from './pupilConfidence';

/** Asks the pupil how confident they felt after their last lesson. Shown until they answer. */
export function PupilConfidenceCard({ onRate }: { onRate: (score: number) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pick = async (score: number) => {
    setSaving(true);
    setError('');
    try {
      await onRate(score);
    } catch (e: any) {
      setError(e?.message || 'Could not save that. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={s.card} testID="pupil-confidence">
      <Text style={s.title}>How confident did you feel after your last lesson?</Text>
      <View style={s.row}>
        {CONFIDENCE_LABELS.map((label, i) => (
          <TouchableOpacity
            key={label}
            style={s.btn}
            disabled={saving}
            onPress={() => pick(i + 1)}
            accessibilityRole="button"
            accessibilityLabel={`${i + 1} of 5, ${label}`}
            testID={`confidence-${i + 1}`}
          >
            <Text style={s.num}>{i + 1}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={s.legend}>
        <Text style={s.legendText}>{CONFIDENCE_LABELS[0]}</Text>
        <Text style={s.legendText}>{CONFIDENCE_LABELS[4]}</Text>
      </View>
      {!!error && <Text style={s.error} testID="confidence-error">{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { padding: 14, gap: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background },
  num: { fontSize: 18, fontWeight: '800', color: theme.colors.primary },
  legend: { flexDirection: 'row', justifyContent: 'space-between' },
  legendText: { fontSize: 12, color: theme.colors.textMuted },
  error: { fontSize: 13, color: '#B91C1C' },
});
