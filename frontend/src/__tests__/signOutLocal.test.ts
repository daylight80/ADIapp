import { signOutThisDevice } from '../signOutLocal';

describe('signOutThisDevice', () => {
  it('signs out with local scope, so the account stays signed in on other devices', async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null });
    await signOutThisDevice({ auth: { signOut } });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('never uses the global default (no argument) or the global scope', async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null });
    await signOutThisDevice({ auth: { signOut } });
    const arg = signOut.mock.calls[0][0];
    expect(arg).toBeDefined();
    expect(arg.scope).not.toBe('global');
  });
});

describe('the app signs out through it', () => {
  it('has no direct auth.signOut() call in AuthContext, which would default to every device', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const src: string = fs.readFileSync(path.join(__dirname, '..', 'AuthContext.tsx'), 'utf8');
    expect(src).toMatch(/signOutThisDevice\(supabase\)/);
    expect(src).not.toMatch(/supabase\.auth\.signOut\(/);
  });
});
