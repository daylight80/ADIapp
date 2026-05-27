import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Lesson, Student } from './mockDb';

// On web preview, expo-notifications local scheduling falls back to a simple alert flow.
// In production native builds these become real device notifications.

let _configured = false;

export async function configureNotifications(): Promise<void> {
  if (_configured) return;
  _configured = true;
  if (Platform.OS !== 'web') {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  await configureNotifications();
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') return true;
      if (Notification.permission !== 'denied') {
        const p = await Notification.requestPermission();
        return p === 'granted';
      }
    }
    return false;
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ---------------------------------------------------------------------------
// Expo Push token registration — stores the device's push token against the
// signed-in auth user so the backend can fan out Smart Gap broadcasts.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient';
import Constants from 'expo-constants';

let _lastRegisteredToken: string | null = null;

export async function registerExpoPushToken(): Promise<string | null> {
  // Push tokens are a no-op on web (Expo Push targets native devices).
  if (Platform.OS === 'web') return null;
  const ok = await ensureNotificationPermission();
  if (!ok) return null;
  try {
    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ||
      (Constants.easConfig as any)?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResp.data;
    if (!token) return null;
    if (token === _lastRegisteredToken) return token; // skip re-uploads
    _lastRegisteredToken = token;

    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id;
    if (!uid) return token;

    // Upsert on (auth_user_id, expo_token) — unique index makes this idempotent.
    const { error } = await supabase.from('push_tokens').upsert(
      {
        auth_user_id: uid,
        expo_token: token,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'auth_user_id,expo_token' },
    );
    if (error) {
      // Graceful no-op if push_tokens doesn't exist yet (pre-Migration 007).
      // eslint-disable-next-line no-console
      console.warn('[push] could not register token:', error.message);
    }
    return token;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[push] registerExpoPushToken failed', e);
    return null;
  }
}

function lessonStartDate(lesson: Lesson): Date {
  const [h, m] = lesson.start_time.split(':').map(Number);
  const d = new Date(lesson.date);
  d.setHours(h, m, 0, 0);
  return d;
}

export async function scheduleLessonReminders(
  lesson: Lesson,
  student: Student
): Promise<{ scheduled: number }> {
  const granted = await ensureNotificationPermission();
  if (!granted) return { scheduled: 0 };

  const lessonAt = lessonStartDate(lesson);
  const now = Date.now();
  const oneDayBefore = new Date(lessonAt.getTime() - 24 * 60 * 60 * 1000);
  const oneHourBefore = new Date(lessonAt.getTime() - 60 * 60 * 1000);
  let count = 0;

  const fire = async (when: Date, title: string, body: string) => {
    if (when.getTime() <= now) return;
    if (Platform.OS === 'web') {
      const delay = when.getTime() - now;
      setTimeout(() => {
        try {
          // eslint-disable-next-line no-new
          new Notification(title, { body });
        } catch {}
      }, Math.min(delay, 2_147_483_000));
      count += 1;
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { lessonId: lesson.id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    count += 1;
  };

  await fire(
    oneDayBefore,
    'Lesson tomorrow',
    `${student.name} at ${lesson.start_time} — ${lesson.topic}`
  );
  await fire(
    oneHourBefore,
    'Lesson in 1 hour',
    `${student.name} at ${lesson.start_time}. ${lesson.topic}.`
  );
  return { scheduled: count };
}

export async function fireInstantNotification(title: string, body: string): Promise<void> {
  const granted = await ensureNotificationPermission();
  if (!granted) return;
  if (Platform.OS === 'web') {
    try {
      // eslint-disable-next-line no-new
      new Notification(title, { body });
    } catch {}
    return;
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

export async function cancelAllScheduled(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
