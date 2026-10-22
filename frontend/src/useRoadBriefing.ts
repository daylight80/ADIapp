import { useEffect, useMemo, useState } from 'react';
import type { Lesson, Student } from './supabaseDb';
import { getTravelTime, lessonAddress } from './maps';
import { callBackend } from './backendCall';
import {
  upcomingToday, changeoverPairs, weatherWindows, buildBriefing,
  type WeatherWindow, type WeatherResult, type BriefItem,
} from './roadBriefing';

export type Briefing = { items: BriefItem[]; headline: string | null; checked: boolean };

const CACHE_MS = 10 * 60 * 1000;
const done = new Map<string, { at: number; briefing: Briefing }>();
const running = new Map<string, Promise<Briefing>>();

/** For tests. */
export function resetRoadBriefingCache(): void {
  done.clear();
  running.clear();
}

type WeatherReply = { status: 'ok' | 'unavailable'; results: (WeatherResult & { id: string })[] };

/** Weather for one postcode area's lessons. Anything that goes wrong just means no weather lines. */
export async function fetchWeather(outcode: string, windows: WeatherWindow[]): Promise<Record<string, WeatherResult>> {
  try {
    const r = await callBackend<WeatherReply>('/v2/briefing/weather', 'POST', { outcode, windows });
    if (r.status !== 'ok') return {};
    return Object.fromEntries(r.results.map((x) => [x.id, { flags: x.flags, summary: x.summary, covered: x.covered }]));
  } catch {
    return {};
  }
}

async function compute(lessons: Lesson[], students: Student[]): Promise<Briefing> {
  const byId = new Map(students.map((s) => [s.id, s]));
  const addressOf = (l: Lesson) => lessonAddress(l, byId.get(l.student_id));
  const nameOf = (id: string) => (byId.get(id)?.name || 'A pupil').split(' ')[0];
  const now = new Date();

  const pairs = changeoverPairs(lessons, addressOf, now);
  // Only real traffic figures count: the backend marks a stand-in estimate as 'fallback', which is ignored.
  const travel = await Promise.all(pairs.map(async (pair) => {
    const t = await getTravelTime(pair.from, pair.to, pair.departAt);
    return { pair, travel: t && t.status === 'ok' ? { minutes: t.duration_in_traffic_minutes } : null };
  }));

  const groups = weatherWindows(lessons, addressOf);
  const replies = await Promise.all(Object.entries(groups).map(([oc, w]) => fetchWeather(oc, w)));
  const weather: Record<string, WeatherResult> = Object.assign({}, ...replies);

  return buildBriefing({ lessons, nameOf, changeovers: travel, weather });
}

/**
 * Today's road briefing (traffic between back-to-back lessons and weather at lesson times) for the instructor's own
 * lessons. Paid plans only (`enabled`). The result is kept for ten minutes and shared, so the Home card and the
 * Action Centre don't each make the same calls. A failure leaves the briefing out rather than showing an error.
 */
export function useRoadBriefing(allLessons: Lesson[], students: Student[], enabled: boolean): { briefing: Briefing | null; loading: boolean } {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);

  const today = useMemo(() => upcomingToday(allLessons), [allLessons]);
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const signature = today
    .map((l) => `${l.id}@${l.date}T${l.start_time}-${l.end_time}|${lessonAddress(l, byId.get(l.student_id))}`)
    .join(';');

  useEffect(() => {
    if (!enabled || today.length === 0) { setBriefing(null); setLoading(false); return; }
    const cached = done.get(signature);
    if (cached && Date.now() - cached.at < CACHE_MS) { setBriefing(cached.briefing); setLoading(false); return; }

    let alive = true;
    setLoading(true);
    let p = running.get(signature);
    if (!p) {
      p = compute(today, students)
        .then((b) => { done.set(signature, { at: Date.now(), briefing: b }); return b; })
        .catch(() => ({ items: [], headline: null, checked: false } as Briefing))
        .finally(() => { running.delete(signature); });
      running.set(signature, p);
    }
    p.then((b) => { if (alive) { setBriefing(b); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);

  return { briefing, loading };
}
