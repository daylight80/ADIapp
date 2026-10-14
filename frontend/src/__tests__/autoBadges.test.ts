// "First Gear" (first completed lesson) and "Mock Marvel" (passed mock test) are awarded
// automatically, for paid plans only, once, and never get in the way of the save that triggers them.
const mockTier = { value: 'pro' as string | null, signedIn: true };
const mockAward = jest.fn();
const mockUpdateLesson = jest.fn();

jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: mockTier.signedIn ? { user: { id: 'u1' } } : null } }) },
    from: () => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: mockTier.value ? { driving_schools: { tier: mockTier.value } } : null }) };
      return q;
    },
  },
}));
jest.mock('../supabaseDb', () => ({
  awardBadgeIfMissing: (...a: unknown[]) => mockAward(...a),
  updateLesson: (...a: unknown[]) => mockUpdateLesson(...a),
  maybeAwardCompetencyBadge: jest.fn(),
}));

import { patchLesson, awardFirstLessonBadge, awardMockPassBadge, instructorHasPaidTier } from '../useSupabaseData';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockAward.mockReset().mockResolvedValue({});
  mockUpdateLesson.mockReset().mockResolvedValue({ id: 'l1', student_id: 'stu1' });
  mockTier.value = 'pro';
  mockTier.signedIn = true;
});

describe('paid-plan check', () => {
  it.each([['pro', true], ['franchise', true], ['starter', false], [null, false]])('%s -> %s', async (tier, expected) => {
    mockTier.value = tier as string | null;
    expect(await instructorHasPaidTier()).toBe(expected);
  });
  it('is false when nobody is signed in', async () => {
    mockTier.signedIn = false;
    expect(await instructorHasPaidTier()).toBe(false);
  });
});

describe('First Gear', () => {
  it('is awarded when a lesson is marked Completed', async () => {
    await patchLesson('l1', { status: 'Completed' });
    await flush();
    expect(mockAward).toHaveBeenCalledWith({
      student_id: 'stu1', badge_key: 'first_lesson', badge_name: 'First Gear', description: 'Completed your first lesson',
    });
  });

  it.each(['Scheduled', 'Cancelled'] as const)('is not awarded for a lesson set to %s', async (status) => {
    await patchLesson('l1', { status });
    await flush();
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('is not awarded when the edit is something else, like a note', async () => {
    await patchLesson('l1', { notes: 'good lesson' });
    await flush();
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('is not awarded on a Starter plan', async () => {
    mockTier.value = 'starter';
    await patchLesson('l1', { status: 'Completed' });
    await flush();
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('never stops the lesson save, even if awarding fails', async () => {
    mockAward.mockRejectedValue(new Error('boom'));
    await expect(patchLesson('l1', { status: 'Completed' })).resolves.toMatchObject({ id: 'l1' });
    await flush();
  });

  it('needs a pupil to award it to', async () => {
    await awardFirstLessonBadge('');
    expect(mockAward).not.toHaveBeenCalled();
  });
});

describe('Mock Marvel', () => {
  it('is awarded for a passed mock test', async () => {
    await awardMockPassBadge('stu1');
    expect(mockAward).toHaveBeenCalledWith({
      student_id: 'stu1', badge_key: 'mock_passed', badge_name: 'Mock Marvel', description: 'Passed a DL25 mock test',
    });
  });

  it('is not awarded on a Starter plan, and never throws', async () => {
    mockTier.value = 'starter';
    await awardMockPassBadge('stu1');
    expect(mockAward).not.toHaveBeenCalled();
    mockTier.value = 'pro';
    mockAward.mockRejectedValue(new Error('boom'));
    await expect(awardMockPassBadge('stu1')).resolves.toBeUndefined();
  });
});
