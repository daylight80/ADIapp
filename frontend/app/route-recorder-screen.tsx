import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform,
  TextInput, Linking, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  ArrowLeft, Play, Pause, Square, MapPin, Navigation as NavIcon, Share2, Trash2, Route as RouteIcon, Clock, Gauge,
} from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import {
  listRoutes, saveRoute, deleteRoute, renameRoute, updateRouteNotes, updateRouteFeedback, cleanRouteNotes, MAX_ROUTE_NOTES,
  fmtDistance, fmtDuration, msToMph, activeSeconds, nextPoint,
  type SavedRoute, type RoutePoint,
} from '../src/routeRecorder';
import { openRouteInMaps, shareRouteGpx } from '../src/routeShare';
import { useKeyboardHeight } from '../src/useKeyboardHeight';
import { useAuth } from '../src/AuthContext';
import { isPaidTier } from '../src/tiers';
import { formatDate, formatDateTime } from '../src/dateFormat';

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
  const { user } = useAuth();

  // Route recording is a Growth+ feature (31 Aug 2026) — the
  // LessonToolsSheet button already greys itself out and shows a paywall
  // instead of navigating here for a Starter-tier instructor, but that's
  // only one of two entry points to this screen (see the diary-header
  // comment below for the other) and doesn't stop direct navigation
  // either. This is a client-side UX safeguard, not a real security
  // boundary — same caveat as the equivalent receipts-screen redirect.
  useEffect(() => {
    if (user && !isPaidTier(user.tier)) {
      router.replace('/home-screen' as any);
    }
  }, [user]);

  // Present only when launched from a specific lesson's LessonToolsSheet
  // ("Record route for this lesson") — absent when opened generically from
  // the diary header, in which case the saved route stays unlinked as before.
  const params = useLocalSearchParams<{ lessonId?: string; studentId?: string; studentName?: string }>();
  const linkedLessonId = typeof params.lessonId === 'string' ? params.lessonId : undefined;
  const linkedStudentId = typeof params.studentId === 'string' ? params.studentId : undefined;
  const linkedStudentName = typeof params.studentName === 'string' ? params.studentName : undefined;

  // ---- Recording state ----
  const [isRecording, setIsRecording] = useState(false);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0); // m/s
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'pending'>('pending');
  const [starting, setStarting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Persisted across re-renders without triggering them. The GPS callback reads these refs, not state, so
  // it always sees the latest points and pause state.
  const startedAtRef = useRef<number>(0);
  const bankedMsRef = useRef(0); // recording time before the current run
  const runStartedAtRef = useRef<number | null>(null); // when the current run began; null while paused
  const pointsRef = useRef<RoutePoint[]>([]);
  const distanceRef = useRef(0);
  const afterPauseRef = useRef(false);
  // Notes typed during the lesson. Kept in a ref as well so Stop & Save always saves the latest text.
  const [positives, setPositives] = useState('');
  const [negatives, setNegatives] = useState('');
  const positivesRef = useRef('');
  const negativesRef = useRef('');
  const keyboardHeight = useKeyboardHeight();
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
    if (runStartedAtRef.current == null) return; // paused: ignore any late fix
    const fix: RoutePoint = {
      lat: raw.coords.latitude,
      lng: raw.coords.longitude,
      t: raw.timestamp,
      alt: raw.coords.altitude ?? undefined,
      acc: raw.coords.accuracy ?? undefined,
      speed: raw.coords.speed ?? undefined,
    };
    // Drops inaccurate fixes (>40m) and jitter (<3m); the first fix after a pause starts a new segment.
    const res = nextPoint(pointsRef.current[pointsRef.current.length - 1], fix, afterPauseRef.current);
    if (!res) return;
    afterPauseRef.current = false;
    pointsRef.current = [...pointsRef.current, res.point];
    distanceRef.current += res.addedMeters;
    setPoints(pointsRef.current);
    setDistanceM(distanceRef.current);
    setCurrentSpeed(fix.speed ?? 0);
  };

  const beginWatching = async () => {
    watcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        distanceInterval: 5, // metres
        timeInterval: 2000,  // ms
      },
      addPoint,
    );
    // Tick the duration counter every second (recording time only, not paused time).
    tickRef.current = setInterval(() => {
      setDurationSec(activeSeconds(bankedMsRef.current, runStartedAtRef.current, Date.now()));
    }, 1000);
  };

  const endWatching = () => {
    if (watcherRef.current) { watcherRef.current.remove(); watcherRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  };

  // ---- Pause / resume (e.g. a break mid-lesson) ----
  const pause = () => {
    if (runStartedAtRef.current == null) return;
    bankedMsRef.current += Date.now() - runStartedAtRef.current;
    runStartedAtRef.current = null;
    endWatching();
    try { deactivateKeepAwake('adipro-route'); } catch { /* ignore */ }
    setDurationSec(activeSeconds(bankedMsRef.current, null, Date.now()));
    setCurrentSpeed(0);
    setIsPaused(true);
  };

  const resume = async () => {
    try {
      afterPauseRef.current = true;
      runStartedAtRef.current = Date.now();
      try { await activateKeepAwakeAsync('adipro-route'); } catch { /* not supported on web */ }
      await beginWatching();
      setIsPaused(false);
    } catch (e: any) {
      runStartedAtRef.current = null;
      Alert.alert('Could not resume recording', e?.message || String(e));
    }
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
          'DualControl needs location access to record your driving lesson route. Please enable it in Settings.',
        );
        return;
      }
      setPermissionStatus('granted');

      // Reset state
      pointsRef.current = [];
      distanceRef.current = 0;
      bankedMsRef.current = 0;
      positivesRef.current = '';
      negativesRef.current = '';
      setPositives('');
      setNegatives('');
      afterPauseRef.current = false;
      setPoints([]);
      setDistanceM(0);
      setDurationSec(0);
      setCurrentSpeed(0);
      setIsPaused(false);
      startedAtRef.current = Date.now();
      runStartedAtRef.current = Date.now();

      // Keep the screen awake during the recording so the watcher keeps ticking.
      try { await activateKeepAwakeAsync('adipro-route'); } catch { /* not supported on web */ }

      await beginWatching();
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
      const durationSec = activeSeconds(bankedMsRef.current, runStartedAtRef.current, Date.now());
      const points = pointsRef.current;
      const distanceM = distanceRef.current;
      runStartedAtRef.current = null;
      endWatching();
      try { deactivateKeepAwake('adipro-route'); } catch { /* ignore */ }
      setIsRecording(false);
      setIsPaused(false);
      setDurationSec(durationSec);

      if (points.length < 2) {
        Alert.alert('Route discarded', 'Not enough GPS points captured. Try again outside or near a window.');
        return;
      }

      // Ask for a name
      const defaultName = linkedStudentName
        ? `${linkedStudentName} · ${new Date(startedAtRef.current).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${new Date(startedAtRef.current).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
        : `Lesson · ${new Date(startedAtRef.current).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${new Date(startedAtRef.current).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
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
        positives: cleanRouteNotes(positivesRef.current),
        negatives: cleanRouteNotes(negativesRef.current),
        lessonId: linkedLessonId,
        studentId: linkedStudentId,
      };
      await saveRoute(route);
      await reloadRoutes();
      Alert.alert(
        'Route saved',
        `${fmtDistance(distanceM)} · ${fmtDuration(durationSec)} · ${points.length} GPS points${linkedStudentName ? `\nSaved to ${linkedStudentName}’s profile.` : ''}`,
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
        `You are ${isPaused ? 'part-way through' : 'currently recording'} a route. Stop and save it first, or discard?`,
        [
          { text: isPaused ? 'Stay here' : 'Keep recording', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              runStartedAtRef.current = null;
              endWatching();
              try { deactivateKeepAwake('adipro-route'); } catch { /* ignore */ }
              setIsRecording(false);
              setIsPaused(false);
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
  const openInMaps = openRouteInMaps;
  const shareGpx = shareRouteGpx;

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

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 80 + keyboardHeight }}
        keyboardShouldPersistTaps="handled"
      >
        {linkedStudentName && (
          <View style={styles.linkedBanner} testID="linked-lesson-banner">
            <MapPin size={14} color={theme.colors.primary} />
            <Text style={styles.linkedBannerText}>Recording for {linkedStudentName}&apos;s lesson</Text>
          </View>
        )}
        {/* ---- Recording panel ---- */}
        <Card style={styles.recPanel}>
          {isRecording ? (
            <>
              <Text style={styles.recLabel} testID="rec-state">{isPaused ? 'PAUSED' : 'RECORDING'}</Text>
              <View style={styles.statsRow}>
                <Stat icon={<RouteIcon size={18} color={theme.colors.primary} />} label="Distance" value={fmtDistance(distanceM)} />
                <Stat icon={<Clock size={18} color={theme.colors.primary} />} label="Duration" value={fmtDuration(durationSec)} />
                <Stat icon={<Gauge size={18} color={theme.colors.primary} />} label="Speed" value={`${msToMph(currentSpeed).toFixed(0)} mph`} />
              </View>
              <Text style={styles.helperText}>
                {isPaused
                  ? `Paused · ${points.length} points so far. Resume when you are driving again.`
                  : `Tracking via GPS · ${points.length} points captured`}
              </Text>
              {isPaused ? (
                <TouchableOpacity style={styles.startBtn} onPress={resume} testID="btn-resume-recording">
                  <Play size={20} color="#fff" />
                  <Text style={styles.startBtnText}>Resume</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.pauseBtn} onPress={pause} testID="btn-pause-recording">
                  <Pause size={20} color={theme.colors.primary} />
                  <Text style={styles.pauseBtnText}>Pause</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.stopBtn} onPress={stop} testID="btn-stop-recording">
                <Square size={20} color="#fff" />
                <Text style={styles.stopBtnText}>Stop & Save</Text>
              </TouchableOpacity>
              <Text style={styles.notesLabel}>Positives (private)</Text>
              <TextInput
                value={positives}
                onChangeText={(v) => { positivesRef.current = v; setPositives(v); }}
                style={styles.notesInput}
                placeholder="What went well, e.g. good mirror checks, smooth junctions"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                maxLength={MAX_ROUTE_NOTES}
                testID="input-recording-positives"
              />
              <Text style={styles.notesLabel}>Negatives (private)</Text>
              <TextInput
                value={negatives}
                onChangeText={(v) => { negativesRef.current = v; setNegatives(v); }}
                style={styles.notesInput}
                placeholder="What needs work, e.g. stalled at the roundabout"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                maxLength={MAX_ROUTE_NOTES}
                testID="input-recording-negatives"
              />
              <Text style={styles.helperText}>Saved with the route. Your pupil never sees these.</Text>
            </>
          ) : (
            <>
              <Text style={styles.recLabel}>READY</Text>
              <Text style={styles.bigStat}>Tap to start tracking a lesson</Text>
              <Text style={styles.helperText}>
                {Platform.OS === 'web'
                  ? 'GPS is approximate in browser. For full accuracy, install the app on your phone.'
                  : 'Keep your phone with you — the route records until you tap Stop. You can pause it for a break.'}
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
            <Text style={styles.emptyHint}>Tap &quot;Start Recording&quot; to capture your first lesson route.</Text>
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
                  {formatDate(r.startedAt)}
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
          onFeedbackSaved={async (fb) => { await updateRouteFeedback(detail.id, fb); await reloadRoutes(); setDetail({ ...detail, positives: cleanRouteNotes(fb.positives), negatives: cleanRouteNotes(fb.negatives) }); }}
          onNotesSaved={async (text) => { await updateRouteNotes(detail.id, text); await reloadRoutes(); setDetail({ ...detail, notes: cleanRouteNotes(text) }); }}
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
  route, onOpenMaps, onShareGpx, onDelete, onRenamed, onFeedbackSaved, onNotesSaved,
}: {
  route: SavedRoute;
  onOpenMaps: () => void;
  onShareGpx: () => void;
  onDelete: () => void;
  onRenamed: (newName: string) => void;
  onFeedbackSaved: (feedback: { positives: string; negatives: string }) => void;
  onNotesSaved: (notes: string) => void;
}) {
  const [name, setName] = useState(route.name);
  const [notes, setNotes] = useState(route.notes || '');
  const [positives, setPositives] = useState(route.positives || '');
  const [negatives, setNegatives] = useState(route.negatives || '');
  const saveFeedback = (p: string, n: string) => {
    if (p.trim() !== (route.positives || '') || n.trim() !== (route.negatives || '')) onFeedbackSaved({ positives: p, negatives: n });
  };
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

      <Text style={styles.detailLabel}>Positives (private)</Text>
      <TextInput
        value={positives}
        onChangeText={setPositives}
        onBlur={() => saveFeedback(positives, negatives)}
        style={[styles.nameInput, styles.notesInput, { alignSelf: 'stretch' }]}
        placeholder="What went well"
        placeholderTextColor={theme.colors.textMuted}
        multiline
        maxLength={MAX_ROUTE_NOTES}
        testID="input-route-positives"
      />

      <Text style={styles.detailLabel}>Negatives (private)</Text>
      <TextInput
        value={negatives}
        onChangeText={setNegatives}
        onBlur={() => saveFeedback(positives, negatives)}
        style={[styles.nameInput, styles.notesInput, { alignSelf: 'stretch' }]}
        placeholder="What needs work"
        placeholderTextColor={theme.colors.textMuted}
        multiline
        maxLength={MAX_ROUTE_NOTES}
        testID="input-route-negatives"
      />

      {!!route.notes && (
        <>
          <Text style={styles.detailLabel}>Earlier notes (private)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            onBlur={() => { if (notes.trim() !== (route.notes || '')) onNotesSaved(notes); }}
            style={[styles.nameInput, styles.notesInput, { alignSelf: 'stretch' }]}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={MAX_ROUTE_NOTES}
            testID="input-route-notes"
          />
        </>
      )}

      <View style={styles.detailStatsRow}>
        <Stat icon={<RouteIcon size={18} color={theme.colors.primary} />} label="Distance" value={fmtDistance(route.distanceMeters)} />
        <Stat icon={<Clock size={18} color={theme.colors.primary} />} label="Duration" value={fmtDuration(route.durationSec)} />
        <Stat icon={<MapPin size={18} color={theme.colors.primary} />} label="Points" value={`${route.points.length}`} />
      </View>

      <Text style={styles.helperText}>
        Recorded on {formatDateTime(route.startedAt)}
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
  linkedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.colors.primaryLight,
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
    marginBottom: 12,
  },
  linkedBannerText: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
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
  pauseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: theme.colors.primary, paddingHorizontal: 28, paddingVertical: 12,
    borderRadius: 999, alignSelf: 'stretch',
  },
  pauseBtnText: { color: theme.colors.primary, fontSize: 16, fontWeight: '800' },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.colors.danger, paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 999, marginTop: 4, alignSelf: 'stretch',
  },
  stopBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  notesLabel: { alignSelf: 'stretch', fontSize: 12, color: theme.colors.textMuted, fontWeight: '800', letterSpacing: 0.5, marginTop: 8 },
  notesInput: {
    alignSelf: 'stretch', minHeight: 90, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingTop: 10, textAlignVertical: 'top', fontSize: 15, color: theme.colors.text,
    backgroundColor: theme.colors.background,
  },
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
