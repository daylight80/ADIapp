// The intro video shown when the phone app opens, at most once every 24 hours. This is the rule and its storage;
// the player is in IntroVideo.native.tsx. Tested in __tests__/introSchedule.test.tsx.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const INTRO_STORAGE_KEY = '@dualcontrol_intro_last_shown';
export const INTRO_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The clip is 10 seconds; this is the longest the screen can stay up if the player never reports the end. */
export const INTRO_MAX_MS = 15_000;

/** Show it when it has never been shown, or the last showing was 24 hours ago or more. A clock set backwards counts as due. */
export function shouldShowIntro(lastShownMs: number | null, now: number): boolean {
  if (lastShownMs == null || !Number.isFinite(lastShownMs)) return true;
  const age = now - lastShownMs;
  return age < 0 || age >= INTRO_INTERVAL_MS;
}

export async function readIntroLastShown(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(INTRO_STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function markIntroShown(now: number = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(INTRO_STORAGE_KEY, String(now));
  } catch {
    // If this cannot be saved the intro simply shows again next time; never block the app on it.
  }
}
