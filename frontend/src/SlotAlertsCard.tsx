import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { setMySlotAlerts } from './supabaseDb';

const C = { border: '#E4DED2', text: '#0F172A', muted: '#6B6356', primary: '#00539F', danger: '#B91C1C' };

/**
 * "Slot alerts" on the pupil home screen. When on, the pupil gets a push notification when their
 * instructor cancels a lesson and the slot is free (the backend's slot_alerts job). The choice is
 * saved on the pupil's record, so it survives reopening the app. Pupils contact their instructor
 * to book a slot; the alert does not book it.
 */
export function SlotAlertsCard({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The pupil's record can arrive after the first render.
  useEffect(() => { setOn(enabled); }, [enabled]);

  const change = async (next: boolean) => {
    const previous = on;
    setOn(next);
    setError(null);
    setSaving(true);
    try {
      setOn(await setMySlotAlerts(next));
    } catch (e: any) {
      setOn(previous);
      setError(e?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card} testID="slot-alerts-card">
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Slot alerts</Text>
          <Text style={styles.sub}>Short-notice cancellations</Text>
        </View>
        <Switch
          value={on}
          onValueChange={change}
          disabled={saving}
          trackColor={{ true: C.primary, false: '#D6CFC1' }}
          testID="v2-slot-alerts-toggle"
        />
      </View>
      <Text style={styles.copy} testID="slot-alerts-copy">
        {on
          ? "We'll tell you when your instructor has a free slot, for example after a cancellation. Contact your instructor to book it."
          : "You won't be told about slots that open up."}
      </Text>
      {!!error && <Text style={[styles.copy, { color: C.danger }]} testID="slot-alerts-error">{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },
  sub: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.muted, marginTop: 1 },
  copy: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 18, color: C.muted, marginTop: 9 },
});
