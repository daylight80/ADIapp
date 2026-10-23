import { buildDrivingProfile } from '../drivingProfile';

const comp = (name: string, level: number, over: Record<string, unknown> = {}) => ({ category_name: name, level, progress: level * 20, touched: true, ...over });
const lesson = (date: string, serious = 0, dangerous = 0, status = 'Completed') => ({ status, date, serious_faults: serious, dangerous_faults: dangerous });
const base = { competencies: [], lessons: [], focus: null, unmetCriteria: [] };

describe('buildDrivingProfile', () => {
  it('lists the weakest assessed topics first, at most three, and ignores unassessed or strong ones', () => {
    const p = buildDrivingProfile({
      ...base,
      competencies: [comp('Roundabouts', 2), comp('Parking', 1), comp('Junctions', 2, { progress: 10 }), comp('Moving off', 2, { progress: 90 }), comp('Hill starts', 1, { touched: false }), comp('Mirrors', 4)],
    });
    expect(p.issues).toEqual(['Parking (level 1 of 5)', 'Junctions (level 2 of 5)', 'Roundabouts (level 2 of 5)']);
  });

  it('focus is the goal from the last notes, else the weakest topic, else nothing', () => {
    expect(buildDrivingProfile({ ...base, focus: { goal: 'Practise the test route', practice: null } }).focus).toBe('Practise the test route');
    expect(buildDrivingProfile({ ...base, competencies: [comp('Parking', 1)] }).focus).toBe('Work on Parking');
    expect(buildDrivingProfile({ ...base, focus: { goal: null, practice: 'x' }, competencies: [comp('Parking', 1)] }).focus).toBe('Work on Parking');
    expect(buildDrivingProfile(base).focus).toBeNull();
  });

  it('flags serious or dangerous faults in each of the last three completed lessons only', () => {
    const three = [lesson('2026-10-01', 1), lesson('2026-10-08', 0, 1), lesson('2026-10-15', 2)];
    expect(buildDrivingProfile({ ...base, lessons: three }).issues).toEqual(['Serious or dangerous faults in each of the last 3 lessons']);
    // one clean lesson among the last three, or fewer than three lessons, is not a pattern
    expect(buildDrivingProfile({ ...base, lessons: [...three.slice(1), lesson('2026-10-20', 0, 0)] }).issues).toEqual([]);
    expect(buildDrivingProfile({ ...base, lessons: three.slice(0, 2) }).issues).toEqual([]);
  });

  it('only counts completed lessons, newest three', () => {
    const lessons = [lesson('2026-09-01', 0), lesson('2026-10-01', 1), lesson('2026-10-08', 1), lesson('2026-10-15', 1), lesson('2026-10-20', 3, 0, 'Cancelled')];
    expect(buildDrivingProfile({ ...base, lessons }).issues).toHaveLength(1);
  });

  it('passes through the last practice note and the criteria still to meet', () => {
    const p = buildDrivingProfile({ ...base, focus: { goal: null, practice: 'Mirror checks' }, unmetCriteria: ['Theory test passed'] });
    expect(p.practice).toBe('Mirror checks');
    expect(p.toMeet).toEqual(['Theory test passed']);
  });
});
