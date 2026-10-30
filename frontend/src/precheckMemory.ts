/**
 * Eyesight and licence are checked once, at a pupil's first lesson. Confirming a pre-lesson check needs all three
 * ticks, so any earlier lesson with a confirmed pre-check means those two were done. Fitness to drive is still
 * ticked every lesson. A lookup that fails counts as "not remembered": the instructor just ticks all three.
 */
export async function pupilHasConfirmedPrecheck(studentId: string, thisLessonId: string): Promise<boolean> {
  try {
    const { supabase } = require('./supabaseClient') as typeof import('./supabaseClient');
    const { data, error } = await supabase
      .from('lessons')
      .select('id')
      .eq('student_id', studentId)
      .neq('id', thisLessonId)
      .not('pre_check_completed_at', 'is', null)
      .limit(1);
    return !error && (data ?? []).length > 0;
  } catch {
    return false;
  }
}
