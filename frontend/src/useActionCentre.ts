import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from './AuthContext';
import { isPaidTier } from './tiers';
import { listMyDeadlineItems, listHoursBalanceForStudents } from './supabaseDb';
import type { DeadlineItem } from './deadlines';
import { useStudents, useLessonsBetween } from './useSupabaseData';
import { buildActionItems, CHECKED_WINDOW_DAYS, AHEAD_WINDOW_DAYS, type ActionItem } from './actionCentre';

/**
 * Everything the Action Centre needs, loaded once and turned into the list. Used by both the Home card and the
 * full screen. Deadlines are a paid feature, so they are only fetched (and listed) on paid plans. A failed load of
 * any one part just leaves that part out: a missing nudge is better than an error on Home.
 */
export function useActionCentre(): { items: ActionItem[]; loading: boolean } {
  const { user } = useAuth();
  const paid = isPaidTier(user?.tier);
  const { students, loading: studentsLoading } = useStudents();

  // A whole-day window, so the lesson query isn't re-run on every render.
  const today = new Date();
  const dayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const { from, to } = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const f = new Date(start); f.setDate(f.getDate() - CHECKED_WINDOW_DAYS);
    const t = new Date(start); t.setDate(t.getDate() + AHEAD_WINDOW_DAYS);
    return { from: f, to: t };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);
  const { lessons, loading: lessonsLoading } = useLessonsBetween(from, to);

  const [hoursBalances, setHoursBalances] = useState<Record<string, number>>({});
  useEffect(() => {
    if (students.length === 0) { setHoursBalances({}); return; }
    let alive = true;
    listHoursBalanceForStudents(students.map((s) => s.id))
      .then((m) => { if (alive) setHoursBalances(m); })
      .catch(() => {});
    return () => { alive = false; };
  }, [students]);

  const [deadlines, setDeadlines] = useState<DeadlineItem[]>([]);
  useFocusEffect(useCallback(() => {
    if (!paid) { setDeadlines([]); return; }
    let alive = true;
    listMyDeadlineItems().then((d) => { if (alive) setDeadlines(d); }).catch(() => {});
    return () => { alive = false; };
  }, [paid]));

  const items = useMemo(
    () => buildActionItems({ now: new Date(), students, lessons, hoursBalances, deadlines }),
    [students, lessons, hoursBalances, deadlines],
  );
  return { items, loading: studentsLoading || lessonsLoading };
}
