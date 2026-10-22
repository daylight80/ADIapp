// "Add to Google Calendar" for one lesson: a link to Google's own event page with the details filled in. No account
// linking and nothing sent to us: the instructor taps it, Google opens, they press Save. It is instant, unlike the
// subscribed calendar feed (which Google refreshes only every 12 to 24 hours).

export type CalendarEvent = { title: string; start: Date; end: Date; location?: string; details?: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** 20261022T090000Z */
export function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const MAX_DETAILS = 800; // keeps the link a sensible length

export function googleCalendarUrl(ev: CalendarEvent): string {
  const q = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(ev.title)}`,
    `dates=${utcStamp(ev.start)}/${utcStamp(ev.end)}`,
    'ctz=Europe/London',
  ];
  if (ev.details) q.push(`details=${encodeURIComponent(ev.details.slice(0, MAX_DETAILS))}`);
  if (ev.location) q.push(`location=${encodeURIComponent(ev.location)}`);
  return `https://calendar.google.com/calendar/render?${q.join('&')}`;
}

function at(date: string, hhmm: string): Date | null {
  const [y, m, d] = (date || '').split('-').map(Number);
  const [h, mi] = (hhmm || '').split(':').map(Number);
  if (![y, m, d, h, mi].every(Number.isFinite)) return null;
  return new Date(y, m - 1, d, h, mi);
}

type LessonLike = {
  date: string; start_time: string; end_time: string;
  topic?: string | null; notes?: string | null; duration_hours?: number | null;
  lesson_type?: string | null; test_centre?: string | null; test_time?: string | null;
};

/** The calendar entry for a lesson, worded like the subscribed feed. Null if the lesson's times can't be read. */
export function lessonCalendarEvent(lesson: LessonLike, studentName: string, pickup: string): CalendarEvent | null {
  const start = at(lesson.date, lesson.start_time);
  const end = at(lesson.date, lesson.end_time);
  if (!start || !end || end <= start) return null;
  const name = (studentName || 'Student').trim();
  const isTest = lesson.lesson_type === 'Practical Test';

  const bits: string[] = [];
  if (isTest) {
    let head = 'Practical test';
    if (lesson.test_time) head += ` at ${lesson.test_time}`;
    if (lesson.test_centre) head += `, ${lesson.test_centre}`;
    bits.push(head);
    if (pickup) bits.push(`Pick-up: ${pickup}`);
  } else {
    bits.push((lesson.topic || 'Driving lesson').trim());
  }
  const hours = Number(lesson.duration_hours);
  if (Number.isFinite(hours) && hours > 0) bits.push(`${Number.isInteger(hours) ? hours : hours}h`);
  if (lesson.notes && lesson.notes.trim()) bits.push(lesson.notes.trim());

  return {
    title: `${isTest ? 'Practical test' : 'Driving lesson'} — ${name}`,
    start, end,
    location: pickup || undefined,
    details: bits.join(' · '),
  };
}
