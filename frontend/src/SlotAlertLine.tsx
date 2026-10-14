import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { theme } from './theme';
import { getSlotAlertStatus } from './supabaseDb';
import { describeSlotAlert, type SlotAlertStatus } from './slotAlertStatus';

/**
 * On a cancelled lesson: what happened to the slot alert (how many pupils were told). Shows
 * nothing when there is nothing useful to say, or while loading, or if the lookup fails.
 */
export function SlotAlertLine({ lessonId, lessonStartMs, paid }: { lessonId: string; lessonStartMs: number; paid: boolean }) {
  const [status, setStatus] = useState<SlotAlertStatus | undefined>(undefined);

  useEffect(() => {
    if (!paid) return;
    let active = true;
    getSlotAlertStatus(lessonId)
      .then((s) => { if (active) setStatus(s); })
      .catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, [lessonId, paid]);

  if (status === undefined) return null;
  const text = describeSlotAlert(status, lessonStartMs, Date.now(), paid);
  return text ? <Text style={styles.line} testID="slot-alert-line">{text}</Text> : null;
}

const styles = StyleSheet.create({
  line: { fontSize: 13, color: theme.colors.textMuted, marginTop: 6 },
});
