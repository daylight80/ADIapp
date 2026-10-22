import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsOnline, usePendingQueue } from './offlineSync';

/**
 * Tells the instructor when they have no signal (the diary is then a saved copy), and when changes are waiting to sync
 * or need their decision. Shows nothing on a normal connection with an empty queue. Tapping opens the sync screen.
 */
export function OfflineBanner({ showPending = true, savedCopy = false }: { showPending?: boolean; savedCopy?: boolean }) {
  const router = useRouter();
  const online = useIsOnline();
  const queue = usePendingQueue();
  const conflicts = queue.filter((w) => w.conflict).length;
  const offline = online === false;

  let text: string | null = null;
  if (offline) {
    text = queue.length
      ? `You're offline. This is your saved diary. ${queue.length} change${queue.length === 1 ? '' : 's'} will sync when you're back online.`
      : "You're offline. This is your saved diary. Changes you make will sync when you're back online.";
  } else if (savedCopy) {
    // The phone thinks it is online but the server could not be reached (weak signal).
    text = "Couldn't reach the server, so this is your saved diary. Pull to refresh when your signal improves.";
  } else if (showPending && conflicts > 0) {
    text = `${conflicts} lesson${conflicts === 1 ? ' was' : 's were'} changed on another device. Tap to choose what to keep.`;
  } else if (showPending && queue.length > 0) {
    text = `${queue.length} change${queue.length === 1 ? '' : 's'} waiting to sync. Tap to see.`;
  }
  if (!text) return null;

  return (
    <TouchableOpacity
      style={[s.bar, conflicts > 0 && !offline && s.conflict]}
      onPress={() => router.push('/sync-status-screen' as any)}
      accessibilityRole="button"
      testID="offline-banner"
    >
      <Text style={s.text}>{text}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  bar: { marginHorizontal: 16, marginTop: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA' },
  conflict: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  text: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#9A3412' },
});
