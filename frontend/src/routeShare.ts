import { Alert, Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { routeToGPX, routeToGoogleMapsUrl, type SavedRoute } from './routeRecorder';

/** Opens a recorded route in Google Maps (app or browser). */
export async function openRouteInMaps(r: SavedRoute): Promise<void> {
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
}

/** Shares a recorded route as a GPX file (a download in the browser). */
export async function shareRouteGpx(r: SavedRoute): Promise<void> {
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
}
