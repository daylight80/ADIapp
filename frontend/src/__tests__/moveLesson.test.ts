import { checkMove, endTimeFor, fromMinutes, toMinutes, type MoveInput } from '../diary/moveLesson';

const NOW = new Date('2026-10-30T12:00:00');
const base: MoveInput = {
  lessonId: 'l1', from: { date: '2026-11-01', startTime: '09:00' }, date: '2026-11-02', startTime: '10:00',
  durationMinutes: 120, travelMinutes: 30, dayLessons: [], blocks: [], now: NOW,
};
const other = (over: object = {}) => ({ id: 'l2', startMin: toMinutes('13:00'), endMin: toMinutes('15:00'), status: 'Scheduled', travel_minutes: 15, studentName: 'Jane Smith', ...over });

describe('endTimeFor: the lesson keeps its length', () => {
  it('adds the length to the start', () => {
    expect(endTimeFor('09:00', 120)).toBe('11:00');
    expect(endTimeFor('16:15', 90)).toBe('17:45');
  });
  it('gives nothing when it would pass midnight, or the time is not a time', () => {
    expect(endTimeFor('23:00', 120)).toBe('');
    expect(endTimeFor('22:00', 120)).toBe('');
    expect(endTimeFor('', 60)).toBe('');
    expect(endTimeFor('25:00', 60)).toBe('');
  });
  it('minutes and times convert back and forth', () => {
    expect(fromMinutes(toMinutes('07:05'))).toBe('07:05');
  });
});

describe('checkMove: a clear move', () => {
  it('has no blockers and no warnings, and says what the new end is', () => {
    expect(checkMove(base)).toEqual({ endTime: '12:00', changed: true, blockers: [], warnings: [] });
  });
  it('lets a lesson move to a different day or only to a different time', () => {
    expect(checkMove({ ...base, date: '2026-11-01', startTime: '09:30' }).blockers).toEqual([]);
    expect(checkMove({ ...base, date: '2026-11-05', startTime: '09:00' }).blockers).toEqual([]);
  });
});

describe('checkMove: what stops it', () => {
  it('says nothing changed when the date and time are the same', () => {
    const r = checkMove({ ...base, date: '2026-11-01', startTime: '09:00' });
    expect(r.changed).toBe(false);
    expect(r.blockers).toEqual(['That is the date and time it already has.']);
  });
  it('needs a real date and a real time', () => {
    expect(checkMove({ ...base, date: '' }).blockers).toEqual(['Choose a date.']);
    expect(checkMove({ ...base, date: '2026-13-45' }).blockers).toEqual(['Choose a date.']);
    expect(checkMove({ ...base, startTime: '' }).blockers).toEqual(['Choose a start time.']);
  });
  it('will not run past midnight', () => {
    expect(checkMove({ ...base, startTime: '23:00' }).blockers[0]).toMatch(/past midnight/);
  });
  it('is stopped by a clash, naming the pupil and the time', () => {
    const r = checkMove({ ...base, startTime: '12:00', dayLessons: [other()] });
    expect(r.blockers).toEqual(['Jane Smith already has a lesson from 13:00 to 15:00.']);
  });
  it('is stopped by a lesson it only partly overlaps, at either end', () => {
    expect(checkMove({ ...base, startTime: '14:00', dayLessons: [other()] }).blockers).toHaveLength(1); // starts inside
    expect(checkMove({ ...base, startTime: '12:30', dayLessons: [other()] }).blockers).toHaveLength(1); // ends inside
    expect(checkMove({ ...base, startTime: '11:00', dayLessons: [other()] }).blockers).toHaveLength(0); // ends exactly as it starts
  });
  it('ignores its own old slot, and cancelled lessons', () => {
    expect(checkMove({ ...base, date: '2026-11-01', startTime: '09:30', dayLessons: [other({ id: 'l1', startMin: toMinutes('09:00'), endMin: toMinutes('11:00') })] }).blockers).toEqual([]);
    expect(checkMove({ ...base, startTime: '12:30', dayLessons: [other({ status: 'Cancelled' })] }).blockers).toEqual([]);
  });
  it('is stopped by time marked as unavailable', () => {
    const blocks = [{ starts_at: new Date('2026-11-02T09:00:00').toISOString(), ends_at: new Date('2026-11-02T10:30:00').toISOString() }];
    expect(checkMove({ ...base, blocks }).blockers[0]).toMatch(/unavailable/);
    expect(checkMove({ ...base, startTime: '10:30', blocks }).blockers).toEqual([]); // starts as the block ends
  });
  it('lists the blockers and no warnings together', () => {
    const r = checkMove({ ...base, date: '2026-10-01', startTime: '12:00', dayLessons: [other()] });
    expect(r.blockers).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });
});

describe('checkMove: what only warns', () => {
  it('warns when the time has already passed', () => {
    const r = checkMove({ ...base, date: '2026-10-29', startTime: '10:00' });
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual(['That time has already passed.']);
  });
  it('warns about too little travel time after an earlier lesson', () => {
    const earlier = other({ startMin: toMinutes('08:00'), endMin: toMinutes('10:10'), studentName: 'Ben Carter' });
    const r = checkMove({ ...base, dayLessons: [earlier] }); // starts 10:00... clash
    expect(r.blockers).toHaveLength(1);
    const r2 = checkMove({ ...base, startTime: '10:20', dayLessons: [earlier] }); // 10 min gap, needs 30
    expect(r2.blockers).toEqual([]);
    expect(r2.warnings).toEqual(["Ben Carter's lesson ends 10 mins before this one, but you allow 30 mins to travel."]);
  });
  it('warns when it leaves too little travel time before the next lesson', () => {
    const later = other({ startMin: toMinutes('12:05'), endMin: toMinutes('14:00'), travel_minutes: 20 });
    const r = checkMove({ ...base, startTime: '10:00', dayLessons: [later] }); // ends 12:00, 5 min gap, later needs 20
    expect(r.blockers).toEqual([]);
    expect(r.warnings[0]).toMatch(/This lesson ends 5 mins before Jane Smith's/);
  });
});
