import { useEffect, useState } from 'react';
import { fetchMyNextGoal, type PupilGoal } from './lessonSummary';
import { useVersion } from './useSupabaseData';

/** The goal the instructor wrote for the pupil's next lesson (only the goal, never the instructor's other notes). */
export function usePupilGoal(enabled: boolean): PupilGoal | null {
  const version = useVersion();
  const [goal, setGoal] = useState<PupilGoal | null>(null);
  useEffect(() => {
    if (!enabled) { setGoal(null); return; }
    let alive = true;
    fetchMyNextGoal().then((g) => { if (alive) setGoal(g); }).catch(() => { if (alive) setGoal(null); });
    return () => { alive = false; };
  }, [enabled, version]);
  return goal;
}
