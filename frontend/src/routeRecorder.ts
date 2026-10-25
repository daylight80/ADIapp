import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptBlob, decryptBlob, isEncryptedBlob } from './secureBlob';

/**
 * On-device route recorder — stores GPS breadcrumb trails in AsyncStorage,
 * encrypted (14 Sept 2026, per Grant directly) — see secureBlob.ts for why
 * this can't just move into SecureStore outright: a real lesson's route
 * routinely exceeds SecureStore's ~2KB per-value cap by a wide margin.
 *
 * No backend, no cloud, no API keys. Routes are exportable as GPX (a
 * universal format readable by Google My Maps, Strava, Garmin, etc.) and
 * can be deep-linked into the native Maps app for navigation.
 */

const STORAGE_KEY = '@adipro_routes_v1';

export type RoutePoint = {
  lat: number;
  lng: number;
  /** Unix epoch ms — used to compute speed and timeline replay. */
  t: number;
  /** Altitude in metres (if available). */
  alt?: number;
  /** Horizontal accuracy in metres (if available). */
  acc?: number;
  /** Speed in m/s (if available). */
  speed?: number;
  /** First point after a pause: the line is not joined to the point before it, and no distance is added across the gap. */
  brk?: boolean;
};

export type SavedRoute = {
  id: string;
  name: string;
  startedAt: string; // ISO
  endedAt: string;   // ISO
  durationSec: number;
  distanceMeters: number;
  points: RoutePoint[];
  /** Optional lesson link — for surfacing in lesson tools later. */
  lessonId?: string;
  /** Optional student link. */
  studentId?: string;
  /** The instructor's own notes. Private: never shown to the pupil. Routes saved before positives and negatives
   *  existed have just this; new ones use positives and negatives. */
  notes?: string;
  /** What went well on the lesson. Private. */
  positives?: string;
  /** What needs work. Private. */
  negatives?: string;
};

export const MAX_ROUTE_NOTES = 2000;

/** Notes as stored: trimmed, capped, and undefined when empty. */
export function cleanRouteNotes(raw: string | null | undefined): string | undefined {
  const t = (raw || '').trim().slice(0, MAX_ROUTE_NOTES);
  return t || undefined;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/** Haversine great-circle distance in metres between two lat/lng points. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Sum of consecutive Haversine distances for a route. */
export function totalDistance(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

/** UK road units: yards for the first tenth of a mile, then miles. The stored distance stays in metres. */
export function fmtDistance(metres: number): string {
  const miles = metres / 1609.344;
  if (miles < 0.1) return `${Math.round(metres / 0.9144)} yd`;
  return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
}

/** "1h 23m 45s" style duration. */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(ss).padStart(2, '0')}s`;
  return `${ss}s`;
}

/** mph from m/s (UK convention). */
export function msToMph(ms: number | undefined): number {
  if (ms == null || !Number.isFinite(ms)) return 0;
  return ms * 2.23694;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function listRoutes(): Promise<SavedRoute[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    // Legacy fallback: plaintext JSON written by a version of the app
    // from before encryption existed here. Reading it plain (rather than
    // throwing) means nothing already recorded is lost — the very next
    // write-through call re-saves it encrypted, migrating it silently.
    const json = isEncryptedBlob(raw) ? await decryptBlob(raw) : raw;
    const arr = JSON.parse(json) as SavedRoute[];
    return arr.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[routes] listRoutes failed', e);
    return [];
  }
}

// Every write goes through this so encryption can never be accidentally
// skipped by a call site that forgets it — same reasoning as the travel
// cache's _cache_travel() write-through helper on the backend.
async function writeAll(all: SavedRoute[]): Promise<void> {
  const encrypted = await encryptBlob(JSON.stringify(all));
  await AsyncStorage.setItem(STORAGE_KEY, encrypted);
}

export async function saveRoute(r: SavedRoute): Promise<void> {
  const all = await listRoutes();
  const idx = all.findIndex((x) => x.id === r.id);
  if (idx >= 0) all[idx] = r; else all.unshift(r);
  await writeAll(all);
}

export async function deleteRoute(id: string): Promise<void> {
  const all = await listRoutes();
  await writeAll(all.filter((r) => r.id !== id));
}

export async function renameRoute(id: string, name: string): Promise<void> {
  const all = await listRoutes();
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx].name = name.trim() || all[idx].name;
    await writeAll(all);
  }
}

/** Routes saved against one pupil (newest first). */
export async function listRoutesForStudent(studentId: string): Promise<SavedRoute[]> {
  if (!studentId) return [];
  return (await listRoutes()).filter((r) => r.studentId === studentId);
}

// ---------------------------------------------------------------------------
// Pausing
// ---------------------------------------------------------------------------

/** Seconds spent actually recording: time banked before the last pause, plus the current run (if not paused). */
export function activeSeconds(bankedMs: number, runStartedAt: number | null, now: number): number {
  const running = runStartedAt == null ? 0 : Math.max(0, now - runStartedAt);
  return Math.floor((Math.max(0, bankedMs) + running) / 1000);
}

/**
 * What to do with a new GPS fix. Accuracy worse than 40 m is dropped, and so is jitter under 3 m. The first
 * fix after a pause is always kept and marked as a break, with no distance added for the gap.
 */
export function nextPoint(
  last: RoutePoint | undefined,
  fix: RoutePoint,
  afterPause: boolean,
): { point: RoutePoint; addedMeters: number } | null {
  if (fix.acc != null && fix.acc > 40) return null;
  if (!last) return { point: fix, addedMeters: 0 };
  if (afterPause) return { point: { ...fix, brk: true }, addedMeters: 0 };
  const step = haversineMeters(last, fix);
  if (step < 3) return null;
  return { point: fix, addedMeters: step };
}

export async function updateRouteFeedback(id: string, feedback: { positives?: string; negatives?: string }): Promise<void> {
  const all = await listRoutes();
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx].positives = cleanRouteNotes(feedback.positives);
    all[idx].negatives = cleanRouteNotes(feedback.negatives);
    await writeAll(all);
  }
}

export async function updateRouteNotes(id: string, notes: string): Promise<void> {
  const all = await listRoutes();
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx].notes = cleanRouteNotes(notes);
    await writeAll(all);
  }
}

// ---------------------------------------------------------------------------
// GPX export — GPX 1.1 spec
// ---------------------------------------------------------------------------

export function routeToGPX(r: SavedRoute): string {
  const xmlEsc = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string),
    );
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<gpx version="1.1" creator="ADI Pro" xmlns="http://www.topografix.com/GPX/1/1">');
  lines.push('  <metadata>');
  lines.push(`    <name>${xmlEsc(r.name)}</name>`);
  lines.push(`    <time>${r.startedAt}</time>`);
  lines.push(`    <desc>Recorded with ADI Pro · ${fmtDistance(r.distanceMeters)} · ${fmtDuration(r.durationSec)}</desc>`);
  lines.push('  </metadata>');
  lines.push('  <trk>');
  lines.push(`    <name>${xmlEsc(r.name)}</name>`);
  lines.push('    <trkseg>');
  for (const p of r.points) {
    if (p.brk) { lines.push('    </trkseg>'); lines.push('    <trkseg>'); }
    const attrs = `lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}"`;
    const inner: string[] = [];
    if (p.alt != null) inner.push(`<ele>${p.alt.toFixed(1)}</ele>`);
    inner.push(`<time>${new Date(p.t).toISOString()}</time>`);
    if (p.speed != null) inner.push(`<extensions><speed>${p.speed.toFixed(2)}</speed></extensions>`);
    lines.push(`      <trkpt ${attrs}>${inner.join('')}</trkpt>`);
  }
  lines.push('    </trkseg>');
  lines.push('  </trk>');
  lines.push('</gpx>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Open recorded route in native Google Maps via deep-link
// ---------------------------------------------------------------------------

/**
 * Build a Google Maps directions URL containing up to 9 waypoints sampled
 * evenly from the recorded route. Returns a `https://www.google.com/maps/dir/`
 * URL that opens directly in the user's Maps app or browser.
 *
 * The reason we sample down to 9 waypoints: Google Maps limits the number
 * of stops in a single directions URL; if we pass all 500+ raw breadcrumb
 * points, the URL gets rejected or truncated. 9 evenly-spaced waypoints
 * give a faithful overview of the route.
 */
export function routeToGoogleMapsUrl(r: SavedRoute): string | null {
  if (!r.points || r.points.length < 2) return null;
  const N = r.points.length;
  // Pick origin, destination, and up to 7 evenly-spaced intermediate stops.
  const idxs: number[] = [0];
  const intermediates = Math.min(7, Math.max(0, N - 2));
  for (let i = 1; i <= intermediates; i += 1) {
    idxs.push(Math.round((i / (intermediates + 1)) * (N - 1)));
  }
  idxs.push(N - 1);
  const waypoints = idxs.map((i) => {
    const p = r.points[i];
    return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  });
  return `https://www.google.com/maps/dir/${waypoints.join('/')}`;
}
