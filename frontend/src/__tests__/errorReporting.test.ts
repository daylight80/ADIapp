import React from 'react';

jest.mock('@sentry/react-native', () => ({
  __esModule: true,
  init: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  wrap: jest.fn((c: unknown) => c),
}));

import * as Sentry from '@sentry/react-native';
import { initErrorReporting, setReportingUser, withErrorReporting } from '../errorReporting.native';

const mockSentry = Sentry as unknown as Record<'init' | 'setUser' | 'setTag' | 'wrap', jest.Mock>;
const setDev = (v: boolean) => { (global as any).__DEV__ = v; };

beforeEach(() => { (['init', 'setUser', 'setTag', 'wrap'] as const).forEach((k) => mockSentry[k].mockClear()); });
afterAll(() => setDev(true));

describe('error reporting on the phone apps', () => {
  it('reports nothing while developing', () => {
    setDev(true);
    initErrorReporting();
    expect(mockSentry.init).not.toHaveBeenCalled();
    const C = () => null;
    expect(withErrorReporting(C)).toBe(C);
    expect(mockSentry.wrap).not.toHaveBeenCalled();
  });

  it('starts Sentry in a real build, with no personal data and no tracing', () => {
    setDev(false);
    initErrorReporting();
    const opts = mockSentry.init.mock.calls[0][0];
    expect(opts.dsn).toMatch(/^https:\/\/[a-f0-9]+@.*sentry\.io\/\d+$/);
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.tracesSampleRate).toBe(0);
    // The hooks scrub URLs and users.
    expect(opts.beforeBreadcrumb({ data: { url: 'https://x.co/a?e=a@b.co' } }).data.url).toBe('https://x.co/a');
    expect(opts.beforeSend({ user: { id: 'u1', email: 'a@b.co' } }).user).toEqual({ id: 'u1' });
  });

  it('never stops the app starting if Sentry itself throws', () => {
    setDev(false);
    mockSentry.init.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => initErrorReporting()).not.toThrow();
  });

  it('wraps the root component in a real build', () => {
    setDev(false);
    const C = () => React.createElement('div');
    withErrorReporting(C);
    expect(mockSentry.wrap).toHaveBeenCalledWith(C);
  });

  it('tags reports with the signed-in user id and role only, and clears it on sign out', () => {
    setReportingUser('u1', 'instructor');
    expect(mockSentry.setUser).toHaveBeenCalledWith({ id: 'u1' });
    expect(mockSentry.setTag).toHaveBeenCalledWith('role', 'instructor');
    setReportingUser(null);
    expect(mockSentry.setUser).toHaveBeenLastCalledWith(null);
  });
});
