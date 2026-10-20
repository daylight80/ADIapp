import { api } from './api';
import { formatPostcode, looksLikePostcode } from './postcodeLookup';

export type AddressSuggestion = { place_id: string; text: string };
export type PickedAddress = { address: string; postcode: string };

export const MIN_SEARCH_CHARS = 3;

/** True when the text is long enough to be worth sending for suggestions. */
export function worthSearching(text: string): boolean {
  return text.trim().length >= MIN_SEARCH_CHARS;
}

/**
 * Suggestions for what has been typed. Empty when the search is not available (no Google key, a limit, or
 * the network), so the caller always has the plain typing route to fall back on. `available: false` says
 * the service itself is not answering, so the screen can say so.
 */
export async function suggestAddresses(text: string): Promise<{ suggestions: AddressSuggestion[]; available: boolean }> {
  if (!worthSearching(text)) return { suggestions: [], available: true };
  try {
    const res = await api.post('/maps/address-suggest', { query: text.trim() });
    return { suggestions: res.data?.suggestions ?? [], available: res.data?.available !== false };
  } catch {
    return { suggestions: [], available: false };
  }
}

/** The full address and postcode for a chosen suggestion, or null if it could not be fetched. */
export async function addressForSuggestion(placeId: string): Promise<PickedAddress | null> {
  try {
    const res = await api.post('/maps/address-details', { place_id: placeId });
    const address = String(res.data?.address ?? '').trim();
    if (!address) return null;
    const pc = String(res.data?.postcode ?? '').trim();
    return { address, postcode: pc && looksLikePostcode(pc) ? formatPostcode(pc) : pc };
  } catch {
    return null;
  }
}

/** "12 Abbey Road, London, NW8 9AY": what a lesson's pickup holds. Skips an empty part. */
export function combineAddress(address?: string | null, postcode?: string | null): string {
  return [address, postcode].map((p) => (p || '').trim()).filter(Boolean).join(', ');
}
