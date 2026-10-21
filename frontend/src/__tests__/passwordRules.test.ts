import { passwordProblem, MIN_PASSWORD_LENGTH, PASSWORD_HINT } from '../passwordRules';

describe('passwordProblem', () => {
  it('accepts 8 or more characters with letters and numbers', () => {
    expect(passwordProblem('Driving2026')).toBeNull();
    expect(passwordProblem('abcd1234')).toBeNull();
    expect(passwordProblem('1234abcd!?')).toBeNull();
  });

  it('refuses a short password', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(passwordProblem('abc123')).toBe('Password must be at least 8 characters.');
    expect(passwordProblem('')).toBe('Password must be at least 8 characters.');
    expect(passwordProblem('abcd123')).toBe('Password must be at least 8 characters.');
  });

  it('refuses letters only or numbers only', () => {
    expect(passwordProblem('abcdefgh')).toBe('Use both letters and numbers in your password.');
    expect(passwordProblem('12345678')).toBe('Use both letters and numbers in your password.');
    expect(passwordProblem('!!!!!!!!!')).toBe('Use both letters and numbers in your password.');
  });

  it('has a hint that says what is needed', () => {
    expect(PASSWORD_HINT).toMatch(/8 characters/);
    expect(PASSWORD_HINT).toMatch(/letters and numbers/);
  });
});
