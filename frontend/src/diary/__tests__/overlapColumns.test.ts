import { assignOverlapColumns } from '../dateUtils';

describe('assignOverlapColumns', () => {
  it('gives every item its own single column when nothing overlaps', () => {
    const items = [
      { id: 'a', startMin: 540, endMin: 600 }, // 9:00-10:00
      { id: 'b', startMin: 600, endMin: 660 }, // 10:00-11:00 (touches, doesn't overlap)
      { id: 'c', startMin: 720, endMin: 780 }, // 12:00-13:00
    ];
    const result = assignOverlapColumns(items);
    expect(result.a).toEqual({ column: 0, totalColumns: 1 });
    expect(result.b).toEqual({ column: 0, totalColumns: 1 });
    expect(result.c).toEqual({ column: 0, totalColumns: 1 });
  });

  it('splits two identically-timed lessons into two columns — the exact bug found via screen recording', () => {
    const items = [
      { id: 'ali', startMin: 540, endMin: 660 },   // 9:00-11:00
      { id: 'grant', startMin: 540, endMin: 660 }, // 9:00-11:00, same slot
    ];
    const result = assignOverlapColumns(items);
    expect(result.ali.totalColumns).toBe(2);
    expect(result.grant.totalColumns).toBe(2);
    // The two must land in DIFFERENT columns, not the same one — that
    // would just recreate the original bug with extra steps.
    expect(result.ali.column).not.toBe(result.grant.column);
  });

  it('handles a partial overlap (not an exact time match) the same way', () => {
    const items = [
      { id: 'a', startMin: 540, endMin: 630 }, // 9:00-10:30
      { id: 'b', startMin: 600, endMin: 660 }, // 10:00-11:00 — overlaps a by 30 min
    ];
    const result = assignOverlapColumns(items);
    expect(result.a.totalColumns).toBe(2);
    expect(result.b.totalColumns).toBe(2);
    expect(result.a.column).not.toBe(result.b.column);
  });

  it('reuses a column once it frees up, rather than growing forever', () => {
    // a and b overlap (need 2 columns); c starts after a has already
    // ended, so c should reuse column 0 rather than requiring a 3rd column.
    const items = [
      { id: 'a', startMin: 540, endMin: 600 }, // 9:00-10:00
      { id: 'b', startMin: 570, endMin: 630 }, // 9:30-10:30 — overlaps a
      { id: 'c', startMin: 600, endMin: 660 }, // 10:00-11:00 — starts exactly when a ends
    ];
    const result = assignOverlapColumns(items);
    expect(result.a.column).toBe(0);
    expect(result.b.column).toBe(1);
    expect(result.c.column).toBe(0); // reuses a's now-free column
    // All three are part of the same connected cluster (a-b overlap,
    // b-c overlap), so they should all report the same total.
    expect(result.a.totalColumns).toBe(2);
    expect(result.b.totalColumns).toBe(2);
    expect(result.c.totalColumns).toBe(2);
  });

  it('requires a genuine 3-way overlap to actually need 3 columns', () => {
    const items = [
      { id: 'a', startMin: 540, endMin: 660 }, // 9:00-11:00
      { id: 'b', startMin: 570, endMin: 630 }, // 9:30-10:30 — fully inside a
      { id: 'c', startMin: 600, endMin: 720 }, // 10:00-12:00 — overlaps both
    ];
    const result = assignOverlapColumns(items);
    expect(result.a.totalColumns).toBe(3);
    expect(result.b.totalColumns).toBe(3);
    expect(result.c.totalColumns).toBe(3);
    const cols = new Set([result.a.column, result.b.column, result.c.column]);
    expect(cols.size).toBe(3); // all three genuinely distinct
  });

  it('treats two separate, non-overlapping clusters independently', () => {
    const items = [
      { id: 'a', startMin: 540, endMin: 600 }, // 9:00-10:00
      { id: 'b', startMin: 540, endMin: 600 }, // 9:00-10:00, clashes with a
      { id: 'c', startMin: 780, endMin: 840 }, // 13:00-14:00, no clash with anything
    ];
    const result = assignOverlapColumns(items);
    expect(result.a.totalColumns).toBe(2);
    expect(result.b.totalColumns).toBe(2);
    expect(result.c.totalColumns).toBe(1); // its own separate cluster, unaffected
  });

  it('returns an empty object for an empty list', () => {
    expect(assignOverlapColumns([])).toEqual({});
  });
});
