// Today's road briefing: traffic between back-to-back lessons, and the weather at lesson times. Pure logic, so each
// rule is unit tested (see __tests__/roadBriefing.test.ts). The network parts live in useRoadBriefing.ts.

/** Fewer minutes than this to spare between travel and the next start counts as a tight changeover. */
export const TIGHT_SLACK_MINUTES = 5;
/** A gap longer than this is a break, not a changeover, so no travel check is made. */
export const MAX_CHANGEOVER_GAP_MINUTES = 120;

export type BriefLesson = {
  id: string;
  student_id: string;
  date: string;        // YYYY-MM-DD
  start_time: string;  // HH:mm
  end_time: string;    // HH:mm
  status?: string | null;
};

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function at(date: string, hhmm: string): Date | null {
  const [y, m, d] = (date || '').split('-').map(Number);
  const [h, mi] = (hhmm || '').split(':').map(Number);
  if (![y, m, d, h, mi].every(Number.isFinite)) return null;
  return new Date(y, m - 1, d, h, mi);
}

/** Today's lessons that haven't ended, are not completed or cancelled, soonest first. */
export function upcomingToday<T extends BriefLesson>(lessons: T[], now: Date = new Date()): T[] {
  const today = dayKey(now);
  return lessons
    .filter((l) => l.date === today && l.status !== 'Completed' && l.status !== 'Cancelled')
    .filter((l) => { const e = at(l.date, l.end_time); return !!e && e.getTime() > now.getTime(); })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export type Changeover = {
  fromId: string; toId: string;
  from: string; to: string;      // the addresses
  gapMinutes: number;
  departAt: Date;                // when the first lesson ends (or now, if that has passed)
};

/** The changeovers worth checking: consecutive lessons with different, known addresses and a short enough gap. */
export function changeoverPairs<T extends BriefLesson>(lessons: T[], addressOf: (l: T) => string, now: Date = new Date()): Changeover[] {
  const out: Changeover[] = [];
  for (let i = 0; i + 1 < lessons.length; i += 1) {
    const a = lessons[i], b = lessons[i + 1];
    const from = (addressOf(a) || '').trim(), to = (addressOf(b) || '').trim();
    const end = at(a.date, a.end_time), start = at(b.date, b.start_time);
    if (!from || !to || !end || !start) continue;
    if (from.toLowerCase() === to.toLowerCase()) continue;
    const gap = Math.round((start.getTime() - end.getTime()) / 60000);
    if (gap < 0 || gap > MAX_CHANGEOVER_GAP_MINUTES) continue;
    out.push({ fromId: a.id, toId: b.id, from, to, gapMinutes: gap, departAt: end.getTime() > now.getTime() ? end : now });
  }
  return out;
}

export type Verdict = { status: 'late' | 'tight' | 'ok'; slack: number };

/** Gap minus travel time: negative is late, under the tight limit is tight. */
export function changeoverVerdict(gapMinutes: number, travelMinutes: number): Verdict {
  const slack = gapMinutes - travelMinutes;
  return { status: slack < 0 ? 'late' : slack < TIGHT_SLACK_MINUTES ? 'tight' : 'ok', slack };
}

/** The outward part of a UK postcode in an address ('12 High St, Mitcham CR4 3AB' -> 'CR4'), or null. */
export function outcodeOf(address: string | null | undefined): string | null {
  const m = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*[0-9][A-Z]{2}\b/i.exec(address || '');
  return m ? m[1].toUpperCase() : null;
}

export type WeatherWindow = { id: string; start: string; end: string };

/** Lessons grouped by postcode area, as the time windows to ask the weather about. Lessons with no postcode are left out. */
export function weatherWindows<T extends BriefLesson>(lessons: T[], addressOf: (l: T) => string): Record<string, WeatherWindow[]> {
  const out: Record<string, WeatherWindow[]> = {};
  for (const l of lessons) {
    const oc = outcodeOf(addressOf(l));
    const s = at(l.date, l.start_time), e = at(l.date, l.end_time);
    if (!oc || !s || !e || e <= s) continue;
    (out[oc] ||= []).push({ id: l.id, start: s.toISOString(), end: e.toISOString() });
  }
  return out;
}

export type WeatherResult = { flags: { kind: string; text: string }[]; summary: string | null; covered: boolean };
export type TravelResult = { minutes: number } | null;

export type BriefItem = {
  key: string;
  kind: 'traffic' | 'weather';
  severity: 'warn' | 'info';
  title: string;
  detail: string;
  lessonId: string;
};

const WARN_WEATHER = new Set(['thunder', 'snow', 'ice', 'heavy_rain', 'fog']);

export function buildBriefing(input: {
  lessons: BriefLesson[];
  nameOf: (studentId: string) => string;
  changeovers: { pair: Changeover; travel: TravelResult }[];
  weather: Record<string, WeatherResult | undefined>;
}): { items: BriefItem[]; headline: string | null; checked: boolean } {
  const { lessons, nameOf, changeovers, weather } = input;
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const items: BriefItem[] = [];
  let late = 0, tight = 0, checkedTravel = 0;

  for (const { pair, travel } of changeovers) {
    if (!travel) continue;
    checkedTravel += 1;
    const v = changeoverVerdict(pair.gapMinutes, travel.minutes);
    if (v.status === 'ok') continue;
    const to = byId.get(pair.toId), from = byId.get(pair.fromId);
    if (!to || !from) continue;
    const toName = nameOf(to.student_id), fromName = nameOf(from.student_id);
    if (v.status === 'late') {
      late += 1;
      items.push({
        key: `traffic-${pair.toId}`, kind: 'traffic', severity: 'warn', lessonId: pair.toId,
        title: `${toName}, ${to.start_time}: you may be late`,
        detail: `${fromName} finishes at ${from.end_time}. The drive is about ${travel.minutes} min in current traffic and you have ${pair.gapMinutes} min.`,
      });
    } else {
      tight += 1;
      items.push({
        key: `traffic-${pair.toId}`, kind: 'traffic', severity: 'info', lessonId: pair.toId,
        title: `${toName}, ${to.start_time}: tight changeover`,
        detail: `About ${travel.minutes} min to drive from ${fromName}'s lesson, with ${pair.gapMinutes} min between them (${Math.max(v.slack, 0)} to spare).`,
      });
    }
  }

  let weatherChecked = 0;
  let firstWeather: { time: string; text: string; warn: boolean } | null = null;
  for (const l of [...lessons].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    const w = weather[l.id];
    if (!w || !w.covered) continue;
    weatherChecked += 1;
    if (w.flags.length === 0) continue;
    const worst = w.flags[0];
    const warn = WARN_WEATHER.has(worst.kind);
    items.push({
      key: `weather-${l.id}`, kind: 'weather', severity: warn ? 'warn' : 'info', lessonId: l.id,
      title: `${nameOf(l.student_id)}, ${l.start_time}: ${worst.text.toLowerCase()}`,
      detail: [w.flags.slice(1).map((f) => f.text).join(', '), w.summary].filter(Boolean).join('. ') || (w.summary ?? ''),
    });
    if (!firstWeather || (warn && !firstWeather.warn)) firstWeather = { time: l.start_time, text: worst.text, warn };
  }

  const checked = checkedTravel > 0 || weatherChecked > 0;
  if (!checked) return { items: [], headline: null, checked: false };

  const parts: string[] = [];
  if (late) parts.push(`${late} changeover${late > 1 ? 's' : ''} you may be late for`);
  if (tight) parts.push(`${tight} tight changeover${tight > 1 ? 's' : ''}`);
  if (firstWeather) parts.push(`${firstWeather.text.split(',')[0].toLowerCase()} from ${firstWeather.time}`);
  const headline = parts.length ? parts.join(' · ').replace(/^./, (c) => c.toUpperCase()) : 'Roads and weather look clear for today';
  return { items, headline, checked: true };
}
