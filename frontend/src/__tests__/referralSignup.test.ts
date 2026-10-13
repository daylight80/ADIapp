// A new signup's referral code must be resolved through the resolve_referral_code RPC.
// A direct select on instructors returns nothing for a brand-new user (row-level
// security), which silently dropped every referral.
const mockInsertedSchools: any[] = [];
const mockRpc = jest.fn();

function mockQuery(result: any) {
  const q: any = {
    select: () => q, eq: () => q, maybeSingle: async () => ({ data: result }),
    insert: (row: any) => { mockInsertedSchools.push(row); return { select: () => ({ single: async () => ({ data: { id: 'school-1' }, error: null }) }), then: undefined }; },
  };
  return q;
}

jest.mock('../supabaseClient', () => ({
  supabase: {
    rpc: (...a: any[]) => mockRpc(...a),
    from: (table: string) => {
      if (table === 'driving_schools') return mockQuery(null);
      if (table === 'instructors') {
        const q: any = mockQuery(null);
        const baseInsert = q.insert;
        q.insert = async (row: any) => { baseInsert(row); return { error: null }; };
        return q;
      }
      return mockQuery(null);
    },
  },
}));

import { ensureInstructorBootstrap } from '../AuthContext';

const args = { authUserId: 'u1', email: 'a@b.co', name: 'Sam Jones', adi_number: '123456' };

beforeEach(() => { mockInsertedSchools.length = 0; mockRpc.mockReset(); });

describe('referral code at signup', () => {
  it('records the referrer on the new school when the code resolves', async () => {
    mockRpc.mockResolvedValue({ data: 'referrer-id', error: null });
    await ensureInstructorBootstrap({ ...args, referralCode: 'pg53n9' });
    expect(mockRpc).toHaveBeenCalledWith('resolve_referral_code', { p_code: 'pg53n9' });
    expect(mockInsertedSchools[0]).toMatchObject({ referred_by_instructor_id: 'referrer-id', referral_reward_status: 'pending' });
  });

  it('still creates the school when the code is unknown', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await ensureInstructorBootstrap({ ...args, referralCode: 'ZZZZZZ' });
    expect(mockInsertedSchools[0]).not.toHaveProperty('referred_by_instructor_id');
  });

  it('does not look anything up when no code was entered', async () => {
    await ensureInstructorBootstrap(args);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
