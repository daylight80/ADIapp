import { walletDisplay, isLowCredit, formatHours, LOW_CREDIT_THRESHOLD_HOURS } from '../walletDisplay';

describe('formatHours', () => {
  it('drops a trailing .0 and keeps one decimal otherwise', () => {
    expect(formatHours(3)).toBe('3');
    expect(formatHours(1.5)).toBe('1.5');
    expect(formatHours(0.25)).toBe('0.3');
    expect(formatHours(12)).toBe('12');
  });
});

describe('walletDisplay', () => {
  it('shows hours prepaid as ok when comfortably above the low threshold', () => {
    expect(walletDisplay(6, true)).toEqual({ text: '6h prepaid', tone: 'ok' });
    expect(walletDisplay(LOW_CREDIT_THRESHOLD_HOURS, true)).toEqual({ text: '2h prepaid', tone: 'ok' });
  });

  it('flags a small remaining balance as low', () => {
    expect(walletDisplay(1.5, true)).toEqual({ text: '1.5h prepaid', tone: 'low' });
    expect(walletDisplay(0.5, true)).toEqual({ text: '0.5h prepaid', tone: 'low' });
  });

  it('shows hours to instructors on every plan, including where the wallet is unavailable', () => {
    expect(walletDisplay(4, false)).toEqual({ text: '4h prepaid', tone: 'ok' });
  });

  it('shows "No prepaid hours" only where the wallet is available', () => {
    expect(walletDisplay(0, true)).toEqual({ text: 'No prepaid hours', tone: 'none' });
    expect(walletDisplay(0, false)).toBeNull();
  });

  it('treats an overdrawn or unknown balance as none, never as prepaid', () => {
    expect(walletDisplay(-1, true)).toEqual({ text: 'No prepaid hours', tone: 'none' });
    expect(walletDisplay(undefined, true)).toEqual({ text: 'No prepaid hours', tone: 'none' });
    expect(walletDisplay(null, false)).toBeNull();
    expect(walletDisplay(NaN, true)).toEqual({ text: 'No prepaid hours', tone: 'none' });
  });
});

describe('isLowCredit', () => {
  it('is true only for some hours left but under the threshold', () => {
    expect(isLowCredit(1)).toBe(true);
    expect(isLowCredit(1.99)).toBe(true);
    expect(isLowCredit(2)).toBe(false);
    expect(isLowCredit(0)).toBe(false);
    expect(isLowCredit(-3)).toBe(false);
    expect(isLowCredit(undefined)).toBe(false);
  });

  it('agrees with the low tone shown on the row', () => {
    for (const h of [0.5, 1, 1.9, 2, 3]) {
      expect(isLowCredit(h)).toBe(walletDisplay(h, true)?.tone === 'low');
    }
  });
});
