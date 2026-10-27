import { passwordProblem, MIN_PASSWORD_LENGTH, PASSWORD_HINT } from '../passwordRules';

const EASY = 'That password is too easy to guess. Choose something less common.';

describe('passwordProblem', () => {
  it('accepts 10 or more characters with letters and numbers that are not guessable', () => {
    expect(passwordProblem('Bluebell-2026-Fox')).toBeNull();
    expect(passwordProblem('tr4mpoline9Kettle')).toBeNull();
    expect(passwordProblem('1234abcd!?zQ')).toBeNull();
  });

  it('refuses a short password, including the old 8-character minimum', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(passwordProblem('')).toBe('Password must be at least 10 characters.');
    expect(passwordProblem('abc123')).toBe('Password must be at least 10 characters.');
    expect(passwordProblem('Kettle2026')).toBeNull(); // exactly 10 is enough
    expect(passwordProblem('Kettle202')).toBe('Password must be at least 10 characters.');
    expect(passwordProblem('abcd1234')).toBe('Password must be at least 10 characters.');
  });

  it('refuses letters only or numbers only', () => {
    expect(passwordProblem('abcdefghijkl')).toBe('Use both letters and numbers in your password.');
    expect(passwordProblem('1234567890123')).toBe('Use both letters and numbers in your password.');
    expect(passwordProblem('!!!!!!!!!!!')).toBe('Use both letters and numbers in your password.');
  });

  it('refuses common passwords, with digits, symbols or look-alike letters added', () => {
    for (const p of ['Password123!', 'password1234', 'P@ssw0rd2026', 'Qwerty12345', 'Liverpool2026', 'Welcome-123', 'letmein12345', 'DualControl1', 'iloveyou123']) {
      expect(passwordProblem(p)).toBe(EASY);
    }
  });

  it('refuses repeated characters and straight runs', () => {
    expect(passwordProblem('aaaaaaaaa1')).toBe(EASY);
    expect(passwordProblem('abcdefghij1')).toBe(EASY);
    expect(passwordProblem('9876543210a')).toBe(EASY);
  });

  it('refuses a password built from the email or the name', () => {
    const msg = 'Your password should not contain your name or email address.';
    expect(passwordProblem('jonkenny-Pa55word', { email: 'jonkenny@example.com' })).toBe(msg);
    expect(passwordProblem('Morgan-2026-teal', { name: 'Alex Morgan' })).toBe(msg);
    expect(passwordProblem('Bluebell-2026-Fox', { email: 'jonkenny@example.com', name: 'Jon Kenny' })).toBeNull();
  });

  it('ignores short name or email parts, so common letters do not block a password', () => {
    expect(passwordProblem('Bluebell-2026-Fox', { email: 'al@example.com', name: 'Al Li' })).toBeNull();
  });

  it('has a hint that says what is needed', () => {
    expect(PASSWORD_HINT).toMatch(/10 characters/);
    expect(PASSWORD_HINT).toMatch(/letters and numbers/);
  });
});
