import { referralItemLabel, referralSubtitle, referralUnlockNote } from '../referralText';

const summary = (o: Partial<{ pending: number; rewarded_this_year: number; capped: number; cap_per_year: number }>) =>
  ({ pending: 0, rewarded_this_year: 0, capped: 0, cap_per_year: 2, ...o });

describe('referralSubtitle', () => {
  it('invites sharing, naming the month wait and the limit, before anything has happened', () => {
    for (const s of [summary({}), null]) {
      expect(referralSubtitle(s)).toMatch(/subscribed for a month/);
      expect(referralSubtitle(s)).toMatch(/up to 2 a year/);
    }
  });

  it('shows progress towards the limit', () => {
    expect(referralSubtitle(summary({ pending: 1, rewarded_this_year: 1 }))).toBe('1 pending · 1 of 2 free months earned this year');
  });

  it('says so once the limit is reached, even with referrals pending', () => {
    const text = referralSubtitle(summary({ pending: 1, rewarded_this_year: 2 }));
    expect(text).toMatch(/earned all 2 free months/);
    expect(text).toMatch(/won't earn you another/);
  });

  it('uses the limit the backend sends', () => {
    expect(referralSubtitle(summary({ cap_per_year: 3, rewarded_this_year: 1 }))).toMatch(/1 of 3/);
  });
});

describe('referralItemLabel', () => {
  it('describes each stage', () => {
    expect(referralItemLabel({ name: 'A', stage: 'signed_up', date: '2026-10-01T09:00:00Z' })).toBe('Signed up 01-10-2026 · not subscribed yet');
    expect(referralItemLabel({ name: 'A', stage: 'subscribed', date: '2026-11-13T00:00:00Z' })).toBe('Subscribed · your free month is released on 13-11-2026');
    expect(referralItemLabel({ name: 'A', stage: 'rewarded', date: '2026-11-13T00:00:00Z' })).toBe('Free month earned 13-11-2026');
    expect(referralItemLabel({ name: 'A', stage: 'capped' })).toMatch(/yearly limit/);
  });

  it('copes with a missing date', () => {
    expect(referralItemLabel({ name: 'A', stage: 'signed_up' })).toBe('Signed up · not subscribed yet');
    expect(referralItemLabel({ name: 'A', stage: 'rewarded', date: null })).toBe('Free month earned');
  });
});

describe('referralUnlockNote', () => {
  it('says when referring opens, while it is still locked', () => {
    expect(referralUnlockNote({ eligible: false, eligible_from: '2026-11-14T12:00:00Z' })).toBe(
      "Referrals unlock on 14-11-2026, once you've been subscribed for a month.",
    );
  });

  it('shows nothing once unlocked, or when there is no paid plan to count from', () => {
    expect(referralUnlockNote({ eligible: true, eligible_from: '2026-09-14T12:00:00Z' })).toBeNull();
    expect(referralUnlockNote({ eligible: false, eligible_from: null })).toBeNull();
    expect(referralUnlockNote(null)).toBeNull();
  });
});
