import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform,
  TextInput, Linking, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  ArrowLeft, Play, Square, MapPin, Navigation as NavIcon, Share2, Trash2, Route as RouteIcon, Clock, Gauge,
} from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import {
  listRoutes, saveRoute, deleteRoute, renameRoute, routeToGPX, routeToGoogleMapsUrl,
  fmtDistance, fmtDuration, msToMph, haversineMeters,
  type SavedRoute, type RoutePoint,
} from '../src/routeRecorder';

/**
 * Route Recorder — GPS breadcrumb tracking saved on device.
 *
 * Live tracking uses `Location.watchPositionAsync` with HIGHEST accuracy.
 * We accept points with ≥10m horizontal accuracy and skip jitter <3m to
 * keep the trail clean. Routes are written to AsyncStorage and can be
 * exported as GPX, opened in Google Maps, or shared via the native sheet.
 *
 * On web the browser geolocation API is used (works for testing without
 * a real device). Background recording (when phone is locked) requires
 * the `Location` background mode in app.json — declared but using
 * foreground tracking in this MVP. Use `expo-keep-awake` to prevent the
 * screen from dimming during a recording session.
 */
export default function RouteRecorderScreen() {
  const router = useRouter();

  // ---- Recording state ----
  const [isRecording, setIsRecording] = useState(false);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0); // m/s
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'pending'>('pending');
  const [starting, setStarting] = useState(false);

  // Persisted across re-renders without triggering them
  const startedAtRef = useRef<number>(0);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Saved routes list
  const [saved, setSaved] = useState<SavedRoute[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Selected route detail
  const [detail, setDetail] = useState<SavedRoute | null>(null);

  // ---- Load saved routes whenever screen is focused ----
  const reloadRoutes = useCallback(async () => {
    setLoadingList(true);
    const all = await listRoutes();
    setSaved(all);
    setLoadingList(false);
  }, []);

  useFocusEffect(useCallback(() => { reloadRoutes(); }, [reloadRoutes]));

  // ---- Helpers ----
  const addPoint = (raw: Location.LocationObject) => {
    const next: RoutePoint = {
      lat: raw.coords.latitude,
      lng: raw.coords.longitude,
      t: raw.timestamp,
      alt: raw.coords.altitude ?? undefined,
      acc: raw.coords.accuracy ?? undefined,
      speed: raw.coords.speed ?? undefined,
    };
    // Reject very inaccurate points (>40m) — keeps the trail crisp.
    if (next.acc != null && next.acc > 40) return;
    setPoints((prev) => {
      const last = prev[prev.length - 1];
      if (last) {
        const stepMeters = haversineMeters(last, next);
        // Ignore jitter while stopped (<3m).
        if (stepMeters < 3) return prev;
        setDistanceM((d) => d + stepMeters);
      }
      setCurrentSpeed(next.speed ?? 0);
      return [...prev, next];
    });
  };

  // ---- Start recording ----
  const start = async () => {
    setStarting(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionStatus('denied');
        Alert.alert(
          'Location permission needed',
          'ADI Pro needs location access to record your driving lesson route. Please enable it in Settings.',
        );
        return;
      }
      setPermissionStatus('granted');

      // Reset state
      setPoints([]);
      setDistanceM(0);
      setDurationSec(0);
      setCurrentSpeed(0);
      startedAtRef.current = Date.now();

      // Keep the screen awake during the recording so the watcher keeps ticking.
      try { await activateKeepAwakeAsync('adipro-route'); } catch { /* not supported on web */ }

      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          distanceInterval: 5, // metres
          timeInterval: 2000,  // ms
        },
        addPoint,
      );
      watcherRef.current = sub;

      // Tick the duration counter every second.
      tickRef.current = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
      setIsRecording(true);
    } catch (e: any) {
      Alert.alert('Could not start recording', e?.message || String(e));
    } finally {
      setStarting(false);
    }
  };

  // ---- Stop recording ----
  const stop = async () => {
    try {
      if (watcherRef.current) {
        watcherRef.current.remove();
        watcherRef.current = null;
      }
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      try { deactivateKeepAwake('adipro-route'); } catch { /* ignore */ }
      setIsRecording(false);

      if (points.length < 2) {
        Alert.alert('Route discarded', 'Not enough GPS points captured. Try again outside or near a window.');
        return;
      }

      // Ask for a name
      const defaultName = `Lesson · ${new Date(startedAtRef.current).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${new Date(startedAtRef.current).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
      const id = (typeof globalThis !== 'undefined' && (globalThis as any).crypto?.randomUUID)
        ? (globalThis as any).crypto.randomUUID()
        : `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const route: SavedRoute = {
        id,
        name: defaultName,
        startedAt: new Date(startedAtRef.current).toISOString(),
        endedAt: new Date().toISOString(),
        durationSec,
        distanceMeters: distanceM,
        points,
      };
      await saveRoute(route);
      await reloadRoutes();
      Alert.alert(
        'Route saved',
        `${fmtDistance(distanceM)} · ${fmtDuration(durationSec)} · ${points.length} GPS points`,
      );
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || String(e));
    }
  };

  // ---- Cleanup on unmount ----
  useEffect(() => () => {
    if (watcherRef.current) watcherRef.current.remove();
    if (tickRef.current) clearInterval(tickRef.current);
    try { deactivateKeepAwake('adipro-route'); } catch { /* ignore */ }
  }, []);

  // ---- Confirm-leave guard if user backs out mid-recording ----
  const onBack = () => {
    if (isRecording) {
      Alert.alert(
        'Stop recording?',
        'You are currently recording a route. Stop and save it first, or discard?',
        [
          { text: 'Keep recording', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              if (watcherRef.current) { watcherRef.current.remove(); watcherRef.current = null; }
              if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
              try { deactivateKeepAwake('adipro-route'); } catch { /* ignore */ }
              setIsRecording(false);
              router.back();
            },
          },
        ],
      );
    } else {
      router.back();
    }
  };

  // ---- Detail / actions ----
  const openInMaps = async (r: SavedRoute) => {
    const url = routeToGoogleMapsUrl(r);
    if (!url) {
      Alert.alert('Cannot open', 'This route has too few points.');
      return;
    }
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      Alert.alert('Cannot open', 'Google Maps could not handle this link.');
      return;
    }
    await Linking.openURL(url);
  };

  const shareGpx = async (r: SavedRoute) => {
    const gpx = routeToGPX(r);
    const safeName = (r.name || 'route').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40);
    const fileName = `${safeName || 'route'}.gpx`;
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const blob = new Blob([gpx], { type: 'application/gpx+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      return;
    }
    try {
      const path = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(path, gpx, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'application/gpx+xml', dialogTitle: 'Share GPX route' });
      } else {
        Alert.alert('Saved', `GPX saved to ${path}`);
      }
    } catch (e: any) {
      Alert.alert('Share failed', e?.message || String(e));
    }
  };

  const confirmDelete = (r: SavedRoute) => {
    Alert.alert(
      'Delete route?',
      `"${r.name}" will be permanently removed from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteRoute(r.id);
            setDetail(null);
            reloadRoutes();
          },
        },
      ],
    );
  };

  // ---- Quick stats for the saved list ----
  const totalDistanceAllRoutes = useMemo(
    () => saved.reduce((s, r) => s + r.distanceMeters, 0),
    [saved],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} testID="btn-back" style={styles.iconBtn}>
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Route Recorder</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        {/* ---- Recording panel ---- */}
        <Card style={styles.recPanel}>
          {isRecording ? (
            <>
              <Text style={styles.recLabel}>RECORDING</Text>
              <View style={styles.statsRow}>
                <Stat icon={<RouteIcon size={18} color={theme.colors.primary} />} label="Distance" value={fmtDistance(distanceM)} />
                <Stat icon={<Clock size={18} color={theme.colors.primary} />} label="Duration" value={fmtDuration(durationSec)} />
                <Stat icon={<Gauge size={18} color={theme.colors.primary} />} label="Speed" value={`${msToMph(currentSpeed).toFixed(0)} mph`} />
              </View>
              <Text style={styles.helperText}>Tracking via GPS · {points.length} points captured</Text>
              <TouchableOpacity style={styles.stopBtn} onPress={stop} testID="btn-stop-recording">
                <Square size={20} color="#fff" />
                <Text style={styles.stopBtnText}>Stop & Save</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.recLabel}>READY</Text>
              <Text style={styles.bigStat}>Tap to start tracking a lesson</Text>
              <Text style={styles.helperText}>
                {Platform.OS === 'web'
                  ? 'GPS is approximate in browser. For full accuracy, install the app on your phone.'
                  : 'Keep your phone with you — the route will record until you tap Stop.'}
              </Text>
              <TouchableOpacity
                style={[styles.startBtn, starting && { opacity: 0.6 }]}
                onPress={start}
                disabled={starting}
                testID="btn-start-recording"
              >
                {starting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Play size={20} color="#fff" />
                    <Text style={styles.startBtnText}>Start Recording</Text>
                  </>
                )}
              </TouchableOpacity>
              {permissionStatus === 'denied' && (
                <Text style={styles.denied}>
                  Location permission denied. Enable it in your device settings, then come back.
                </Text>
              )}
            </>
          )}
        </Card>

        {/* ---- My routes ---- */}
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>My Routes</Text>
          {saved.length > 0 && (
            <Text style={styles.sectionMeta}>
              {saved.length} {saved.length === 1 ? 'route' : 'routes'} · {fmtDistance(totalDistanceAllRoutes)} total
            </Text>
          )}
        </View>

        {loadingList ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 24 }} />
        ) : saved.length === 0 ? (
          <Card style={styles.emptyCard}>
            <MapPin size={36} color={theme.colors.textMuted} />
            <Text style={styles.emptyText}>No routes saved yet.</Text>
            <Text style={styles.emptyHint}>Tap "Start Recording" to capture your first lesson route.</Text>
          </Card>
        ) : (
          saved.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.routeRow}
              onPress={() => setDetail(r)}
              testID={`route-row-${r.id}`}
            >
              <View style={styles.routeIconWrap}>
                <RouteIcon size={20} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.routeMeta}>
                  {fmtDistance(r.distanceMeters)} · {fmtDuration(r.durationSec)} · {r.points.length} pts
                </Text>
                <Text style={styles.routeDate}>
                  {new Date(r.startedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  {new Date(r.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* ---- Detail sheet ---- */}
      <BottomSheet visible={!!detail} onClose={() => setDetail(null)} title="Route details" testID="sheet-route-detail">
        {detail && <RouteDetail
          route={detail}
          onOpenMaps={() => openInMaps(detail)}
          onShareGpx={() => shareGpx(detail)}
          onDelete={() => confirmDelete(detail)}
          onRenamed={async (newName) => { await renameRoute(detail.id, newName); await reloadRoutes(); setDetail({ ...detail, name: newName }); }}
        />}
      </BottomSheet>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RouteDetail({
  route, onOpenMaps, onShareGpx, onDelete, onRenamed,
}: {
  route: SavedRoute;
  onOpenMaps: () => void;
  onShareGpx: () => void;
  onDelete: () => void;
  onRenamed: (newName: string) => void;
}) {
  const [name, setName] = useState(route.name);
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.detailLabel}>Name</Text>
      <View style={styles.nameRow}>
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => { if (name.trim() && name.trim() !== route.name) onRenamed(name.trim()); }}
          style={styles.nameInput}
          placeholder="Route name"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-route-name"
        />
      </View>

      <View style={styles.detailStatsRow}>
        <Stat icon={<RouteIcon size={18} color={theme.colors.primary} />} label="Distance" value={fmtDistance(route.distanceMeters)} />
        <Stat icon={<Clock size={18} color={theme.colors.primary} />} label="Duration" value={fmtDuration(route.durationSec)} />
        <Stat icon={<MapPin size={18} color={theme.colors.primary} />} label="Points" value={`${route.points.length}`} />
      </View>

      <Text style={styles.helperText}>
        Recorded on {new Date(route.startedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </Text>

      <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />

      <TouchableOpacity style={styles.actionBtn} onPress={onOpenMaps} testID="btn-route-open-maps">
        <NavIcon size={18} color={theme.colors.primary} />
        <Text style={styles.actionText}>Open route in Google Maps</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.actionBtn} onPress={onShareGpx} testID="btn-route-share-gpx">
        <Share2 size={18} color={theme.colors.primary} />
        <Text style={styles.actionText}>Share as GPX file</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.actionBtn, styles.dangerBtn]} onPress={onDelete} testID="btn-route-delete">
        <Trash2 size={18} color={theme.colors.danger} />
        <Text style={[styles.actionText, { color: theme.colors.danger }]}>Delete route</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  iconBtn: { padding: 8, borderRadius: 8 },
  title: { ...theme.font.h2 },
  recPanel: { padding: 16, alignItems: 'center', gap: 10 },
  recLabel: { fontSize: 12, color: theme.colors.textMuted, fontWeight: '800', letterSpacing: 1.5 },
  bigStat: { fontSize: 18, fontWeight: '700', color: theme.colors.text, textAlign: 'center' },
  helperText: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 17 },
  denied: { color: theme.colors.danger, marginTop: 8, fontSize: 13, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', justifyContent: 'space-between', marginVertical: 4 },
  stat: { flex: 1, alignItems: 'center', gap: 4, padding: 8, backgroundColor: theme.colors.primaryLight, borderRadius: 12 },
  statIcon: { padding: 4 },
  statValue: { fontSize: 16, fontWeight: '800', color: theme.colors.text },
  statLabel: { fontSize: 11, color: theme.colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.colors.primary, paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 999, marginTop: 8, alignSelf: 'stretch',
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.colors.danger, paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 999, marginTop: 4, alignSelf: 'stretch',
  },
  stopBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  listHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 },
  sectionTitle: { ...theme.font.h3 },
  sectionMeta: { fontSize: 12, color: theme.colors.textMuted },
  emptyCard: { padding: 28, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  emptyHint: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center' },
  routeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.colors.surface, padding: 12,
    borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 10,
  },
  routeIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  routeName: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  routeMeta: { fontSize: 12, color: theme.colors.text, marginTop: 2 },
  routeDate: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  // Detail sheet
  detailLabel: { fontSize: 12, color: theme.colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: {
    flex: 1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
    paddingHorizontal: 12, height: 44, color: theme.colors.text, backgroundColor: theme.colors.background,
  },
  detailStatsRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8,
  },
  actionText: { fontSize: 15, fontWeight: '600', color: theme.colors.primary },
  dangerBtn: { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 4 },
});
