import { hasLowCredit, isHavingLessons, needsBooking } from '../studentGlance';

describe('which pupils the "needs action" tiles count', () => {
  it('counts New, Active and Test Ready pupils, and anyone with no status yet', () => {
    for (const status of ['New', 'Active', 'Test Ready', undefined, null]) expect(isHavingLessons(status)).toBe(true);
  });

  it('does not count Passed, Inactive or Waitlist pupils', () => {
    for (const status of ['Passed', 'Inactive', 'Waitlist']) expect(isHavingLessons(status)).toBe(false);
  });
});

describe('needsBooking', () => {
  it('flags a pupil having lessons with nothing booked', () => {
    expect(needsBooking({ status: 'Active', next_lesson: null })).toBe(true);
    expect(needsBooking({ status: 'Active', next_lesson: '2026-10-20T09:00:00Z' })).toBe(false);
  });

  it('does not flag a pupil who has passed, even with nothing booked', () => {
    expect(needsBooking({ status: 'Passed', next_lesson: null })).toBe(false);
    expect(needsBooking({ status: 'Waitlist', next_lesson: null })).toBe(false);
  });
});

describe('hasLowCredit', () => {
  const balances = { a: 1, b: 5, c: 1 };

  it('flags a pupil having lessons with under two prepaid hours left', () => {
    expect(hasLowCredit({ id: 'a', status: 'Active' }, balances)).toBe(true);
    expect(hasLowCredit({ id: 'b', status: 'Active' }, balances)).toBe(false);
  });

  it('does not flag a pupil who has passed or stopped', () => {
    expect(hasLowCredit({ id: 'c', status: 'Passed' }, balances)).toBe(false);
    expect(hasLowCredit({ id: 'c', status: 'Inactive' }, balances)).toBe(false);
  });

  it('does not flag a pupil with no prepaid hours tracked', () => {
    expect(hasLowCredit({ id: 'z', status: 'Active' }, balances)).toBe(false);
  });
});
