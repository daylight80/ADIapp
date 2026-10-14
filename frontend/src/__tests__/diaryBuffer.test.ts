import {
  cleanBufferMinutes, lessonBuffer, findTightTurnarounds, describeTightTurnaround, MAX_BUFFER_MINUTES,
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
  // A lesson 10:00-11:00 with a 15 minute buffer.
  const before = L('a', 600, 660, 15);

  it('flags a lesson that starts inside the previous lesson’s buffer', () => {
    const t = findTightTurnarounds(L('new', 665, 725, 15), [before]);
    expect(t).toEqual([{ otherId: 'a', otherIsBefore: true, gapMinutes: 5, neededMinutes: 15 }]);
  });

  it('is fine when the gap is at least the buffer', () => {
    expect(findTightTurnarounds(L('new', 675, 735, 15), [before])).toEqual([]);
    expect(findTightTurnarounds(L('new', 700, 760, 15), [before])).toEqual([]);
  });

  it('flags the new lesson’s own buffer running into a later lesson', () => {
    const later = L('b', 730, 790, 15);
    const t = findTightTurnarounds(L('new', 660, 720, 20), [later]);
    expect(t).toEqual([{ otherId: 'b', otherIsBefore: false, gapMinutes: 10, neededMinutes: 20 }]);
  });

  it('back to back with a buffer is tight; with no buffer it is fine', () => {
    expect(findTightTurnarounds(L('new', 660, 720, 0), [before])).toHaveLength(1); // the earlier lesson still needs its 15
    expect(findTightTurnarounds(L('new', 660, 720, 0), [L('a', 600, 660, 0)])).toEqual([]);
  });

  it('leaves real overlaps to the clash check, and ignores the lesson itself', () => {
    expect(findTightTurnarounds(L('new', 630, 690, 15), [before])).toEqual([]);
    expect(findTightTurnarounds(L('a', 665, 725, 15), [before])).toEqual([]);
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
