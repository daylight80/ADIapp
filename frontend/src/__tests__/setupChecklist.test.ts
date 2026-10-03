import {
  stepIdsForTier, buildChecklist, checklistProgress, nextStep,
  withinNewAccountWindow, shouldShowChecklist, NEW_ACCOUNT_DAYS,
  type ChecklistSignals,
} from '../setupChecklist';

const NOW = new Date('2026-09-28T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const EMPTY: ChecklistSignals = {
  adiNumber: null, mobileNumber: null, numberPlate: null,
  studentCount: 0, hasLesson: false, anyStudentOnApp: false, deadlineCount: 0, hasLogo: false,
};
const ALL_DONE: ChecklistSignals = {
  adiNumber: '123456', mobileNumber: '07700900123', numberPlate: 'AB12 CDE',
  studentCount: 3, hasLesson: true, anyStudentOnApp: true, deadlineCount: 2, hasLogo: true,
};

describe('stepIdsForTier: which steps each plan sees', () => {
  it('Starter sees the four core steps and nothing paid', () => {
    expect(stepIdsForTier('starter')).toEqual(['details', 'first_student', 'first_lesson', 'invite_student']);
  });

  it('ADI Pro adds the deadline and the branding steps', () => {
    expect(stepIdsForTier('pro')).toEqual([
      'details', 'first_student', 'first_lesson', 'invite_student', 'deadline', 'branding',
    ]);
  });

  it('Franchise is not asked for My Details (it cannot edit them) or branding, but does get deadlines', () => {
    const ids = stepIdsForTier('franchise');
    expect(ids).not.toContain('details');
    expect(ids).not.toContain('branding');
    expect(ids).toEqual(['first_student', 'first_lesson', 'invite_student', 'deadline']);
  });

  it('an unknown, missing or legacy plan is treated like Starter', () => {
    for (const t of [undefined, null, '', 'growth', 'nonsense']) {
      expect(stepIdsForTier(t as any)).toEqual(['details', 'first_student', 'first_lesson', 'invite_student']);
    }
  });
});

describe('buildChecklist: each step ticks from real data', () => {
  const done = (signals: Partial<ChecklistSignals>, id: string, tier = 'pro') =>
    buildChecklist({ ...EMPTY, ...signals }, tier).find((s) => s.id === id)!.done;

  it('starts with nothing done for a brand-new account', () => {
    expect(buildChecklist(EMPTY, 'pro').every((s) => !s.done)).toBe(true);
  });

  it('details needs ADI number and mobile (vehicles are added on the Vehicles screen)', () => {
    expect(done({ adiNumber: '1', mobileNumber: '2', numberPlate: '3' }, 'details')).toBe(true);
    expect(done({ adiNumber: '1', mobileNumber: '2', numberPlate: null }, 'details')).toBe(true);
    expect(done({ adiNumber: '1', mobileNumber: '  ', numberPlate: '3' }, 'details')).toBe(false);
    expect(done({ adiNumber: '', mobileNumber: '2', numberPlate: '3' }, 'details')).toBe(false);
  });

  it('first student ticks at one student', () => {
    expect(done({ studentCount: 0 }, 'first_student')).toBe(false);
    expect(done({ studentCount: 1 }, 'first_student')).toBe(true);
  });

  it('first lesson, invite, deadline and logo each follow their own signal only', () => {
    expect(done({ hasLesson: true }, 'first_lesson')).toBe(true);
    expect(done({ hasLesson: true }, 'invite_student')).toBe(false);
    expect(done({ anyStudentOnApp: true }, 'invite_student')).toBe(true);
    expect(done({ deadlineCount: 1 }, 'deadline')).toBe(true);
    expect(done({ deadlineCount: 0 }, 'deadline')).toBe(false);
    expect(done({ hasLogo: true }, 'branding')).toBe(true);
    expect(done({ studentCount: 5 }, 'branding')).toBe(false);
  });

  it('gives every step a title, a hint and a route', () => {
    for (const s of buildChecklist(EMPTY, 'pro')) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.hint.length).toBeGreaterThan(0);
      expect(s.route.startsWith('/')).toBe(true);
    }
  });

  it('sends each step to a screen that exists in this app', () => {
    const routes = Object.fromEntries(buildChecklist(EMPTY, 'pro').map((s) => [s.id, s.route]));
    expect(routes).toEqual({
      details: '/profile-screen',
      first_student: '/student-crm-screen',
      first_lesson: '/lesson-diary-screen',
      invite_student: '/student-crm-screen',
      deadline: '/deadlines-screen',
      branding: '/school-profile-screen',
    });
  });
});

describe('checklistProgress / nextStep', () => {
  it('counts done and total, and reports completion', () => {
    const partial = buildChecklist({ ...EMPTY, studentCount: 1, hasLesson: true }, 'starter');
    expect(checklistProgress(partial)).toEqual({ done: 2, total: 4, complete: false });
    expect(checklistProgress(buildChecklist(ALL_DONE, 'pro'))).toEqual({ done: 6, total: 6, complete: true });
  });

  it('an empty list is never "complete"', () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, complete: false });
  });

  it('nextStep is the first one left, in display order, even if later ones are done', () => {
    const steps = buildChecklist({ ...EMPTY, hasLesson: true }, 'starter'); // lesson done, student not
    expect(nextStep(steps)?.id).toBe('details');
    const skipped = buildChecklist({ ...ALL_DONE, studentCount: 0 }, 'starter');
    expect(nextStep(skipped)?.id).toBe('first_student');
  });

  it('nextStep is undefined once everything is done', () => {
    expect(nextStep(buildChecklist(ALL_DONE, 'pro'))).toBeUndefined();
  });
});

describe('withinNewAccountWindow', () => {
  it('is on for a new account and off for an old one', () => {
    expect(withinNewAccountWindow(daysAgo(0), NOW)).toBe(true);
    expect(withinNewAccountWindow(daysAgo(10), NOW)).toBe(true);
    expect(withinNewAccountWindow(daysAgo(200), NOW)).toBe(false);
  });

  it('includes exactly 30 days and excludes 31', () => {
    expect(NEW_ACCOUNT_DAYS).toBe(30);
    expect(withinNewAccountWindow(daysAgo(30), NOW)).toBe(true);
    expect(withinNewAccountWindow(daysAgo(31), NOW)).toBe(false);
  });

  it('treats a missing or unreadable date as NOT new, so established users are never nagged', () => {
    for (const bad of [null, undefined, '', 'garbage']) {
      expect(withinNewAccountWindow(bad as any, NOW)).toBe(false);
    }
  });

  it('rejects a date in the future (clock skew or bad data)', () => {
    expect(withinNewAccountWindow(daysAgo(-3), NOW)).toBe(false);
  });

  it('honours a custom window', () => {
    expect(withinNewAccountWindow(daysAgo(5), NOW, 7)).toBe(true);
    expect(withinNewAccountWindow(daysAgo(8), NOW, 7)).toBe(false);
  });
});

describe('shouldShowChecklist', () => {
  const steps = buildChecklist(EMPTY, 'pro');
  const base = { steps, createdAt: daysAgo(3), dismissed: false, now: NOW };

  it('shows for a new account with steps left', () => {
    expect(shouldShowChecklist(base)).toBe(true);
  });

  it('hides once dismissed', () => {
    expect(shouldShowChecklist({ ...base, dismissed: true })).toBe(false);
  });

  it('hides for an established account, however incomplete', () => {
    expect(shouldShowChecklist({ ...base, createdAt: daysAgo(90) })).toBe(false);
  });

  it('hides when everything is done', () => {
    expect(shouldShowChecklist({ ...base, steps: buildChecklist(ALL_DONE, 'pro') })).toBe(false);
  });

  it('hides when there are no steps at all', () => {
    expect(shouldShowChecklist({ ...base, steps: [] })).toBe(false);
  });

  it('hides when the creation date is unknown', () => {
    expect(shouldShowChecklist({ ...base, createdAt: null })).toBe(false);
  });
});
