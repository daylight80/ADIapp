import { useCallback, useEffect, useState } from 'react';
import { listOpenEnquiries } from './enquiriesDb';
import { useVersion } from './useSupabaseData';
import type { Enquiry } from './enquiries';

/** The instructor's open enquiries, refreshed whenever anything changes. A failed load keeps the real reason. */
export function useEnquiries(): { enquiries: Enquiry[]; loading: boolean; error: string | null; refresh: () => void } {
  const version = useVersion();
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listOpenEnquiries()
      .then((rows) => { if (alive) { setEnquiries(rows); setError(null); } })
      .catch((e) => { if (alive) setError(e?.message || 'Could not load enquiries.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [version, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { enquiries, loading, error, refresh };
}
