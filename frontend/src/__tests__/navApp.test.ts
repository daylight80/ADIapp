import { navButtonLabel, resolveNavApp } from '../navApp';

describe('navigation app choice', () => {
  it('uses the instructor\'s chosen app', () => {
    expect(resolveNavApp('waze')).toBe('waze');
    expect(resolveNavApp('apple')).toBe('apple');
    expect(resolveNavApp('google')).toBe('google');
  });

  it('falls back to Google Maps when nothing or something unknown is stored', () => {
    expect(resolveNavApp(undefined)).toBe('google');
    expect(resolveNavApp(null)).toBe('google');
    expect(resolveNavApp('tomtom')).toBe('google');
  });

  it('names the app on the button', () => {
    expect(navButtonLabel('waze')).toBe('Navigate in Waze');
    expect(navButtonLabel('apple')).toBe('Navigate in Apple Maps');
    expect(navButtonLabel(undefined)).toBe('Navigate in Google Maps');
  });
});
