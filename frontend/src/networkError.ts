/** True for the errors a lost or very weak connection throws (as opposed to the server refusing a request). */
export function isNetworkError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e ?? '');
  return /network request failed|failed to fetch|network error|load failed|timed out|timeout|aborted|offline/i.test(msg);
}
