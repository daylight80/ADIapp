import {
  stageOf, daysInStage, stageCounts, nextStage, stageSummary, isWaitlisted, WAITLIST_STAGES, WAITING_NUDGE_DAYS,
} from '../waitlistPipeline';
import { buildActionItems, GROUP_TITLES } from '../actionCentre';

const NOW = new Date(2026, 9, 22, 12, 0);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const pupil = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Pupil ${id}`, status: 'Waitlist', ...extra });

describe('stages', () => {
  it('only waitlisted pupils have a stage; a waitlisted pupil with none yet counts as Waiting', () => {
    expect(stageOf({ status: 'Active', waitlist_stage: 'Booked' })).toBeNull();
    expect(stageOf({ status: 'Waitlist' })).toBe('Waiting');
    expect(stageOf({ status: 'Waitlist', waitlist_stage: 'Contacted' })).toBe('Contacted');
    expect(stageOf({ status: 'Waitlist', waitlist_stage: 'nonsense' })).toBe('Waiting');
    expect(isWaitlisted({ status: 'Waitlist' })).toBe(true);
    expect(WAITLIST_STAGES).toEqual(['Waiting', 'Contacted', 'Booked']);
  });

  it('counts pupils at each stage and ignores everyone else', () => {
    expect(stageCounts([
      pupil('a'), pupil('b', { waitlist_stage: 'Contacted' }), pupil('c', { waitlist_stage: 'Contacted' }),
      { status: 'Active' }, pupil('d', { waitlist_stage: 'Booked' }),
    ])).toEqual({ Waiting: 1, Contacted: 2, Booked: 1 });
  });

  it('moves Waiting -> Contacted -> Booked and stops', () => {
    expect(nextStage('Waiting')).toBe('Contacted');
    expect(nextStage('Contacted')).toBe('Booked');
    expect(nextStage('Booked')).toBeNull();
    expect(nextStage(null)).toBeNull();
  });

  it('says how long they have been at their stage', () => {
    expect(daysInStage({ waitlist_stage_at: daysAgo(9) }, NOW)).toBe(9);
    expect(daysInStage({ waitlist_stage_at: null }, NOW)).toBeNull();
    expect(daysInStage({ waitlist_stage_at: 'garbage' }, NOW)).toBeNull();
    expect(stageSummary(pupil('a', { waitlist_stage: 'Waiting', waitlist_stage_at: daysAgo(9) }), NOW)).toBe('Waiting 9 days');
    expect(stageSummary(pupil('a', { waitlist_stage: 'Contacted', waitlist_stage_at: daysAgo(0) }), NOW)).toBe('Contacted today');
    expect(stageSummary(pupil('a', { waitlist_stage: 'Contacted', waitlist_stage_at: daysAgo(1) }), NOW)).toBe('Contacted 1 day');
    expect(stageSummary({ status: 'Active' }, NOW)).toBe('');
  });
});

describe('Action Centre nudges', () => {
  const run = (students: ReturnType<typeof pupil>[], lessons: any[] = []) =>
    buildActionItems({ now: NOW, students, lessons, hoursBalances: {}, deadlines: [] }).filter((i) => i.group === 'waiting_list');

  it('flags a pupil left in Waiting for a week, not before', () => {
    expect(WAITING_NUDGE_DAYS).toBe(7);
    const items = run([
      pupil('old', { waitlist_stage: 'Waiting', waitlist_stage_at: daysAgo(9) }),
      pupil('new', { waitlist_stage: 'Waiting', waitlist_stage_at: daysAgo(6) }),
      pupil('contacted', { waitlist_stage: 'Contacted', waitlist_stage_at: daysAgo(30) }),
    ]);
    expect(items.map((i) => i.key)).toEqual(['waiting-old']);
    expect(items[0].title).toBe('Pupil old: waiting 9 days');
    expect(items[0].target).toEqual({ screen: 'student', studentId: 'old' });
  });

  it('flags Booked with no lesson in the diary, but not once a lesson is booked', () => {
    const booked = pupil('b', { waitlist_stage: 'Booked', waitlist_stage_at: daysAgo(2) });
    expect(run([booked]).map((i) => i.key)).toEqual(['waitbooked-b']);
    const lesson = { id: 'l1', student_id: 'b', date: '2026-10-25', start_time: '10:00', end_time: '11:00', status: 'Scheduled' };
    expect(run([booked], [lesson])).toEqual([]);
    expect(run([booked], [{ ...lesson, status: 'Cancelled' }]).map((i) => i.key)).toEqual(['waitbooked-b']);
  });

  it('has its own group title and ignores pupils who are not waitlisted', () => {
    expect(GROUP_TITLES.waiting_list).toBe('Waiting list');
    expect(run([{ id: 'x', name: 'X', status: 'Active', waitlist_stage: 'Waiting', waitlist_stage_at: daysAgo(40) } as any])).toEqual([]);
  });
});
