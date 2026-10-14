// Removes personal data from what is sent to Sentry. ADI Pro's requests carry pupils' and
// instructors' details in URLs (for example a Supabase filter like students?email=eq.sam@x.co),
// and Sentry records them as breadcrumbs, so URLs are cut back to their path before sending.
// Pure functions with no Sentry import, so they can be tested.

/** "https://x.co/rest/v1/students?email=eq.a@b.co#top" -> "https://x.co/rest/v1/students" */
export function scrubUrl(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

type Obj = Record<string, any>;

/** For Sentry's beforeBreadcrumb: web requests keep their path but lose the query string. */
export function scrubBreadcrumb<T extends Obj | null>(crumb: T): T {
  if (!crumb) return crumb;
  const data = crumb.data;
  if (!data || typeof data !== 'object') return crumb;
  const next: Obj = { ...data };
  if ('url' in next) next.url = scrubUrl(next.url);
  if ('to' in next) next.to = scrubUrl(next.to);
  if ('from' in next) next.from = scrubUrl(next.from);
  return { ...crumb, data: next };
}

/**
 * For Sentry's beforeSend: keep the error and the device, drop who and what. Only the
 * signed-in user's id (set by setReportingUser) is kept, never their email, name or IP.
 */
export function scrubEvent<T extends Obj>(event: T): T {
  const out: Obj = { ...event };
  if (out.user) out.user = out.user.id ? { id: out.user.id } : undefined;
  if (out.request) {
    const { url } = out.request;
    out.request = url ? { url: scrubUrl(url) } : undefined;
  }
  if (Array.isArray(out.breadcrumbs)) out.breadcrumbs = out.breadcrumbs.map(scrubBreadcrumb);
  if (out.extra && 'email' in out.extra) {
    const { email: _email, ...rest } = out.extra;
    out.extra = rest;
  }
  return out as T;
}
