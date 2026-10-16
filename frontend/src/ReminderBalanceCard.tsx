import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { theme } from './theme';
import { Card } from './ui';
import { getMyReminderBalanceSetting, setMyReminderBalanceSetting } from './supabaseDb';

/**
 * Profile > "Mention unpaid balances in reminders". When on, the 24-hour lesson reminder tells a pupil who
 * owes money that they have an outstanding balance (the email says how much; the notification doesn't, so
 * it can't be read on a lock screen). Off by default.
 */
export function ReminderBalanceCard() {
  const [on, setOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getMyReminderBalanceSetting().then((v) => { if (active) setOn(v); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const change = async (next: boolean) => {
    const previous = on;
    setOn(next);
    setError(null);
    setSaving(true);
    try {
      setOn(await setMyReminderBalanceSetting(next));
    } catch (e: any) {
      setOn(previous);
      setError(e?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 8 }} testID="reminder-balance-card">
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Mention unpaid balances in reminders</Text>
          <Text style={styles.hint}>The day-before lesson reminder tells a pupil who owes money that they have an outstanding balance.</Text>
        </View>
        <Switch
          value={on}
          onValueChange={change}
          disabled={saving}
          trackColor={{ true: theme.colors.primary, false: '#D6CFC1' }}
          testID="reminder-balance-toggle"
        />
      </View>
      <Text style={styles.hint} testID="reminder-balance-copy">
        {on
          ? 'On. Pupils who owe money are told in the email, with the amount. The notification just says to see their Wallet.'
          : 'Off. Reminders only say when the lesson is.'}
      </Text>
      {!!error && <Text style={[styles.hint, { color: theme.colors.danger }]} testID="reminder-balance-error">{error}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 12.5, color: theme.colors.textMuted, lineHeight: 18 },
});
