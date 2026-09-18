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
