import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * On-device route recorder — stores GPS breadcrumb trails in AsyncStorage.
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
};

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

/** Human-readable distance with the right unit. */
export function fmtDistance(metres: number): string {
  if (metres < 1000) return `${metres.toFixed(0)} m`;
  return `${(metres / 1000).toFixed(metres > 10_000 ? 0 : 2)} km`;
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
    const arr = JSON.parse(raw) as SavedRoute[];
    return arr.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[routes] listRoutes failed', e);
    return [];
  }
}

export async function saveRoute(r: SavedRoute): Promise<void> {
  const all = await listRoutes();
  const idx = all.findIndex((x) => x.id === r.id);
  if (idx >= 0) all[idx] = r; else all.unshift(r);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export async function deleteRoute(id: string): Promise<void> {
  const all = await listRoutes();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all.filter((r) => r.id !== id)));
}

export async function renameRoute(id: string, name: string): Promise<void> {
  const all = await listRoutes();
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx].name = name.trim() || all[idx].name;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
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
