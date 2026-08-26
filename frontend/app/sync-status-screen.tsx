import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, RefreshCw, WifiOff, CheckCircle2, AlertTriangle } from 'lucide-react-native';
import { usePendingQueue, useIsOnline, flushQueue } from '../src/offlineSync';

/**
 * Sync status screen — first slice of offline-first sync (25 Aug 2026),
 * scoped to lesson-completion writes only. Shows each pending write with
 * a human-readable label (set when it was queued — e.g. "Mark complete —
 * Sarah Jones"), when it was queued, and whether a previous sync attempt
 * failed for a real reason (vs. just still being offline). "Force Sync
 * Now" is a manual backstop for when auto-flush-on-reconnect hasn't
 * caught up yet — patchy signal can flicker in ways a listener doesn't
 * always catch cleanly.
 */

const C = {
  pageBg: '#DCD6CA',
  surface: '#F5F2EC',
  border: '#E4DED2',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  primary: '#00539F',
  success: '#047857',
  successBg: '#D1FAE5',
  warnBg: '#FFF7ED',
  warnBorder: '#FED7AA',
  warnText: '#C2410C',
  dangerBg: '#FEF2F2',
  dangerBorder: '#FECACA',
  dangerText: '#B91C1C',
};

export default function SyncStatusScreen() {
  const router = useRouter();
  const isOnline = useIsOnline();
  const queue = usePendingQueue();
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<{ synced: number; failed: number } | null>(null);

  const handleForceSync = async () => {
    setSyncing(true);
    setLastResult(null);
    try {
      const result = await flushQueue();
      setLastResult(result);
    } finally {
      setSyncing(false);
    }
  };

  const failedCount = queue.filter((w) => w.lastError).length;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.navBtn} onPress={() => router.back()} testID="sync-status-back">
          <ArrowLeft size={17} color={C.text} />
        </TouchableOpacity>
        <Text style={s.title}>Sync status</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        {/* Connection status */}
        <View style={[s.statusCard, isOnline === false && s.statusCardOffline]}>
          {isOnline === false ? (
            <>
              <WifiOff size={20} color={C.warnText} />
              <Text style={s.statusOfflineText}>You're currently offline</Text>
            </>
          ) : (
            <>
              <CheckCircle2 size={20} color={C.success} />
              <Text style={s.statusOnlineText}>Connected</Text>
            </>
          )}
        </View>

        {/* Pending count summary */}
        <View style={s.summaryCard}>
          <Text style={s.summaryValue}>{queue.length}</Text>
          <Text style={s.summaryLabel}>
            {queue.length === 1 ? 'change pending sync' : 'changes pending sync'}
          </Text>
          {failedCount > 0 && (
            <Text style={s.summaryFailed}>{failedCount} need attention — see below</Text>
          )}
        </View>

        {/* Force sync button */}
        <TouchableOpacity
          style={[s.forceSyncBtn, (syncing || queue.length === 0) && { opacity: 0.5 }]}
          onPress={handleForceSync}
          disabled={syncing || queue.length === 0}
          testID="force-sync-now"
        >
          {syncing
            ? <ActivityIndicator color="#fff" />
            : (
              <>
                <RefreshCw size={17} color="#fff" />
                <Text style={s.forceSyncText}>Force sync now</Text>
              </>
            )}
        </TouchableOpacity>

        {lastResult && (
          <Text style={s.lastResultText}>
            Last attempt: {lastResult.synced} synced
            {lastResult.failed > 0 ? `, ${lastResult.failed} still pending` : ''}
          </Text>
        )}

        {/* Per-entity list */}
        {queue.length === 0 ? (
          <View style={s.emptyState}>
            <CheckCircle2 size={28} color={C.success} />
            <Text style={s.emptyText}>All caught up — nothing waiting to sync.</Text>
          </View>
        ) : (
          <View style={{ marginTop: 20, gap: 8 }}>
            <Text style={s.sectionLabel}>Pending changes</Text>
            {queue.map((w) => (
              <View key={w.id} style={[s.pendingRow, w.lastError && s.pendingRowError]} testID={`pending-${w.id}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.pendingLabel} numberOfLines={1}>{w.label}</Text>
                  <Text style={s.pendingMeta}>
                    Queued {new Date(w.queuedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {w.lastError && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
                      <AlertTriangle size={13} color={C.dangerText} />
                      <Text style={s.pendingError} numberOfLines={2}>{w.lastError}</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.pageBg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, backgroundColor: C.surface },
  navBtn: { width: 38, height: 38, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Archivo_800ExtraBold', fontSize: 18, color: C.text },

  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.successBg,
    borderRadius: 14, padding: 13, borderWidth: 1, borderColor: '#A7F3D0',
  },
  statusCardOffline: { backgroundColor: C.warnBg, borderColor: C.warnBorder },
  statusOnlineText: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: C.success },
  statusOfflineText: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: C.warnText },

  summaryCard: { alignItems: 'center', marginTop: 20, padding: 20 },
  summaryValue: { fontFamily: 'Archivo_800ExtraBold', fontSize: 48, color: C.text },
  summaryLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.textMuted, marginTop: 2 },
  summaryFailed: { fontFamily: 'Barlow_700Bold', fontSize: 12.5, color: C.dangerText, marginTop: 8 },

  forceSyncBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    minHeight: 52, borderRadius: 14, backgroundColor: C.primary, marginTop: 6,
  },
  forceSyncText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: '#fff' },
  lastResultText: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.textMuted, textAlign: 'center', marginTop: 10 },

  emptyState: { alignItems: 'center', gap: 10, marginTop: 40 },
  emptyText: { fontFamily: 'Barlow_500Medium', fontSize: 14, color: C.textMuted },

  sectionLabel: { fontFamily: 'Barlow_700Bold', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: C.textMuted },
  pendingRow: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 13 },
  pendingRowError: { borderColor: C.dangerBorder, backgroundColor: C.dangerBg },
  pendingLabel: { fontFamily: 'Archivo_700Bold', fontSize: 14.5, color: C.text },
  pendingMeta: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.textMuted2, marginTop: 2 },
  pendingError: { fontFamily: 'Barlow_500Medium', fontSize: 12, color: C.dangerText, flex: 1 },
});
