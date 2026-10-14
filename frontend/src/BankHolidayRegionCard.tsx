import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from './theme';
import { Card } from './ui';
import { DEFAULT_DIVISION, DIVISIONS, type Division } from './bankHolidays';
import { getDivision, setDivision } from './useBankHolidays';

/**
 * Which bank holidays the diary marks. Scotland and Northern Ireland have different ones
 * from England & Wales. Saved on this device.
 */
export function BankHolidayRegionCard() {
  const [division, setDivisionState] = useState<Division>(DEFAULT_DIVISION);

  useEffect(() => {
    let active = true;
    getDivision().then((d) => { if (active) setDivisionState(d); });
    return () => { active = false; };
  }, []);

  const pick = (d: Division) => {
    setDivisionState(d);
    setDivision(d);
  };

  return (
    <Card style={{ gap: 10 }} testID="bank-holiday-region-card">
      <Text style={styles.title}>Bank holidays in the diary</Text>
      <Text style={styles.hint}>The diary marks bank holidays and warns you when you book on one.</Text>
      <View style={styles.row}>
        {DIVISIONS.map((d) => (
          <TouchableOpacity
            key={d.value}
            style={[styles.chip, division === d.value && styles.chipActive]}
            onPress={() => pick(d.value)}
            testID={`bank-holiday-${d.value}`}
          >
            <Text style={[styles.chipText, division === d.value && styles.chipTextActive]}>{d.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 12.5, color: theme.colors.textMuted },
  row: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 12.5, fontWeight: '600', color: theme.colors.text, textAlign: 'center' },
  chipTextActive: { color: '#fff' },
});
