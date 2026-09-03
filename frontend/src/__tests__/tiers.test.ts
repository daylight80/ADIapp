// tiers.ts imports supabaseClient.ts (only used by loadSchoolUsage(),
// which isn't tested here — it's not a pure function). Mocked rather
// than left real, since createClient() genuinely throws when
// EXPO_PUBLIC_SUPABASE_URL is unset, which it always is in this test
// environment — no .env file exists here at all (gitignored, local-only
// per the project's own setup), and jest.config.js has no dotenv
// loading configured, so this isn't just a sandbox quirk.
jest.mock('../supabaseClient', () => ({ supabase: {} }));

import {
  tierById, isPaidTier, isFranchiseTier, isProTier, canAddStudent,
  explainLimitError, studentUsageUrgency, studentUsageMessage, schoolDisplayName,
  TIERS,
} from '../tiers';

describe('tierById', () => {
  it('finds each real tier by id', () => {
    expect(tierById('starter').name).toBe('Starter');
    expect(tierById('growth').name).toBe('Growth');
    expect(tierById('pro').name).toBe('Pro');
    expect(tierById('franchise').name).toBe('Franchise');
  });

  it('falls back to Starter (TIERS[0]) for an unrecognised tier', () => {
    expect(tierById('not-a-real-tier').id).toBe('starter');
  });

  it('falls back to Starter for null or undefined', () => {
    expect(tierById(null).id).toBe('starter');
    expect(tierById(undefined).id).toBe('starter');
  });
});

describe('isPaidTier', () => {
  it('is false for Starter specifically — the whole point of this helper', () => {
    expect(isPaidTier('starter')).toBe(false);
  });

  it('is true for every tier above Starter', () => {
    expect(isPaidTier('growth')).toBe(true);
    expect(isPaidTier('pro')).toBe(true);
    expect(isPaidTier('franchise')).toBe(true);
  });

  it('treats an unrecognised or missing tier as not paid — never grants a paid feature by accident', () => {
    expect(isPaidTier('bogus')).toBe(false);
    expect(isPaidTier(null)).toBe(false);
    expect(isPaidTier(undefined)).toBe(false);
  });
});

describe('isFranchiseTier', () => {
  it('is true for Franchise only', () => {
    expect(isFranchiseTier('franchise')).toBe(true);
  });

  it('is false for every other tier, including Pro', () => {
    expect(isFranchiseTier('starter')).toBe(false);
    expect(isFranchiseTier('growth')).toBe(false);
    expect(isFranchiseTier('pro')).toBe(false);
  });
});

describe('isProTier', () => {
  it('is true for Pro and Franchise', () => {
    expect(isProTier('pro')).toBe(true);
    expect(isProTier('franchise')).toBe(true);
  });

  it('is false for Starter and Growth', () => {
    expect(isProTier('starter')).toBe(false);
    expect(isProTier('growth')).toBe(false);
  });
});

describe('canAddStudent', () => {
  it('allows adding right up to, but not at, the limit', () => {
    expect(canAddStudent('starter', 4)).toBe(true);  // 4 < 5
    expect(canAddStudent('starter', 5)).toBe(false); // 5 is the limit itself
  });

  it('always allows adding on an unlimited tier (Pro/Franchise), regardless of current count', () => {
    expect(canAddStudent('pro', 0)).toBe(true);
    expect(canAddStudent('pro', 100000)).toBe(true);
    expect(canAddStudent('franchise', 100000)).toBe(true);
  });

  it('uses the correct per-tier limit for Growth (15)', () => {
    expect(canAddStudent('growth', 14)).toBe(true);
    expect(canAddStudent('growth', 15)).toBe(false);
  });
});

describe('explainLimitError', () => {
  it('recognises the student-limit trigger error', () => {
    expect(explainLimitError({ message: 'STUDENT_LIMIT_REACHED: some detail' }))
      .toMatch(/student limit/i);
  });

  it('recognises the instructor-limit trigger error', () => {
    expect(explainLimitError({ message: 'INSTRUCTOR_LIMIT_REACHED' }))
      .toMatch(/Franchise/i);
  });

  it('returns null for an unrelated error rather than a misleading message', () => {
    expect(explainLimitError({ message: 'Network request failed' })).toBeNull();
  });

  it('does not throw on a malformed or missing error object', () => {
    expect(explainLimitError(null)).toBeNull();
    expect(explainLimitError(undefined)).toBeNull();
    expect(explainLimitError({})).toBeNull();
  });
});

describe('studentUsageUrgency', () => {
  it('is always ok on an unlimited tier (null limit)', () => {
    expect(studentUsageUrgency(0, null)).toBe('ok');
    expect(studentUsageUrgency(9999, null)).toBe('ok');
  });

  it('is critical once current reaches the limit', () => {
    expect(studentUsageUrgency(5, 5)).toBe('critical');
  });

  it('is critical past the limit too, not just at it', () => {
    expect(studentUsageUrgency(6, 5)).toBe('critical');
  });

  it('is warning at exactly the 60% threshold', () => {
    expect(studentUsageUrgency(3, 5)).toBe('warning'); // 3/5 = 0.6 exactly
  });

  it('is ok just under the 60% threshold', () => {
    expect(studentUsageUrgency(2, 5)).toBe('ok'); // 2/5 = 0.4
  });
});

describe('studentUsageMessage', () => {
  it('returns an empty string on an unlimited tier — nothing to nudge about', () => {
    expect(studentUsageMessage(10, null)).toBe('');
  });

  it('gives the strongest message once the limit is reached', () => {
    expect(studentUsageMessage(5, 5)).toMatch(/reached your limit/i);
  });

  it('gives a distinct, more urgent message for exactly 1 spot left', () => {
    const msg = studentUsageMessage(4, 5);
    expect(msg).toMatch(/1 spot left/i);
  });

  it('gives a softer nudge in the warning zone (2+ spots left, but past 60%)', () => {
    const msg = studentUsageMessage(3, 5); // 60% exactly = warning, 2 spots left
    expect(msg).toMatch(/getting close/i);
  });

  it('gives the mildest, generic upsell well under the warning threshold', () => {
    const msg = studentUsageMessage(1, 5); // 20%, nowhere near warning
    expect(msg).toMatch(/unlock more students/i);
  });

  it('every non-empty message names Growth\u2019s real current price, not a stale hardcoded figure', () => {
    const growthPrice = tierById('growth').price_gbp;
    expect(studentUsageMessage(5, 5)).toContain(String(growthPrice));
  });
});

describe('schoolDisplayName', () => {
  it('shows the business name for Franchise when one is set', () => {
    expect(schoolDisplayName('franchise', 'Acme Driving School', 'Jane Smith', '123456')).toBe('Acme Driving School');
  });

  it('shows the instructor name + ADI number below Franchise, not the auto-generated business name', () => {
    expect(schoolDisplayName('pro', 'Some Auto-Generated Name Ltd', 'Jane Smith', '123456'))
      .toBe('Jane Smith \u00b7 ADI #123456');
  });

  it('drops the ADI-number suffix cleanly when no ADI number is set', () => {
    expect(schoolDisplayName('growth', 'Auto Name', 'Jane Smith', null)).toBe('Jane Smith');
  });

  it('falls back to the business name if even the instructor name is missing', () => {
    expect(schoolDisplayName('starter', 'Fallback Name', null, null)).toBe('Fallback Name');
  });

  it('falls back to a generic label as the last resort when nothing at all is set', () => {
    expect(schoolDisplayName('starter', null, null, null)).toBe('Your driving school');
  });

  it('does not show the business name for Franchise if it is somehow missing, even though tier matches', () => {
    expect(schoolDisplayName('franchise', null, 'Jane Smith', '123456')).toBe('Jane Smith \u00b7 ADI #123456');
  });
});

describe('TIERS data integrity', () => {
  it('has exactly the four tiers this whole app is built around, in a stable order', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['starter', 'growth', 'pro', 'franchise']);
  });

  it('prices increase monotonically with tier — catches an accidental typo/swap', () => {
    const prices = TIERS.map((t) => t.price_gbp);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1]);
    }
  });

  it('Starter is genuinely free', () => {
    expect(tierById('starter').price_gbp).toBe(0);
  });
});
