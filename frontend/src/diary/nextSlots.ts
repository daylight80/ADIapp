import { toMin, minutesToTime, addDays } from './dateUtils';
import { cleanBufferMinutes } from './buffer';

// "Next available": the first few times a lesson of a given length fits in the diary. A time works when it is inside
// working hours, is not in the past, does not touch time off, and leaves room for travel: the new lesson's own
// travel time after the lesson before it, and the next lesson's travel time after the new one (the same rule as the
// "tight turnaround" warning, so a suggested slot never triggers it). Suggestions never overlap each other.
// Pure logic, unit-tested.

export type SlotLesson = { date: string; start_time: string; end_time: string; status?: string | null; travel_minutes?: number | null };
export type SlotBlock = { starts_at: string; ends_at: string };
export type Slot = { date: string; start: string; end: string };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function findNextSlots(o: {
  lessons: SlotLesson[];
  blocks: SlotBlock[];
  /** YYYY-MM-DD and minutes since midnight right now: nothing earlier is offered. */
  today: string;
  nowMin: number;
  /** Lesson length in minutes. */
  length: number;
  /** Travel minutes the new lesson needs after the lesson before it. */
  travel: number;
  workStart: string;
  workEnd: string;
  count?: number;
  /** How many days ahead to look, counting today. */
  days?: number;
  /** Start times are offered on this many-minute grid. */
  step?: number;
}): Slot[] {
  const { lessons, blocks, length, workStart, workEnd } = o;
  const count = o.count ?? 3;
  const days = o.days ?? 28;
  const step = o.step ?? 15;
  const travel = cleanBufferMinutes(o.travel);
  const found: Slot[] = [];
  if (!(length > 0) || !(step > 0)) return found;

  const blockMs = blocks
    .map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e));
  const first = new Date(`${o.today}T00:00:00`);
  const wStart = toMin(workStart);
  const wEnd = toMin(workEnd);

  for (let i = 0; i < days && found.length < count; i += 1) {
    const date = ymd(addDays(first, i));
    const day = lessons
      .filter((l) => l.date === date && l.status !== 'Cancelled')
      .map((l) => ({ start: toMin(l.start_time), end: toMin(l.end_time), buffer: cleanBufferMinutes(l.travel_minutes) }));
    let s = Math.max(wStart, i === 0 ? Math.ceil(o.nowMin / step) * step : 0);
    s = Math.ceil(s / step) * step;
    while (s + length <= wEnd && found.length < count) {
      const e = s + length;
      const fits = day.every((l) => l.end + travel <= s || e + l.buffer <= l.start);
      const free = !blockMs.some(([bs, be]) => {
        const ls = new Date(`${date}T${minutesToTime(s)}:00`).getTime();
        const le = new Date(`${date}T${minutesToTime(e)}:00`).getTime();
        return bs < le && be > ls;
      });
      if (fits && free) {
        found.push({ date, start: minutesToTime(s), end: minutesToTime(e) });
        s = Math.ceil(e / step) * step; // the next suggestion starts after this one ends
      } else {
        s += step;
      }
    }
  }
  return found;
}
