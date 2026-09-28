import {
  parseDateOnly, isValidDateInput, daysUntil, formatDueDate, statusForDays, describeDays,
  itemDisplayName, sortByDueDate, needsAttention, availableKinds, attentionSummary,
  EDITABLE_KINDS, KIND_INFO, REMIND_DAYS, type DeadlineItem,
} from '../deadlines';

// A fixed "today": Monday 28 Sept 2026, 15:30 local.
const TODAY = new Date(2026, 8, 28, 15, 30, 0);

const mk = (over: Partial<DeadlineItem> = {}): DeadlineItem => ({
  item_key: 'k1', id: 'id1', instructor_id: 'i1', kind: 'mot', label: null,
  due_date: '2026-10-05', notes: null, derived: false, ...over,
});

describe('parseDateOnly / isValidDateInput', () => {
  it('accepts a real date', () => {
    expect(parseDateOnly('2026-10-08')).toEqual({ y: 2026, m: 10, d: 8 });
    expect(isValidDateInput(' 2026-10-08 ')).toBe(true);
  });

  it('rejects the wrong shape', () => {
    for (const bad of ['', '8/10/2026', '2026-1-8', '2026-10-8', '20261008', 'tomorrow', '2026-10-08T00:00']) {
      expect(isValidDateInput(bad)).toBe(false);
    }
  });

  it('rejects dates that do not exist, not just ones that look wrong', () => {
    expect(isValidDateInput('2026-02-30')).toBe(false);
    expect(isValidDateInput('2026-13-01')).toBe(false);
    expect(isValidDateInput('2026-00-10')).toBe(false);
    expect(isValidDateInput('2026-04-31')).toBe(false);
  });

  it('knows leap years', () => {
    expect(isValidDateInput('2028-02-29')).toBe(true);
    expect(isValidDateInput('2026-02-29')).toBe(false);
  });
});

describe('daysUntil', () => {
  it('counts whole calendar days', () => {
    expect(daysUntil('2026-09-28', TODAY)).toBe(0);
    expect(daysUntil('2026-09-29', TODAY)).toBe(1);
    expect(daysUntil('2026-10-05', TODAY)).toBe(7);
    expect(daysUntil('2026-10-28', TODAY)).toBe(30);
    expect(daysUntil('2026-09-27', TODAY)).toBe(-1);
  });

  it('does not change halfway through the day', () => {
    expect(daysUntil('2026-09-29', new Date(2026, 8, 28, 0, 0, 1))).toBe(1);
    expect(daysUntil('2026-09-29', new Date(2026, 8, 28, 23, 59, 59))).toBe(1);
  });

  it('is not thrown by the clocks changing', () => {
    // 25 Oct 2026 is when UK clocks go back: the day is 25 hours long
    expect(daysUntil('2026-10-26', new Date(2026, 9, 25, 12, 0, 0))).toBe(1);
    expect(daysUntil('2026-10-25', new Date(2026, 9, 24, 12, 0, 0))).toBe(1);
    // and 29 Mar 2027 when they go forward (a 23-hour day)
    expect(daysUntil('2027-03-30', new Date(2027, 2, 29, 12, 0, 0))).toBe(1);
  });

  it('crosses month and year ends', () => {
    expect(daysUntil('2027-01-01', new Date(2026, 11, 31, 9, 0, 0))).toBe(1);
    expect(daysUntil('2026-03-01', new Date(2026, 1, 28, 9, 0, 0))).toBe(1);
  });

  it('returns null for an unreadable date rather than guessing', () => {
    expect(daysUntil('nonsense', TODAY)).toBeNull();
  });
});

describe('formatDueDate', () => {
  it('reads the same on every device', () => {
    expect(formatDueDate('2026-10-08')).toBe('Thu 8 Oct 2026');
    expect(formatDueDate('2027-03-01')).toBe('Mon 1 Mar 2027');
    expect(formatDueDate('2026-12-31')).toBe('Thu 31 Dec 2026');
  });

  it('shows the raw text for something unreadable', () => {
    expect(formatDueDate('junk')).toBe('junk');
  });
});

describe('statusForDays / describeDays', () => {
  it('maps days to the same bands the reminders use', () => {
    expect(statusForDays(-1)).toBe('overdue');
    expect(statusForDays(0)).toBe('urgent');
    expect(statusForDays(7)).toBe('urgent');
    expect(statusForDays(8)).toBe('soon');
    expect(statusForDays(30)).toBe('soon');
    expect(statusForDays(31)).toBe('ok');
  });

  it('reminds at 30, 7 and 1 days, matching the backend', () => {
    expect([...REMIND_DAYS]).toEqual([30, 7, 1]);
  });

  it('describes in plain words', () => {
    expect(describeDays(-5)).toBe('Overdue by 5 days');
    expect(describeDays(-1)).toBe('Overdue by 1 day');
    expect(describeDays(0)).toBe('Due today');
    expect(describeDays(1)).toBe('Due tomorrow');
    expect(describeDays(12)).toBe('Due in 12 days');
  });
});

describe('itemDisplayName', () => {
  it('uses the standard name for standard kinds', () => {
    expect(itemDisplayName({ kind: 'mot', label: null })).toBe('MOT');
    expect(itemDisplayName({ kind: 'standards_check', label: null })).toBe('DVSA standards check');
    expect(itemDisplayName({ kind: 'adi_badge', label: null })).toBe('ADI badge renewal');
  });

  it("uses the instructor's own words for custom items", () => {
    expect(itemDisplayName({ kind: 'other', label: 'First aid certificate' })).toBe('First aid certificate');
    expect(itemDisplayName({ kind: 'other', label: '   ' })).toBe('Other');
  });

  it('has a name and a hint for every kind', () => {
    for (const k of [...EDITABLE_KINDS, 'standards_check' as const]) {
      expect(KIND_INFO[k].label.length).toBeGreaterThan(0);
      expect(KIND_INFO[k].hint.length).toBeGreaterThan(0);
    }
  });
});

describe('sortByDueDate', () => {
  it('puts overdue first, then soonest, without mutating the input', () => {
    const list = [mk({ item_key: 'a', due_date: '2026-11-01' }), mk({ item_key: 'b', due_date: '2026-09-20' }), mk({ item_key: 'c', due_date: '2026-10-01' })];
    const copy = [...list];
    expect(sortByDueDate(list, TODAY).map((i) => i.item_key)).toEqual(['b', 'c', 'a']);
    expect(list).toEqual(copy);
  });

  it('keeps items with unreadable dates, at the end', () => {
    const list = [mk({ item_key: 'bad', due_date: 'oops' }), mk({ item_key: 'ok', due_date: '2026-10-01' })];
    expect(sortByDueDate(list, TODAY).map((i) => i.item_key)).toEqual(['ok', 'bad']);
  });
});

describe('needsAttention', () => {
  const list = [
    mk({ item_key: 'overdue', due_date: '2026-09-01' }),
    mk({ item_key: 'soon', due_date: '2026-10-10' }),
    mk({ item_key: 'edge', due_date: '2026-10-28' }),   // exactly 30 days
    mk({ item_key: 'far', due_date: '2026-10-29' }),    // 31 days
    mk({ item_key: 'bad', due_date: 'oops' }),
  ];

  it('includes overdue and anything within 30 days, soonest first', () => {
    expect(needsAttention(list, 30, TODAY).map((i) => i.item_key)).toEqual(['overdue', 'soon', 'edge']);
  });

  it('respects a narrower window', () => {
    expect(needsAttention(list, 7, TODAY).map((i) => i.item_key)).toEqual(['overdue']);
  });
});

describe('availableKinds', () => {
  it('hides standard kinds already being tracked, but always offers Other', () => {
    const got = availableKinds([mk({ kind: 'mot' }), mk({ kind: 'insurance' }), mk({ kind: 'other', label: 'x' })]);
    expect(got).toEqual(['adi_badge', 'road_tax', 'dual_controls', 'other']);
  });

  it('offers everything when nothing is tracked yet', () => {
    expect(availableKinds([])).toEqual(EDITABLE_KINDS);
  });

  it('does not treat the derived standards check as blocking anything', () => {
    expect(availableKinds([mk({ kind: 'standards_check', derived: true, id: null })])).toEqual(EDITABLE_KINDS);
  });
});

describe('attentionSummary', () => {
  it('is null when nothing needs attention', () => {
    expect(attentionSummary([mk({ due_date: '2027-06-01' })], TODAY)).toBeNull();
    expect(attentionSummary([], TODAY)).toBeNull();
  });

  it('names a single item and how soon', () => {
    expect(attentionSummary([mk({ due_date: '2026-10-03' })], TODAY)).toBe('MOT: due in 5 days');
    expect(attentionSummary([mk({ due_date: '2026-09-29' })], TODAY)).toBe('MOT: due tomorrow');
    expect(attentionSummary([mk({ due_date: '2026-09-25' })], TODAY)).toBe('MOT: overdue by 3 days');
  });

  it('counts when there are several', () => {
    const many = [mk({ item_key: 'a', due_date: '2026-10-03' }), mk({ item_key: 'b', kind: 'insurance', due_date: '2026-10-10' })];
    expect(attentionSummary(many, TODAY)).toBe('2 deadlines need attention');
  });
});
