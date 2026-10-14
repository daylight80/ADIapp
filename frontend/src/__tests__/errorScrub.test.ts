import { scrubUrl, scrubBreadcrumb, scrubEvent } from '../errorScrub';

describe('scrubUrl', () => {
  it('cuts off the query string and fragment, which can hold emails and filters', () => {
    expect(scrubUrl('https://x.supabase.co/rest/v1/students?email=eq.sam@x.co&select=*')).toBe('https://x.supabase.co/rest/v1/students');
    expect(scrubUrl('https://app.co/reset?token=abc#access_token=secret')).toBe('https://app.co/reset');
    expect(scrubUrl('https://app.co/home#top')).toBe('https://app.co/home');
  });
  it('leaves a clean URL alone, and anything that is not a string', () => {
    expect(scrubUrl('https://app.co/home')).toBe('https://app.co/home');
    expect(scrubUrl(undefined)).toBeUndefined();
    expect(scrubUrl(42)).toBe(42);
  });
});

describe('scrubBreadcrumb', () => {
  it('scrubs the URL of a request breadcrumb and keeps everything else', () => {
    const crumb = { category: 'fetch', data: { url: 'https://x.co/rest/v1/students?email=eq.a@b.co', method: 'GET', status_code: 200 } };
    expect(scrubBreadcrumb(crumb)).toEqual({ category: 'fetch', data: { url: 'https://x.co/rest/v1/students', method: 'GET', status_code: 200 } });
  });
  it('scrubs screen-change breadcrumbs (from and to)', () => {
    const crumb = { category: 'navigation', data: { from: '/student-lifecycle-screen?id=123', to: '/profile-screen?x=1' } };
    expect(scrubBreadcrumb(crumb).data).toEqual({ from: '/student-lifecycle-screen', to: '/profile-screen' });
  });
  it('does not change the original and copes with a breadcrumb with no data', () => {
    const crumb = { category: 'fetch', data: { url: 'https://x.co/a?b=1' } };
    scrubBreadcrumb(crumb);
    expect(crumb.data.url).toBe('https://x.co/a?b=1');
    expect(scrubBreadcrumb({ message: 'tapped' })).toEqual({ message: 'tapped' });
    expect(scrubBreadcrumb(null)).toBeNull();
  });
});

describe('scrubEvent', () => {
  it('keeps only the user id, never email, name or IP address', () => {
    const e = scrubEvent({ user: { id: 'u1', email: 'a@b.co', username: 'sam', ip_address: '1.2.3.4' } });
    expect(e.user).toEqual({ id: 'u1' });
  });
  it('drops a user with no id altogether', () => {
    expect(scrubEvent({ user: { email: 'a@b.co' } }).user).toBeUndefined();
  });
  it('keeps the request URL without its query, and drops headers and cookies', () => {
    const e = scrubEvent({ request: { url: 'https://app.co/x?token=1', headers: { cookie: 'a=b' }, cookies: { a: 'b' }, data: { email: 'a@b.co' } } });
    expect(e.request).toEqual({ url: 'https://app.co/x' });
  });
  it('scrubs every breadcrumb and an email left in extra data', () => {
    const e = scrubEvent({
      breadcrumbs: [{ data: { url: 'https://x.co/a?e=a@b.co' } }, { message: 'hi' }],
      extra: { email: 'a@b.co', screen: 'profile' },
    });
    expect(e.breadcrumbs).toEqual([{ data: { url: 'https://x.co/a' } }, { message: 'hi' }]);
    expect(e.extra).toEqual({ screen: 'profile' });
  });
  it('leaves the error itself untouched', () => {
    const exception = { values: [{ type: 'TypeError', value: 'x is undefined' }] };
    expect(scrubEvent({ exception, level: 'error' })).toMatchObject({ exception, level: 'error' });
  });
});
