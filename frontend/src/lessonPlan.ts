// Pre-lesson plan: syllabus topics planned for a lesson, ticked off during it (Migration 090). Pure logic,
// tested in __tests__/lessonPlan.test.ts.
import { DVSA_SYLLABUS } from './supabaseDb';

export const MAX_PLAN_TOPICS = 20;
export const MAX_PLAN_BRIEF = 500;

export type Plan = { topics: string[]; covered: string[] };

export function topicName(key: string): string {
  return DVSA_SYLLABUS.find((t) => t.key === key)?.name ?? key;
}

/** Add a topic to the plan (ignored when already there or the plan is full). */
export function addTopic(plan: Plan, key: string): Plan {
  if (plan.topics.includes(key) || plan.topics.length >= MAX_PLAN_TOPICS) return plan;
  return { ...plan, topics: [...plan.topics, key] };
}

/** Take a topic out of the plan, and out of the ticked list with it. */
export function removeTopic(plan: Plan, key: string): Plan {
  return { topics: plan.topics.filter((k) => k !== key), covered: plan.covered.filter((k) => k !== key) };
}

/** Tick or untick a planned topic. A topic that is not in the plan cannot be ticked. */
export function toggleCovered(plan: Plan, key: string): Plan {
  if (!plan.topics.includes(key)) return plan;
  return { ...plan, covered: plan.covered.includes(key) ? plan.covered.filter((k) => k !== key) : [...plan.covered, key] };
}

/** Up to three of the pupil's weakest assessed topics (level 2 of 5 or lower) that are not planned yet, to suggest. */
export function suggestTopics(
  competencies: { category_key: string; level: number; touched?: boolean }[],
  planned: string[],
): string[] {
  return competencies
    .filter((c) => c.touched !== false && c.level <= 2 && !planned.includes(c.category_key))
    .sort((a, b) => a.level - b.level)
    .slice(0, 3)
    .map((c) => c.category_key);
}

/** "Roundabouts, Parking" for the pupil's card, in plan order. */
export function planSummary(topics: string[] | null | undefined): string {
  return (topics ?? []).map(topicName).join(', ');
}
