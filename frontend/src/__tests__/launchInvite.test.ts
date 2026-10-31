import { inviteFromSearch } from '../launchInvite';

describe('inviteFromSearch', () => {
  it('finds the invite token in the page address', () => {
    expect(inviteFromSearch('?invite=eyJhIjoxfQ==')).toBe('eyJhIjoxfQ==');
  });

  it('finds it beside other parameters', () => {
    expect(inviteFromSearch('?ref=ABC&invite=tok')).toBe('tok');
  });

  it('is empty when there is no invite', () => {
    expect(inviteFromSearch('')).toBe('');
    expect(inviteFromSearch('?ref=ABC')).toBe('');
  });
});

import { authKindFromHash } from '../launchInvite';

describe('authKindFromHash', () => {
  it('knows a forgotten-password link', () => {
    expect(authKindFromHash('#access_token=a&refresh_token=b&type=recovery')).toBe('recovery');
  });

  it('knows an invite link', () => {
    expect(authKindFromHash('#access_token=a&type=invite')).toBe('invite');
  });

  it('ignores other kinds and an empty address', () => {
    expect(authKindFromHash('#access_token=a&type=magiclink')).toBe('');
    expect(authKindFromHash('')).toBe('');
  });
});
