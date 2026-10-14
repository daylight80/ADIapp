// A pupil's plan comes from the my_school_plan RPC. Pupils cannot read driving_schools,
// so reading it through the students query always gave 'starter' and the DVSA tracker
// showed "locked" for a Pro instructor's pupil.
const mockRpc = jest.fn();

function mockChain(row: any) {
  const q: any = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: row }) };
  return q;
}

jest.mock('../supabaseClient', () => ({
  supabase: {
    rpc: (...a: any[]) => mockRpc(...a),
    from: (table: string) => mockChain(table === 'students'
      ? { id: 'stu1', full_name: 'Test Pupil', school_id: 's1', instructor_id: 'i1' }
      : null),
  },
}));

import { loadProfile } from '../AuthContext';

const session: any = { user: { id: 'u1', email: 'pupil@x.co', user_metadata: {}, created_at: '2026-10-01' } };

beforeEach(() => mockRpc.mockReset());

describe('pupil plan', () => {
  it("is the instructor's school plan", async () => {
    mockRpc.mockResolvedValue({ data: { tier: 'pro', subscription_status: 'active' }, error: null });
    const u = await loadProfile(session);
    expect(mockRpc).toHaveBeenCalledWith('my_school_plan');
    expect(u.role).toBe('student');
    expect(u.tier).toBe('pro');
    expect(u.subscription_status).toBe('active');
  });

  it('falls back to starter when the plan cannot be read', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    const u = await loadProfile(session);
    expect(u.tier).toBe('starter');
    expect(u.subscription_status).toBe('free');
  });
});
