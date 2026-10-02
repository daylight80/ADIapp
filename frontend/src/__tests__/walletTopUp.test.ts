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

import { WALLET_SAVE_TIMEOUT_MS, TOP_UP_SLOW_MESSAGE, classifyTopUpError, newAttemptId } from '../walletTopUp';
import { TimeoutError } from '../withTimeout';

describe('saving safely', () => {
  it('gives up after 15 seconds', () => {
    expect(WALLET_SAVE_TIMEOUT_MS).toBe(15000);
  });

  it('a stall is a timeout, with a message that says it won\'t add the hours twice', () => {
    const f = classifyTopUpError(new TimeoutError(15000));
    expect(f.kind).toBe('timeout');
    expect(f.message).toBe(TOP_UP_SLOW_MESSAGE);
    expect(f.message).toMatch(/won't add them twice/);
  });

  it('a duplicate (the first try had landed) is recognised by code or by wording', () => {
    expect(classifyTopUpError({ code: '23505', message: 'x' }).kind).toBe('duplicate');
    expect(classifyTopUpError(new Error('duplicate key value violates unique constraint "block_bookings_pkey"')).kind).toBe('duplicate');
    expect(classifyTopUpError({ code: '23505' }).message).toBe('Those hours were already added.');
  });

  it('any other failure keeps its own message and is never mistaken for a timeout or duplicate', () => {
    const f = classifyTopUpError(new Error('new row violates row-level security policy'));
    expect(f).toEqual({ kind: 'other', message: 'new row violates row-level security policy' });
    expect(classifyTopUpError({ code: '42501', message: 'permission denied' }).kind).toBe('other');
  });

  it('falls back to a plain message when there is nothing usable', () => {
    for (const bad of [undefined, null, {}, new Error('   ')]) {
      const f = classifyTopUpError(bad);
      expect(f.kind).toBe('other');
      expect(f.message).toBe('Could not add the hours. Please try again.');
    }
  });

  it('newAttemptId makes well-formed v4 UUIDs that differ each time', () => {
    const ids = Array.from({ length: 50 }, () => newAttemptId());
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(50);
  });

  it('newAttemptId still works where the platform has no crypto.randomUUID', () => {
    const real = (globalThis as any).crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(newAttemptId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
    }
  });
});

import { runTopUp } from '../walletTopUp';

describe('runTopUp (the save, end to end)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // A pretend server that stores each id once and refuses a repeat, like the real
  // database's primary key does.
  function fakeServer() {
    const stored = new Set<string>();
    const dup = () => Object.assign(new Error('duplicate key value violates unique constraint "block_bookings_pkey"'), { code: '23505' });
    return {
      stored,
      saveNow: (id: string) => (stored.has(id) ? Promise.reject(dup()) : (stored.add(id), Promise.resolve({ id }))),
      saveSlow: (id: string, ms: number) => new Promise((res, rej) => setTimeout(() => (stored.has(id) ? rej(dup()) : (stored.add(id), res({ id }))), ms)),
    };
  }

  it('a normal save is saved', async () => {
    const srv = fakeServer();
    await expect(runTopUp(() => srv.saveNow('a'))).resolves.toEqual({ status: 'saved' });
    expect(srv.stored.size).toBe(1);
  });

  it('a real failure is reported with its own message', async () => {
    const r = await runTopUp(() => Promise.reject(new Error('new row violates row-level security policy')));
    expect(r).toEqual({ status: 'failed', message: 'new row violates row-level security policy' });
  });

  it('a stalled save times out at 15 seconds instead of hanging forever', async () => {
    const result = runTopUp(() => new Promise(() => {}));
    await jest.advanceTimersByTimeAsync(14999);
    let settled = false;
    result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ status: 'timeout', message: TOP_UP_SLOW_MESSAGE });
  });

  it('a save that stalls, lands late, and is then retried with the same id is NOT added twice', async () => {
    const srv = fakeServer();
    const first = runTopUp(() => srv.saveSlow('attempt-1', 20000));   // slower than the 15s limit
    await jest.advanceTimersByTimeAsync(15000);
    expect((await first).status).toBe('timeout');
    expect(srv.stored.size).toBe(0);                                  // not landed yet at the moment of giving up

    await jest.advanceTimersByTimeAsync(5000);                         // ...but it lands afterwards
    expect(srv.stored.has('attempt-1')).toBe(true);

    const retry = await runTopUp(() => srv.saveNow('attempt-1'));      // the instructor taps Add again
    expect(retry).toEqual({ status: 'already', message: 'Those hours were already added.' });
    expect(srv.stored.size).toBe(1);                                   // still exactly one booking
  });

  it('a retry where the first try never landed does save', async () => {
    const srv = fakeServer();
    const first = runTopUp(() => new Promise(() => {}));
    await jest.advanceTimersByTimeAsync(15000);
    expect((await first).status).toBe('timeout');
    await expect(runTopUp(() => srv.saveNow('attempt-1'))).resolves.toEqual({ status: 'saved' });
    expect(srv.stored.size).toBe(1);
  });

  it('a different attempt id (hours or method changed) is a separate top-up', async () => {
    const srv = fakeServer();
    await runTopUp(() => srv.saveNow('attempt-1'));
    await expect(runTopUp(() => srv.saveNow('attempt-2'))).resolves.toEqual({ status: 'saved' });
    expect(srv.stored.size).toBe(2);
  });
});
