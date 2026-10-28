import { sortBoard, boardBarPct, boardMain, boardSub, revenueBars, todayTotals, BOARD_SORTS } from '../schoolBoard';

const row = (id: string, revenue_month: number, lessons_month: number, students_active: number, pass_rate: number) =>
  ({ instructor_id: id, full_name: id, revenue_month, lessons_month, students_active, pass_rate });
const rows = [row('a', 1000, 40, 10, 60), row('b', 2500, 20, 12, 80), row('c', 500, 60, 8, 0)];

describe('schoolBoard', () => {
  it('sorts highest first by each measure without changing the input', () => {
    expect(sortBoard(rows, 'revenue_month').map((r) => r.instructor_id)).toEqual(['b', 'a', 'c']);
    expect(sortBoard(rows, 'lessons_month').map((r) => r.instructor_id)).toEqual(['c', 'a', 'b']);
    expect(sortBoard(rows, 'pass_rate').map((r) => r.instructor_id)).toEqual(['b', 'a', 'c']);
    expect(rows.map((r) => r.instructor_id)).toEqual(['a', 'b', 'c']);
    expect(BOARD_SORTS.map((s) => s.key)).toEqual(['revenue_month', 'lessons_month', 'students_active', 'pass_rate']);
  });

  it('sizes bars against the best row, pass rate against 100', () => {
    expect(boardBarPct(2500, 'revenue_month', rows)).toBe(100);
    expect(boardBarPct(1000, 'revenue_month', rows)).toBe(40);
    expect(boardBarPct(80, 'pass_rate', rows)).toBe(80);
    expect(boardBarPct(0, 'revenue_month', [row('z', 0, 0, 0, 0)])).toBe(0);
  });

  it('leads with the sorted measure and masks revenue while hidden', () => {
    expect(boardMain(rows[1], 'revenue_month', false)).toBe('£2500');
    expect(boardMain(rows[1], 'revenue_month', true)).toBe('£•••');
    expect(boardMain(rows[1], 'pass_rate', true)).toBe('80%');
    expect(boardMain(rows[1], 'lessons_month', true)).toBe('20');
  });

  it('lists the other measures under the name, hiding revenue when masked', () => {
    expect(boardSub(rows[0], 'lessons_month', false)).toBe('£1000 · 10 students · 60% pass');
    expect(boardSub(rows[0], 'lessons_month', true)).toBe('10 students · 60% pass');
    expect(boardSub(rows[0], 'revenue_month', true)).toBe('40 lessons · 10 students · 60% pass');
  });

  it('draws the revenue comparison bars', () => {
    expect(revenueBars(18420, 17010)).toEqual({ currentPct: 100, previousPct: 92 });
    expect(revenueBars(500, 1000)).toEqual({ currentPct: 50, previousPct: 100 });
    expect(revenueBars(0, 0)).toEqual({ currentPct: 0, previousPct: 0 });
    expect(revenueBars(100, 0)).toEqual({ currentPct: 100, previousPct: 0 });
  });

  it('totals today, ignoring cancelled lessons', () => {
    expect(todayTotals([
      { instructor_id: 'a', status: 'Completed' }, { instructor_id: 'a', status: 'Scheduled' },
      { instructor_id: 'b', status: 'Cancelled' }, { instructor_id: 'c', status: 'Scheduled' },
    ])).toEqual({ lessons: 3, instructors: 2, done: 1 });
    expect(todayTotals([])).toEqual({ lessons: 0, instructors: 0, done: 0 });
  });
});
