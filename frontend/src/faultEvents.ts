import type { RoutePoint } from './routeRecorder';

export type FaultType = 'driving' | 'serious' | 'dangerous';
/** One fault, marked live during a mock test: the DL25 line, the kind, and when (ms since 1970). */
export type FaultEvent = { key: string; type: FaultType; t: number };
export type LocatedFault = FaultEvent & { lat: number; lng: number };

/** Matches the database limit on a saved list. */
export const MAX_FAULT_EVENTS = 200;

const TYPES: FaultType[] = ['driving', 'serious', 'dangerous'];

export function addFaultEvent(events: FaultEvent[], e: FaultEvent): FaultEvent[] {
  return [...events, e].slice(-MAX_FAULT_EVENTS);
}

/** Takes off the most recent event of this kind on this line (the minus button), leaving the rest. */
export function removeLatestFaultEvent(events: FaultEvent[], key: string, type: FaultType): FaultEvent[] {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].key === key && events[i].type === type) return [...events.slice(0, i), ...events.slice(i + 1)];
  }
  return events;
}

/** A safe list from anything read from the database or a screen parameter: bad entries are dropped. */
export function parseFaultEvents(raw: unknown): FaultEvent[] {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is FaultEvent => !!e && typeof e.key === 'string' && TYPES.includes(e.type) && Number.isFinite(e.t))
    .map((e) => ({ key: e.key, type: e.type, t: e.t }))
    .slice(0, MAX_FAULT_EVENTS);
}

/**
 * Where each fault was: the recorded route point closest in time to when it was marked. During a pause there are no
 * points, so a fault marked then sits at the nearest one either side. Nothing is placed without a route of 2+ points.
 */
export function locateFaults(events: FaultEvent[], points: RoutePoint[]): LocatedFault[] {
  if (points.length < 2) return [];
  return events.map((e) => {
    let best = points[0];
    let bestGap = Math.abs(points[0].t - e.t);
    for (let i = 1; i < points.length; i += 1) {
      const gap = Math.abs(points[i].t - e.t);
      if (gap < bestGap) { best = points[i]; bestGap = gap; }
    }
    return { ...e, lat: best.lat, lng: best.lng };
  });
}
