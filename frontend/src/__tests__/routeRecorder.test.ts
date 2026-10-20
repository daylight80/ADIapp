import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { listRoutes, saveRoute, deleteRoute, renameRoute, type SavedRoute } from '../routeRecorder';
import { isEncryptedBlob, __resetCacheForTests } from '../secureBlob';

const STORAGE_KEY = '@adipro_routes_v1';

function makeRoute(id: string, name: string): SavedRoute {
  return {
    id,
    name,
    startedAt: '2026-09-14T10:00:00.000Z',
    endedAt: '2026-09-14T10:30:00.000Z',
    durationSec: 1800,
    distanceMeters: 8000,
    points: [{ lat: 51.36, lng: -0.19, t: 1757844000000 }],
  };
}

describe('routeRecorder — persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await SecureStore.deleteItemAsync('adipro_blob_encryption_key_v1');
    __resetCacheForTests();
  });

  it('starts with no saved routes', async () => {
    expect(await listRoutes()).toEqual([]);
  });

  it('saves and reads back a route', async () => {
    await saveRoute(makeRoute('r1', 'Lesson with Helen'));
    const routes = await listRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].name).toBe('Lesson with Helen');
  });

  it('stores routes encrypted at rest — the raw AsyncStorage value is never plain JSON', async () => {
    await saveRoute(makeRoute('r1', 'Lesson with Helen'));
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(isEncryptedBlob(raw!)).toBe(true);
    // Plain JSON.parse must fail on it — proving it's genuinely encrypted,
    // not just prefixed.
    expect(() => JSON.parse(raw!)).toThrow();
  });

  it('updates an existing route in place rather than duplicating it', async () => {
    await saveRoute(makeRoute('r1', 'Original name'));
    const updated = makeRoute('r1', 'Original name');
    updated.distanceMeters = 9999;
    await saveRoute(updated);
    const routes = await listRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].distanceMeters).toBe(9999);
  });

  it('deletes a route by id', async () => {
    await saveRoute(makeRoute('r1', 'Keep'));
    await saveRoute(makeRoute('r2', 'Delete me'));
    await deleteRoute('r2');
    const routes = await listRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].id).toBe('r1');
  });

  it('renames a route', async () => {
    await saveRoute(makeRoute('r1', 'Old name'));
    await renameRoute('r1', 'New name');
    const routes = await listRoutes();
    expect(routes[0].name).toBe('New name');
  });

  it('reads legacy plaintext JSON written before encryption existed, without losing it', async () => {
    // Simulates data saved by a version of the app from before this
    // change — plain JSON.stringify(...), no encryption at all.
    const legacyRoutes = [makeRoute('legacy-1', 'Old unencrypted route')];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(legacyRoutes));

    const routes = await listRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].name).toBe('Old unencrypted route');
  });

  it('silently migrates legacy plaintext to encrypted on the next write', async () => {
    const legacyRoutes = [makeRoute('legacy-1', 'Old unencrypted route')];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(legacyRoutes));

    // Any write-through call re-saves the full list — renaming the
    // existing legacy entry is enough to trigger it.
    await renameRoute('legacy-1', 'Still here, now encrypted');

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(isEncryptedBlob(raw!)).toBe(true);
    const routes = await listRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].name).toBe('Still here, now encrypted');
  });
});

describe('routeRecorder — pausing and pupil routes', () => {
  const { activeSeconds, nextPoint, routeToGPX, listRoutesForStudent } = require('../routeRecorder');
  const pt = (lat: number, lng: number, extra: object = {}) => ({ lat, lng, t: 1, ...extra });

  it('counts only recording time, not paused time', () => {
    expect(activeSeconds(0, 1000, 11_000)).toBe(10);          // running for 10s
    expect(activeSeconds(65_000, null, 999_999)).toBe(65);    // paused: only the banked time
    expect(activeSeconds(60_000, 5_000, 35_000)).toBe(90);    // banked 60s + 30s since resuming
  });

  it('drops poor fixes and jitter, keeps real movement', () => {
    const a = pt(51.0, -0.2);
    expect(nextPoint(a, pt(51.0, -0.2, { acc: 80 }), false)).toBeNull();
    expect(nextPoint(a, pt(51.0000001, -0.2), false)).toBeNull();
    const moved = nextPoint(a, pt(51.001, -0.2), false)!;
    expect(moved.addedMeters).toBeGreaterThan(100);
    expect(moved.point.brk).toBeUndefined();
  });

  it('starts a new segment after a pause, adding no distance across the gap', () => {
    const res = nextPoint(pt(51.0, -0.2), pt(51.05, -0.2), true)!;
    expect(res.addedMeters).toBe(0);
    expect(res.point.brk).toBe(true);
    expect(nextPoint(undefined, pt(51.0, -0.2), true)!.point.brk).toBeUndefined();
  });

  it('writes a separate GPX segment after a pause', () => {
    const gpx = routeToGPX({ ...makeRoute('r', 'Break'), points: [pt(51, -0.2), pt(51.001, -0.2), pt(51.05, -0.2, { brk: true })] });
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
  });

  it('lists only the routes saved against one pupil', async () => {
    await AsyncStorage.clear();
    await saveRoute({ ...makeRoute('a', 'A'), studentId: 's1' });
    await saveRoute({ ...makeRoute('b', 'B'), studentId: 's2' });
    expect((await listRoutesForStudent('s1')).map((r: SavedRoute) => r.id)).toEqual(['a']);
    expect(await listRoutesForStudent('')).toEqual([]);
  });
});

describe('routeRecorder — private notes', () => {
  const { cleanRouteNotes, updateRouteNotes, routeToGPX, MAX_ROUTE_NOTES } = require('../routeRecorder');

  it('tidies notes: trimmed, capped, empty becomes nothing', () => {
    expect(cleanRouteNotes('  stalled at the roundabout  ')).toBe('stalled at the roundabout');
    expect(cleanRouteNotes('   ')).toBeUndefined();
    expect(cleanRouteNotes(null)).toBeUndefined();
    expect(cleanRouteNotes('x'.repeat(MAX_ROUTE_NOTES + 50))).toHaveLength(MAX_ROUTE_NOTES);
  });

  it('saves notes with the route and lets them be edited later', async () => {
    await AsyncStorage.clear();
    await saveRoute({ ...makeRoute('n1', 'With notes'), notes: 'Good mirror checks' });
    expect((await listRoutes())[0].notes).toBe('Good mirror checks');
    await updateRouteNotes('n1', 'Good mirror checks. Work on roundabouts.');
    expect((await listRoutes())[0].notes).toBe('Good mirror checks. Work on roundabouts.');
    await updateRouteNotes('n1', '  ');
    expect((await listRoutes())[0].notes).toBeUndefined();
  });

  it('keeps the notes private: they are not in the GPX file that gets shared', () => {
    const gpx = routeToGPX({ ...makeRoute('n2', 'Private'), notes: 'secret feedback' });
    expect(gpx).not.toContain('secret feedback');
  });
});
