import { googleCalendarUrl, lessonCalendarEvent, utcStamp } from '../googleCalendarLink';
import { absoluteFeedUrl } from '../calendarFeed';

const lesson = (over: Record<string, any> = {}) => ({
  date: '2026-10-22', start_time: '09:00', end_time: '10:00', topic: 'Roundabouts', notes: '', duration_hours: 1, lesson_type: 'Standard', ...over,
});

describe('googleCalendarUrl', () => {
  it('builds Google’s event link with the times in UTC and everything encoded', () => {
    const start = new Date(Date.UTC(2026, 9, 22, 8, 0, 0)), end = new Date(Date.UTC(2026, 9, 22, 9, 30, 0));
    const url = googleCalendarUrl({ title: 'Driving lesson — Sam & Co', start, end, location: '10 Waterloo Rd, SM1', details: 'Roundabouts · 1.5h' });
    expect(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&')).toBe(true);
    expect(url).toContain('dates=20261022T080000Z/20261022T093000Z');
    expect(url).toContain('ctz=Europe/London');
    expect(url).toContain('text=Driving%20lesson%20%E2%80%94%20Sam%20%26%20Co');
    expect(url).toContain('location=10%20Waterloo%20Rd%2C%20SM1');
    expect(utcStamp(start)).toBe('20261022T080000Z');
  });

  it('leaves out location and details when there are none, and caps long details', () => {
    const start = new Date(Date.UTC(2026, 9, 22, 8)), end = new Date(Date.UTC(2026, 9, 22, 9));
    const bare = googleCalendarUrl({ title: 'x', start, end });
    expect(bare).not.toContain('location=');
    expect(bare).not.toContain('details=');
    const long = googleCalendarUrl({ title: 'x', start, end, details: 'a'.repeat(5000) });
    expect(decodeURIComponent(long.split('details=')[1]).length).toBe(800);
  });
});

describe('lessonCalendarEvent', () => {
  it('words a normal lesson like the calendar feed does', () => {
    const e = lessonCalendarEvent(lesson({ notes: 'Mirrors' }), 'Sam Smith', '10 Waterloo Road')!;
    expect(e.title).toBe('Driving lesson — Sam Smith');
    expect(e.details).toBe('Roundabouts · 1h · Mirrors');
    expect(e.location).toBe('10 Waterloo Road');
    expect(e.start).toEqual(new Date(2026, 9, 22, 9, 0));
    expect(e.end).toEqual(new Date(2026, 9, 22, 10, 0));
  });

  it('puts the test time and centre first for a Practical Test', () => {
    const e = lessonCalendarEvent(lesson({ lesson_type: 'Practical Test', test_time: '10:15', test_centre: 'Morden Test Centre', duration_hours: 2.5, end_time: '11:30' }), 'Sam Smith', '10 Waterloo Road')!;
    expect(e.title).toBe('Practical test — Sam Smith');
    expect(e.details).toBe('Practical test at 10:15, Morden Test Centre · Pick-up: 10 Waterloo Road · 2.5h');
  });

  it('copes with no pickup and no topic, and gives up on unreadable or backwards times', () => {
    const e = lessonCalendarEvent(lesson({ topic: '' }), '', '')!;
    expect(e.location).toBeUndefined();
    expect(e.details).toBe('Driving lesson · 1h');
    expect(e.title).toBe('Driving lesson — Student');
    expect(lessonCalendarEvent(lesson({ start_time: 'nope' }), 'Sam', 'x')).toBeNull();
    expect(lessonCalendarEvent(lesson({ start_time: '11:00', end_time: '10:00' }), 'Sam', 'x')).toBeNull();
  });
});

describe('the subscribable feed link', () => {
  const status = { enabled: true, token: 't', feed_path: '/api/calendar/t.ics' };
  it('is the plain link by default, and adds travel time only when asked', () => {
    expect(absoluteFeedUrl(status)).toMatch(/\/api\/calendar\/t\.ics$/);
    expect(absoluteFeedUrl(status, { travel: true })).toMatch(/\/api\/calendar\/t\.ics\?travel=1$/);
    expect(absoluteFeedUrl({ enabled: false, token: null, feed_path: null }, { travel: true })).toBeNull();
  });
});
