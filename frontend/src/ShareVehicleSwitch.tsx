import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { theme } from './theme';
import { Card } from './ui';
import { getMySchoolProfile, updateMySchoolProfile } from './supabaseDb';

/**
 * "Show my car to my pupils": on the Vehicles screen. When on, a pupil's Instructor tab shows
 * the school's default vehicle (make, plate, gearbox) so they can spot it at pickup. Only the
 * school's owner can change it; for anyone else (a Franchise instructor) it is not shown.
 */
export function ShareVehicleSwitch() {
  const [shared, setShared] = useState<boolean | null>(null); // null: not loaded, or not the owner
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getMySchoolProfile()
      .then((p) => { if (active && p) setShared(p.share_vehicle_with_pupils !== false); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (shared === null) return null;

  const toggle = async (next: boolean) => {
    const prev = shared;
    setShared(next);
    setError(null);
    try {
      await updateMySchoolProfile({ share_vehicle_with_pupils: next });
    } catch (e: any) {
      setShared(prev);
      setError(e?.message || 'Could not save. Please try again.');
    }
  };

  return (
    <Card style={{ gap: 6 }} testID="share-vehicle-card">
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Show my car to my pupils</Text>
          <Text style={styles.hint}>Pupils see your default vehicle on their Instructor tab, so they can spot it at pickup.</Text>
        </View>
        <Switch value={shared} onValueChange={toggle} testID="switch-share-vehicle" />
      </View>
      {!!error && <Text style={[styles.hint, { color: theme.colors.danger }]} testID="share-vehicle-error">{error}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 12.5, color: theme.colors.textMuted, marginTop: 2 },
});
