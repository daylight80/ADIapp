import { api } from './api';
import { Student, Lesson } from './mockDb';

export type TravelTime = {
  duration_minutes: number;
  duration_in_traffic_minutes: number;
  distance_km: number;
  status: 'ok' | 'fallback' | 'no_route' | 'error';
  cached: boolean;
};

// Client-side cache (in addition to the backend's 5-minute cache)
const _cache = new Map<string, { value: TravelTime; expires: number }>();
const TTL_MS = 5 * 60 * 1000;

export function addressForStudent(s: Student | undefined): string {
  if (!s) return '';
  return `${s.address || ''}, ${s.postcode || ''}`.trim();
}

export function lessonAddress(lesson: Lesson, student: Student | undefined): string {
  return lesson.pickup_address || addressForStudent(student);
}

export async function getTravelTime(origin: string, destination: string, departureAt?: Date): Promise<TravelTime | null> {
  if (!origin || !destination || origin === destination) return null;
  const key = `${origin.toLowerCase().trim()}|${destination.toLowerCase().trim()}`;
  const cached = _cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { ...cached.value, cached: true };
  }
  try {
    const res = await api.post('/maps/travel-time', {
      origin,
      destination,
      departure_at: departureAt ? departureAt.toISOString() : undefined,
    });
    const value: TravelTime = res.data;
    _cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  } catch {
    return null;
  }
}

export function formatEta(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function minutesBetween(prevEnd: string, prevDate: string, nextStart: string, nextDate: string): number {
  // Both dates as YYYY-MM-DD, times as HH:mm
  const a = new Date(`${prevDate}T${prevEnd}:00`);
  const b = new Date(`${nextDate}T${nextStart}:00`);
  return Math.round((b.getTime() - a.getTime()) / 60000);
}
