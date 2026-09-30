import { supabase, AUTH_LOCK_ACQUIRE_TIMEOUT_MS } from '../supabaseClient';

describe('supabase client auth lock', () => {
  it('has a finite lock acquire timeout so a stuck session lock cannot hang every request', () => {
    expect(AUTH_LOCK_ACQUIRE_TIMEOUT_MS).toBeGreaterThan(0);
    expect((supabase.auth as any).lockAcquireTimeout).toBe(AUTH_LOCK_ACQUIRE_TIMEOUT_MS);
  });
});
