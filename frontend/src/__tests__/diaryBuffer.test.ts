import {
  cleanBufferMinutes, lessonBuffer, findTightTurnarounds, describeTightTurnaround, travelStripBefore, freeSlotBefore, MAX_BUFFER_MINUTES,
} from '../diary/buffer';

const L = (id: string, startMin: number, endMin: number, buffer: number) => ({ id, startMin, endMin, buffer });

describe('cleanBufferMinutes', () => {
  it('keeps whole minutes in range and treats the unusable as none', () => {
    expect(cleanBufferMinutes(15)).toBe(15);
    expect(cleanBufferMinutes('20')).toBe(20);
    expect(cleanBufferMinutes(7.6)).toBe(8);
    expect(cleanBufferMinutes(-5)).toBe(0);
    expect(cleanBufferMinutes('abc')).toBe(0);
    expect(cleanBufferMinutes(null)).toBe(0);
    expect(cleanBufferMinutes(undefined)).toBe(0);
    expect(cleanBufferMinutes(9999)).toBe(MAX_BUFFER_MINUTES);
  });
});

describe('lessonBuffer', () => {
  it('uses the lesson’s travel minutes, and none for a cancelled lesson', () => {
    expect(lessonBuffer({ travel_minutes: 20, status: 'Scheduled' })).toBe(20);
    expect(lessonBuffer({ travel_minutes: 20, status: 'Cancelled' })).toBe(0);
    expect(lessonBuffer({ status: 'Scheduled' })).toBe(0);
  });
});

describe('findTightTurnarounds', () => {
  // A lesson 10:00-11:00 (no travel of its own); the lesson being placed carries the travel to reach it.
  const before = L('a', 600, 660, 0);

  it('flags a lesson that starts sooner after the previous one than its own travel time', () => {
    const t = findTightTurnarounds(L('new', 665, 725, 15), [before]);
    expect(t).toEqual([{ otherId: 'a', otherIsBefore: true, gapMinutes: 5, neededMinutes: 15 }]);
  });

  it('is fine when the gap is at least the travel time', () => {
    expect(findTightTurnarounds(L('new', 675, 735, 15), [before])).toEqual([]);
    expect(findTightTurnarounds(L('new', 700, 760, 15), [before])).toEqual([]);
  });

  it('flags a later lesson whose own travel time does not fit after the new lesson', () => {
    const later = L('b', 730, 790, 25);
    const t = findTightTurnarounds(L('new', 660, 720, 20), [later]);
    expect(t).toEqual([{ otherId: 'b', otherIsBefore: false, gapMinutes: 10, neededMinutes: 25 }]);
  });

  it('the new lesson own travel time is not charged against a lesson after it', () => {
    // It is the later lesson that has to travel, so the new lesson's 20 minutes means nothing here.
    expect(findTightTurnarounds(L('new', 660, 720, 20), [L('b', 730, 790, 0)])).toEqual([]);
  });

  it('back to back is tight only when there is travel to allow for', () => {
    expect(findTightTurnarounds(L('new', 660, 720, 15), [before])).toHaveLength(1);
    expect(findTightTurnarounds(L('new', 660, 720, 0), [before])).toEqual([]);
  });

  it('leaves real overlaps to the clash check, and ignores the lesson itself', () => {
    expect(findTightTurnarounds(L('new', 630, 690, 15), [before])).toEqual([]);
    expect(findTightTurnarounds(L('a', 665, 725, 15), [before])).toEqual([]);
  });
});

describe('travelStripBefore (drawn between lessons)', () => {
  it('fills the gap just before the lesson', () => {
    // Previous lesson ends 13:00 (780), this one starts 14:30 (870), 41 minutes of travel: 13:49 to 14:30.
    expect(travelStripBefore(780, 870, 41)).toEqual({ fromMin: 829, minutes: 41 });
  });

  it('is cut to the time between the lessons when the travel is longer', () => {
    expect(travelStripBefore(780, 800, 41)).toEqual({ fromMin: 780, minutes: 20 });
  });

  it('is not drawn for the first lesson of the day, with no travel, or with no gap', () => {
    expect(travelStripBefore(null, 540, 30)).toBeNull();
    expect(travelStripBefore(780, 870, 0)).toBeNull();
    expect(travelStripBefore(780, 780, 15)).toBeNull();
    expect(travelStripBefore(800, 780, 15)).toBeNull();
  });
});

describe('freeSlotBefore', () => {
  it('runs from the end of the earlier lesson to where the travel to the later one begins', () => {
    // 13:00 to 14:30 with 41 min travel leaves 13:00 to 13:49: 49 minutes, under an hour, so no slot offered.
    expect(freeSlotBefore(780, 870, 41)).toBeNull();
    // With 15 minutes of travel: 13:00 to 14:15, an hour and a quarter.
    expect(freeSlotBefore(780, 870, 15)).toEqual({ fromMin: 780, toMin: 855 });
  });

  it('needs at least the minimum free time', () => {
    expect(freeSlotBefore(780, 840, 0)).toEqual({ fromMin: 780, toMin: 840 });
    expect(freeSlotBefore(780, 839, 0)).toBeNull();
    expect(freeSlotBefore(780, 840, 0, 30)).not.toBeNull();
  });
});

describe('describeTightTurnaround', () => {
  it('reads naturally for an earlier and a later lesson', () => {
    expect(describeTightTurnaround({ otherId: 'a', otherIsBefore: true, gapMinutes: 5, neededMinutes: 15 }, 'Jane'))
      .toBe("Jane's lesson ends 5 mins before this one, but you allow 15 mins to travel.");
    expect(describeTightTurnaround({ otherId: 'b', otherIsBefore: false, gapMinutes: 0, neededMinutes: 1 }, 'Sam'))
      .toBe("This lesson ends right before Sam's, but you allow 1 min to travel.");
    expect(describeTightTurnaround({ otherId: 'b', otherIsBefore: false, gapMinutes: 10, neededMinutes: 20 }, ''))
      .toBe("This lesson ends 10 mins before another's, but you allow 20 mins to travel.");
  });
});
