import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_DIVISION, FEED_MAX_AGE_MS, isDivision, parseBankHolidays,
  type Division, type HolidayFeed, type HolidayMap,
} from './bankHolidays';

const FEED_URL = 'https://www.gov.uk/bank-holidays.json';
const FEED_KEY = 'bankHolidays.feed.v1';
const DIVISION_KEY = 'bankHolidays.division.v1';

// One fetch per app session, shared by every screen that asks.
let feedPromise: Promise<HolidayFeed> | null = null;
const divisionListeners = new Set<(d: Division) => void>();

async function loadFeed(): Promise<HolidayFeed> {
  // A saved copy first, so the diary shows holidays straight away and offline.
  let saved: { at: number; feed: HolidayFeed } | null = null;
  try {
    const raw = await AsyncStorage.getItem(FEED_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch { /* no saved copy */ }
  if (saved && Date.now() - saved.at < FEED_MAX_AGE_MS) return saved.feed;

  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const feed = parseBankHolidays(await res.json());
    if (Object.keys(feed).length > 0) {
      try { await AsyncStorage.setItem(FEED_KEY, JSON.stringify({ at: Date.now(), feed })); } catch { /* not saved */ }
      return feed;
    }
  } catch { /* fall through to an old copy */ }
  // The service is down: an out-of-date copy is better than none.
  return saved?.feed ?? {};
}

/** For tests: forget the feed fetched earlier in this session. */
export function resetBankHolidayCache(): void {
  feedPromise = null;
}

function getFeed(): Promise<HolidayFeed> {
  if (!feedPromise) feedPromise = loadFeed();
  return feedPromise;
}

export async function getDivision(): Promise<Division> {
  try {
    const v = await AsyncStorage.getItem(DIVISION_KEY);
    if (isDivision(v)) return v;
  } catch { /* default */ }
  return DEFAULT_DIVISION;
}

/** Saves the instructor's region on this device and updates every screen showing holidays. */
export async function setDivision(d: Division): Promise<void> {
  try { await AsyncStorage.setItem(DIVISION_KEY, d); } catch { /* not saved */ }
  divisionListeners.forEach((fn) => fn(d));
}

/** The bank holidays for the instructor's region (England & Wales unless changed in Profile). */
export function useBankHolidays(): { holidays: HolidayMap; division: Division } {
  const [feed, setFeed] = useState<HolidayFeed>({});
  const [division, setDivisionState] = useState<Division>(DEFAULT_DIVISION);

  useEffect(() => {
    let active = true;
    getFeed().then((f) => { if (active) setFeed(f); });
    getDivision().then((d) => { if (active) setDivisionState(d); });
    divisionListeners.add(setDivisionState);
    return () => { active = false; divisionListeners.delete(setDivisionState); };
  }, []);

  return { holidays: feed[division] ?? {}, division };
}
