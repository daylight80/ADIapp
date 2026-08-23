/**
 * Structured lesson types, each with its own diary color — distinct from
 * the free-text `topic` field (what's being taught vs what kind of lesson
 * it is). Colors chosen to stay distinguishable from each other and from
 * the existing cancelled/warning block states, which still take priority
 * over these when applicable.
 */
export type LessonType = typeof LESSON_TYPES[number]['value'];

export const LESSON_TYPES = [
  { value: 'Standard', color: '#B45309' },
  { value: 'Assessment', color: '#7E22CE' },
  { value: 'First Lesson', color: '#1D4ED8' },
  { value: 'Mock Test', color: '#BE185D' },
  { value: 'Motorway', color: '#0369A1' },
  { value: 'Night', color: '#1E293B' },
  { value: 'Pass Plus', color: '#0F766E' },
  { value: 'Practical Test', color: '#111827' },
  { value: 'Refresher', color: '#4D7C0F' },
  { value: 'Test', color: '#C2410C' },
  { value: 'Theory', color: '#4338CA' },
] as const;

const COLOR_BY_TYPE: Record<string, string> = Object.fromEntries(
  LESSON_TYPES.map((t) => [t.value, t.color]),
);

/** Falls back to the Standard color for any legacy/unrecognized value. */
export function colorForLessonType(type: string | null | undefined): string {
  return COLOR_BY_TYPE[type || 'Standard'] || COLOR_BY_TYPE.Standard;
}
