import { findClashingLessons } from '../dateUtils';

describe('findClashingLessons', () => {
  it('returns nothing when no lessons overlap', () => {
    const lessons = [
      { id: 'a', date: '2026-09-03', startMin: 540, endMin: 600 }, // 9:00-10:00
      { id: 'b', date: '2026-09-03', startMin: 600, endMin: 660 }, // 10:00-11:00, touches but doesn't overlap
      { id: 'c', date: '2026-09-03', startMin: 720, endMin: 780 }, // 12:00-13:00
    ];
    expect(findClashingLessons(lessons)).toEqual([]);
  });

  it('finds two identically-timed lessons on the same date', () => {
    const lessons = [
      { id: 'ali', date: '2026-09-03', startMin: 540, endMin: 660 },
      { id: 'grant', date: '2026-09-03', startMin: 540, endMin: 660 },
    ];
    const result = findClashingLessons(lessons);
    expect(result).toHaveLength(1);
    expect(result[0].sort()).toEqual(['ali', 'grant']);
  });

  it('finds a partial overlap, not just an exact time match', () => {
    const lessons = [
      { id: 'a', date: '2026-09-03', startMin: 540, endMin: 630 }, // 9:00-10:30
      { id: 'b', date: '2026-09-03', startMin: 600, endMin: 660 }, // 10:00-11:00, overlaps a by 30 min
    ];
    const result = findClashingLessons(lessons);
    expect(result).toHaveLength(1);
    expect(result[0].sort()).toEqual(['a', 'b']);
  });

  it('never treats lessons on different dates as clashing, even at identical times', () => {
    const lessons = [
      { id: 'a', date: '2026-09-03', startMin: 540, endMin: 660 },
      { id: 'b', date: '2026-09-04', startMin: 540, endMin: 660 }, // same time, next day
    ];
    expect(findClashingLessons(lessons)).toEqual([]);
  });

  it('groups a genuine 3-way overlap into a single clash group, not three pairs', () => {
    const lessons = [
      { id: 'a', date: '2026-09-03', startMin: 540, endMin: 660 }, // 9:00-11:00
      { id: 'b', date: '2026-09-03', startMin: 570, endMin: 630 }, // 9:30-10:30, inside a
      { id: 'c', date: '2026-09-03', startMin: 600, endMin: 720 }, // 10:00-12:00, overlaps both
    ];
    const result = findClashingLessons(lessons);
    expect(result).toHaveLength(1);
    expect(result[0].sort()).toEqual(['a', 'b', 'c']);
  });

  it('treats two separate clash clusters on the same day independently', () => {
    const lessons = [
      { id: 'a', date: '2026-09-03', startMin: 540, endMin: 600 }, // clash 1
      { id: 'b', date: '2026-09-03', startMin: 540, endMin: 600 }, // clash 1
      { id: 'c', date: '2026-09-03', startMin: 780, endMin: 840 }, // clash 2
      { id: 'd', date: '2026-09-03', startMin: 780, endMin: 840 }, // clash 2
      { id: 'e', date: '2026-09-03', startMin: 900, endMin: 960 }, // no clash at all
    ];
    const result = findClashingLessons(lessons);
    expect(result).toHaveLength(2);
    const flat = result.map((g) => g.sort());
    expect(flat).toContainEqual(['a', 'b']);
    expect(flat).toContainEqual(['c', 'd']);
  });

  it('returns an empty array for an empty list', () => {
    expect(findClashingLessons([])).toEqual([]);
  });

  it('returns nothing for a single lesson with no one to clash with', () => {
    const lessons = [{ id: 'a', date: '2026-09-03', startMin: 540, endMin: 600 }];
    expect(findClashingLessons(lessons)).toEqual([]);
  });
});
