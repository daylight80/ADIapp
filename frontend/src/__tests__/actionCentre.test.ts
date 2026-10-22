import { buildActionItems, groupActionItems, actionSummary, shortDay } from '../actionCentre';
import type { DeadlineItem } from '../deadlines';

// "Now" is Wed 22 Oct 2026, 15:00 local.
const NOW = new Date(2026, 9, 22, 15, 0);
const stu = (id: string, name: string, extra: Record<string, any> = {}) => ({ id, name, status: 'Active', ...extra });
const les = (id: string, student_id: string, date: string, start: string, end: string, status = 'Scheduled', extra: Record<string, any> = {}) =>
  ({ id, student_id, date, start_time: start, end_time: end, status, ...extra });
const dl = (kind: DeadlineItem['kind'], due_date: string): DeadlineItem =>
  ({ item_key: kind, id: kind, instructor_id: 'i', kind, label: null, due_date, notes: null, derived: false });

const build = (over: Partial<Parameters<typeof buildActionItems>[0]> = {}) =>
  buildActionItems({ now: NOW, students: [], lessons: [], hoursBalances: {}, deadlines: [], ...over });
const groupsOf = (items: ReturnType<typeof build>) => items.map((i) => i.group);

describe('Action Centre rules', () => {
  it('flags a lesson that has ended but was never marked complete, and not completed, cancelled or future ones', () => {
    const items = build({
      students: [stu('a', 'Sam')],
      lessons: [
        les('l1', 'a', '2026-10-22', '09:00', '11:00'),                 // ended, not marked
        les('l2', 'a', '2026-10-22', '12:00', '14:00', 'Completed'),
        les('l3', 'a', '2026-10-22', '10:00', '12:00', 'Cancelled'),
        les('l4', 'a', '2026-10-22', '16:00', '18:00'),                 // later today
        les('l5', 'a', '2026-10-22', '14:00', '15:00'),                 // ends exactly now: not yet overdue
      ],
    });
    const overdue = items.filter((i) => i.group === 'overdue_lessons');
    expect(overdue.map((i) => i.key)).toEqual(['overdue-l1']);
    expect(overdue[0].title).toBe('Sam: lesson not marked complete');
    expect(overdue[0].target).toEqual({ screen: 'diary', date: '2026-10-22' });
  });

  it('lists cancellations from the last 7 days and any still ahead, with the charge', () => {
    const items = build({
      students: [stu('a', 'Sam')],
      lessons: [
        les('old', 'a', '2026-10-10', '09:00', '11:00', 'Cancelled'),                       // 12 days ago: too old
        les('recent', 'a', '2026-10-20', '09:00', '11:00', 'Cancelled', { cancellation_charge: 20 }),
        les('ahead', 'a', '2026-10-25', '09:00', '11:00', 'Cancelled'),
      ],
    });
    const c = items.filter((i) => i.group === 'cancellations');
    expect(c.map((i) => i.key)).toEqual(['cancelled-recent', 'cancelled-ahead']);
    expect(c[0].detail).toMatch(/Cancellation charge £20/);
    expect(c[1].detail).toMatch(/free to rebook/);
  });

  it('flags a practical test within 14 days, urgent within 3, and ignores passed pupils and far-off tests', () => {
    const items = build({
      students: [
        stu('a', 'Sam', { test_date: '2026-10-24' }),
        stu('b', 'Pat', { test_date: '2026-11-03' }),
        stu('c', 'Lee', { test_date: '2026-12-01' }),
        stu('d', 'Kim', { test_date: '2026-10-23', status: 'Passed' }),
        stu('e', 'Old', { test_date: '2026-10-01' }),
      ],
    });
    const t = items.filter((i) => i.group === 'tests');
    expect(t.map((i) => i.key).sort()).toEqual(['test-a', 'test-b']);
    expect(t.find((i) => i.key === 'test-a')?.urgent).toBe(true);
    expect(t.find((i) => i.key === 'test-b')?.urgent).toBe(false);
    expect(t.find((i) => i.key === 'test-a')?.title).toMatch(/in 2 days/);
  });

  it('flags deadlines that are overdue or due within 30 days; overdue is urgent', () => {
    const items = build({ deadlines: [dl('mot', '2026-10-10'), dl('insurance', '2026-11-10'), dl('road_tax', '2027-03-01')] });
    const d = items.filter((i) => i.group === 'deadlines');
    expect(d.map((i) => i.key).sort()).toEqual(['deadline-insurance', 'deadline-mot']);
    expect(d.find((i) => i.key === 'deadline-mot')?.urgent).toBe(true);
    expect(d[0].target).toEqual({ screen: 'deadlines' });
  });

  it('flags low prepaid hours (some left, under 2) only for pupils having lessons', () => {
    const items = build({
      students: [stu('a', 'Sam'), stu('b', 'Pat'), stu('c', 'Lee'), stu('d', 'Kim', { status: 'Passed' })],
      hoursBalances: { a: 1.5, b: 5, c: 0, d: 1 },
      lessons: [les('x', 'a', '2026-10-25', '09:00', '10:00'), les('y', 'b', '2026-10-25', '09:00', '10:00'), les('z', 'c', '2026-10-25', '09:00', '10:00')],
    });
    expect(items.filter((i) => i.group === 'low_wallet').map((i) => i.key)).toEqual(['wallet-a']);
  });

  it('flags a pupil with no lesson in 14 days and nothing booked, but not one with a lesson booked or a recent one', () => {
    const items = build({
      students: [stu('a', 'Sam'), stu('b', 'Pat'), stu('c', 'Lee'), stu('d', 'Kim'), stu('e', 'Una', { status: 'Inactive' }), stu('f', 'Max')],
      lessons: [
        les('a1', 'a', '2026-10-01', '09:00', '10:00', 'Completed'),   // 21 days ago, nothing booked: quiet
        les('b1', 'b', '2026-10-01', '09:00', '10:00', 'Completed'),
        les('b2', 'b', '2026-10-28', '09:00', '10:00'),                // but has one booked
        les('c1', 'c', '2026-10-15', '09:00', '10:00', 'Completed'),   // 7 days ago
      ],
    });
    const q = items.filter((i) => i.group === 'inactive');
    expect(q.map((i) => i.key).sort()).toEqual(['inactive-a', 'inactive-d', 'inactive-f']);
    expect(q.find((i) => i.key === 'inactive-a')?.detail).toBe('Last lesson 21 days ago.');
    expect(q.find((i) => i.key === 'inactive-d')?.detail).toMatch(/No lesson in the last 30 days/);
  });

  it('puts urgent items first, then keeps the group order', () => {
    const items = build({
      students: [stu('a', 'Sam', { test_date: '2026-10-23' }), stu('b', 'Pat')],
      lessons: [les('l1', 'b', '2026-10-22', '09:00', '10:00')],
      deadlines: [dl('mot', '2026-10-10')],
    });
    expect(items[0].urgent).toBe(true);
    expect(items[1].urgent).toBe(true);
    expect(groupsOf(items).slice(0, 2)).toEqual(['tests', 'deadlines']);
    expect(groupsOf(items)[2]).toBe('overdue_lessons');
  });

  it('is empty when nothing needs doing', () => {
    expect(build()).toEqual([]);
    expect(actionSummary(0)).toBe("You're all caught up");
  });
});

describe('grouping and wording', () => {
  it('groups in display order and leaves out empty groups', () => {
    const items = build({ deadlines: [dl('mot', '2026-10-10')], students: [stu('a', 'Sam', { test_date: '2026-10-30' })], lessons: [les('x', 'a', '2026-10-27', '09:00', '10:00')] });
    expect(groupActionItems(items).map((g) => g.group)).toEqual(['tests', 'deadlines']);
  });
  it('words the summary', () => {
    expect(actionSummary(1)).toBe('1 thing needs you');
    expect(actionSummary(4)).toBe('4 things need you');
  });
  it('formats a day', () => {
    expect(shortDay('2026-10-21')).toMatch(/Wed/);
  });
});

describe('road briefing lines in the Action Centre', () => {
  it('adds today\'s road warnings as their own group, urgent ones first, each opening the diary', () => {
    const items = build({
      roadItems: [
        { key: 'weather-l1', kind: 'weather', severity: 'info', title: 'Sam, 09:30: rain', detail: '9°C', lessonId: 'l1' },
        { key: 'traffic-l2', kind: 'traffic', severity: 'warn', title: 'Pat, 11:00: you may be late', detail: 'd', lessonId: 'l2' },
      ],
    });
    const road = items.filter((i) => i.group === 'road');
    expect(road.map((i) => i.key)).toEqual(['road-traffic-l2', 'road-weather-l1']);
    expect(road[0].urgent).toBe(true);
    expect(road[1].urgent).toBe(false);
    expect(road[0].target).toEqual({ screen: 'diary' });
    expect(groupActionItems(items).map((g) => g.title)).toContain('On the road today');
  });

  it('adds nothing without a briefing', () => {
    expect(build().filter((i) => i.group === 'road')).toEqual([]);
  });
});
