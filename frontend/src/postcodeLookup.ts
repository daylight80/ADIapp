// Checks a UK postcode with Postcodes.io, a free, open-source postcode API (no key needed).
// It confirms the postcode exists and names the area. It does not list the houses on a
// street (that data is licensed from Royal Mail), so the pupil still types the street and
// house number themselves.

export type PostcodeLookup =
  | { status: 'found'; postcode: string; area: string }
  | { status: 'not_found' }
  // The service could not be reached. Callers should let the pupil carry on, not block them.
  | { status: 'unavailable' };

/** Upper-case, single space before the last three characters: "sm14ls" -> "SM1 4LS". */
export function formatPostcode(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

/** The shape of a UK postcode, not proof that it exists. */
export function looksLikePostcode(raw: string): boolean {
  return /^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$/.test(formatPostcode(raw));
}

const TIMEOUT_MS = 6000;

export async function lookupPostcode(raw: string, fetchImpl: typeof fetch = fetch): Promise<PostcodeLookup> {
  if (!looksLikePostcode(raw)) return { status: 'not_found' };
  const postcode = formatPostcode(raw);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
      signal: controller?.signal,
    });
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'unavailable' };
    const body = await res.json();
    const r = body?.result;
    if (!r?.postcode) return { status: 'unavailable' };
    const area = [r.admin_district, r.admin_county, r.region]
      .filter((v: unknown, i: number, all: unknown[]) => typeof v === 'string' && v && all.indexOf(v) === i)
      .slice(0, 2)
      .join(', ');
    return { status: 'found', postcode: r.postcode, area };
  } catch {
    return { status: 'unavailable' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
