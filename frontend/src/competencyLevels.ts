// Competency levels run 1 to 5 and each has its own name. The screen used to have
// only four names, so level 4 and level 5 both read "Mastered".

export const LEVEL_LABELS = ['Introduced', 'Practising', 'Developing', 'Confident', 'Mastered'] as const;

export const MAX_LEVEL = LEVEL_LABELS.length;

/** The name for a level, keeping out-of-range values inside 1 to 5. */
export function levelLabel(level: number): string {
  const n = Number.isFinite(level) ? Math.round(level) : 1;
  return LEVEL_LABELS[Math.min(MAX_LEVEL, Math.max(1, n)) - 1];
}
