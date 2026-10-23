// Driving profile: a short "where is this pupil" card for the instructor, built only from data already held (syllabus
// levels, recent lesson faults, the last lesson notes and the readiness criteria). No new data, no model call.
// Pure logic, tested in __tests__/drivingProfile.test.ts.

type Comp = { category_name: string; level: number; progress?: number; touched?: boolean };
type LessonLike = { status?: string | null; date: string; serious_faults?: number | null; dangerous_faults?: number | null };
type Focus = { goal: string | null; practice: string | null } | null;

/** A topic counts as weak at level 2 of 5 or lower (the same line the Home "where pupils need help" card uses). */
export const WEAK_LEVEL_MAX = 2;
/** Lessons looked at for a repeating fault pattern. */
export const FAULT_LESSONS = 3;

export type DrivingProfile = {
  /** What to work on next: the goal set in the last notes, else the weakest assessed topic. */
  focus: string | null;
  /** Recurring issues: weak assessed topics, and serious or dangerous faults in each of the last lessons. */
  issues: string[];
  /** What the last lesson notes said needed more practice. */
  practice: string | null;
  /** Readiness criteria still to meet. */
  toMeet: string[];
};

export function buildDrivingProfile(input: {
  competencies: Comp[];
  lessons: LessonLike[];
  focus: Focus;
  unmetCriteria: string[];
}): DrivingProfile {
  const weak = input.competencies
    .filter((c) => c.touched !== false && c.level <= WEAK_LEVEL_MAX)
    .sort((a, b) => a.level - b.level || (a.progress ?? 0) - (b.progress ?? 0));
  const issues = weak.slice(0, 3).map((c) => `${c.category_name} (level ${c.level} of 5)`);

  const recent = input.lessons
    .filter((l) => l.status === 'Completed')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, FAULT_LESSONS);
  if (recent.length === FAULT_LESSONS && recent.every((l) => (l.serious_faults ?? 0) + (l.dangerous_faults ?? 0) > 0)) {
    issues.push(`Serious or dangerous faults in each of the last ${FAULT_LESSONS} lessons`);
  }

  return {
    focus: input.focus?.goal || (weak[0] ? `Work on ${weak[0].category_name}` : null),
    issues,
    practice: input.focus?.practice ?? null,
    toMeet: input.unmetCriteria,
  };
}
