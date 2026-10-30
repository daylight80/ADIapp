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
