import {
  MIN_ADD_HOURS, MAX_ADD_HOURS, clampAddHours, stepAddHours, topUpAmount, formatMoney,
  describeTopUp, topUpConfirmation, canAddHours, paymentMethodLabel, PAYMENT_METHODS,
} from '../walletTopUp';

describe('limits', () => {
  it('is one hour to one hundred, in whole-hour steps', () => {
    expect(MIN_ADD_HOURS).toBe(1);
    expect(MAX_ADD_HOURS).toBe(100);
  });
});

describe('clampAddHours', () => {
  it('keeps hours whole and inside the range', () => {
    expect(clampAddHours(3)).toBe(3);
    expect(clampAddHours(2.6)).toBe(3);
    expect(clampAddHours(0)).toBe(1);
    expect(clampAddHours(-4)).toBe(1);
    expect(clampAddHours(500)).toBe(100);
  });
  it('turns anything unusable into the minimum', () => {
    expect(clampAddHours(NaN)).toBe(1);
    expect(clampAddHours(Infinity)).toBe(1);
  });
});

describe('stepAddHours', () => {
  it('moves one hour at a time', () => {
    expect(stepAddHours(1, 1)).toBe(2);
    expect(stepAddHours(5, 1)).toBe(6);
    expect(stepAddHours(5, -1)).toBe(4);
  });
  it('never goes below the minimum or above the maximum', () => {
    expect(stepAddHours(1, -1)).toBe(1);
    expect(stepAddHours(100, 1)).toBe(100);
  });
});

describe('topUpAmount (hours x the student\'s rate)', () => {
  it('multiplies hours by the rate', () => {
    expect(topUpAmount(3, 38)).toBe(114);
    expect(topUpAmount(1, 40)).toBe(40);
    expect(topUpAmount(10, 36)).toBe(360);
  });
  it('rounds to the penny', () => {
    expect(topUpAmount(3, 33.333)).toBe(100);
    expect(topUpAmount(1, 12.345)).toBe(12.35);
  });
  it('gives 0 for a missing or invalid rate rather than a nonsense amount', () => {
    for (const bad of [null, undefined, NaN, -5, 'abc' as any]) expect(topUpAmount(3, bad)).toBe(0);
  });
  it('a rate of 0 is allowed and gives 0', () => {
    expect(topUpAmount(3, 0)).toBe(0);
  });
});

describe('formatMoney', () => {
  it('drops pence only when there are none', () => {
    expect(formatMoney(114)).toBe('£114');
    expect(formatMoney(114.5)).toBe('£114.50');
    expect(formatMoney(0)).toBe('£0');
  });
});

describe('describeTopUp', () => {
  it('spells out the sum', () => {
    expect(describeTopUp(3, 38)).toBe('3 hours at £38/hr = £114');
    expect(describeTopUp(1, 38)).toBe('1 hour at £38/hr = £38');
    expect(describeTopUp(2, 37.5)).toBe('2 hours at £37.50/hr = £75');
  });
  it('shows a missing rate as £0 rather than NaN', () => {
    expect(describeTopUp(2, null)).toBe('2 hours at £0/hr = £0');
  });
});

describe('topUpConfirmation', () => {
  it('names the student, hours, amount and method', () => {
    expect(topUpConfirmation('Sam Taylor', 3, 114, 'cash')).toBe("3 hours added to Sam Taylor's wallet (£114, Cash).");
    expect(topUpConfirmation('Sam', 1, 38, 'bank_transfer')).toBe("1 hour added to Sam's wallet (£38, Bank Transfer).");
  });
});

describe('canAddHours', () => {
  it('needs a student and a payment method', () => {
    expect(canAddHours('abc', 'cash')).toBe(true);
    expect(canAddHours('abc', null)).toBe(false);
    expect(canAddHours('', 'card')).toBe(false);
    expect(canAddHours(undefined, 'card')).toBe(false);
  });
});

describe('payment methods', () => {
  it('offers exactly the three the database allows, with readable names', () => {
    expect(PAYMENT_METHODS.map((m) => m.key)).toEqual(['bank_transfer', 'card', 'cash']);
    expect(paymentMethodLabel('bank_transfer')).toBe('Bank Transfer');
    expect(paymentMethodLabel('card')).toBe('Card');
    expect(paymentMethodLabel('cash')).toBe('Cash');
  });
});
