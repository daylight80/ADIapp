let mockResult: any = { data: [], error: null };
let mockThrow = false;
const mockCalls: Record<string, any[]> = {};
jest.mock('../supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (mockThrow) throw new Error('offline');
      const c: any = {};
      for (const m of ['select', 'eq', 'neq', 'not', 'limit']) c[m] = (...a: any[]) => { (mockCalls[m] ||= []).push([table, ...a]); return m === 'limit' ? Promise.resolve(mockResult) : c; };
      return c;
    },
  },
}));

import { pupilHasConfirmedPrecheck } from '../precheckMemory';

beforeEach(() => { mockResult = { data: [], error: null }; mockThrow = false; Object.keys(mockCalls).forEach((k) => delete mockCalls[k]); });

describe('pupilHasConfirmedPrecheck', () => {
  it('is true when an earlier lesson of this pupil has a confirmed pre-check, and asks only about that', async () => {
    mockResult = { data: [{ id: 'l1' }], error: null };
    expect(await pupilHasConfirmedPrecheck('st1', 'l2')).toBe(true);
    expect(mockCalls.eq[0]).toEqual(['lessons', 'student_id', 'st1']);
    expect(mockCalls.neq[0]).toEqual(['lessons', 'id', 'l2']);
    expect(mockCalls.not[0]).toEqual(['lessons', 'pre_check_completed_at', 'is', null]);
  });

  it('is false at a first lesson', async () => {
    expect(await pupilHasConfirmedPrecheck('st1', 'l1')).toBe(false);
  });

  it('is false, not an error, when the lookup fails', async () => {
    mockResult = { data: null, error: { message: 'boom' } };
    expect(await pupilHasConfirmedPrecheck('st1', 'l2')).toBe(false);
    mockThrow = true;
    expect(await pupilHasConfirmedPrecheck('st1', 'l2')).toBe(false);
  });
});
