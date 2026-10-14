// UK bank holidays, from the GOV.UK feed (https://www.gov.uk/bank-holidays.json). The feed
// has three divisions, because Scotland and Northern Ireland have different bank holidays.
// Pure logic only (parsing and lookups), so it can be tested; fetching and caching are in
// useBankHolidays.ts.

export type Division = 'england-and-wales' | 'scotland' | 'northern-ireland';

export const DIVISIONS: { value: Division; label: string }[] = [
  { value: 'england-and-wales', label: 'England & Wales' },
  { value: 'scotland', label: 'Scotland' },
  { value: 'northern-ireland', label: 'Northern Ireland' },
];

export const DEFAULT_DIVISION: Division = 'england-and-wales';

export function isDivision(v: unknown): v is Division {
  return v === 'england-and-wales' || v === 'scotland' || v === 'northern-ireland';
}

/** YYYY-MM-DD -> holiday name, for one division. */
export type HolidayMap = Record<string, string>;

export type HolidayFeed = Partial<Record<Division, HolidayMap>>;

/**
 * Turns the GOV.UK feed into a lookup for each division. Anything that is not shaped like the
 * feed is skipped, so a changed or broken response gives an empty list, never a crash.
 */
export function parseBankHolidays(json: unknown): HolidayFeed {
  const feed: HolidayFeed = {};
  if (!json || typeof json !== 'object') return feed;
  for (const d of DIVISIONS) {
    const events = (json as any)[d.value]?.events;
    if (!Array.isArray(events)) continue;
    const map: HolidayMap = {};
    for (const e of events) {
      if (e && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.title === 'string') {
        map[e.date] = e.title;
      }
    }
    feed[d.value] = map;
  }
  return feed;
}

/** The bank holiday on a day (YYYY-MM-DD), or null. */
export function holidayOn(map: HolidayMap | undefined, dateKey: string): string | null {
  return (map && map[dateKey]) || null;
}

/**
 * A short label that fits a month-view cell: "Bank hol" for most, or the name when it is
 * short enough already ("Easter Monday" is not, so it falls back).
 */
export function shortLabel(title: string): string {
  return title.length <= 9 ? title : 'Bank hol';
}

/** "Bank holiday: Christmas Day", for a banner or a warning. */
export function holidayBanner(title: string): string {
  return `Bank holiday: ${title}`;
}

/** How long a saved copy of the feed is used before fetching again. */
export const FEED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
