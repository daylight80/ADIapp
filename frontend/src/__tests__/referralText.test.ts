import { referralSubtitle } from '../referralText';

const summary = (o: Partial<{ pending: number; rewarded_this_year: number; capped: number; cap_per_year: number }>) =>
  ({ pending: 0, rewarded_this_year: 0, capped: 0, cap_per_year: 2, ...o });

describe('referralSubtitle', () => {
  it('invites sharing, naming the limit, before anything has happened', () => {
    expect(referralSubtitle(summary({}))).toMatch(/up to 2 free months a year/);
    expect(referralSubtitle(null)).toMatch(/up to 2 free months a year/);
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
