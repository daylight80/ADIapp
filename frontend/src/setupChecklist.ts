/**
 * New-instructor setup checklist — the pure logic (28 Sept 2026).
 *
 * No React, no network: every rule takes plain values so it can be unit tested
 * (see __tests__/setupChecklist.test.ts). The card that shows it is
 * SetupChecklistCard.tsx.
 *
 * Every step ticks itself from data the app already has, so nobody has to
 * "mark as done". Which steps appear depends on the plan, so an instructor is
 * never asked to do something their plan can't do:
 *
 *   details          everyone EXCEPT Franchise (My Details is solo-tier only;
 *                    a Franchise instructor's details are set by the school owner)
 *   first_student    everyone
 *   first_lesson     everyone
 *   invite_student   everyone — a student with a linked account is what lets
 *                    lesson reminders and progress reach them
 *   deadline         paid plans (the Deadlines tracker is a paid feature)
 *   branding         ADI Pro tier only (where business branding is available,
 *                    same gate as My Details' "Business name and logo" link)
 *
 * Shown only to accounts created in the last NEW_ACCOUNT_DAYS days, and never
 * once dismissed or finished, so established instructors aren't nagged about
 * setup they moved past long ago.
 */
import { isFranchiseTier, isPaidTier } from './tiers';

export type ChecklistStepId =
  | 'details'
  | 'first_student'
  | 'first_lesson'
  | 'invite_student'
  | 'deadline'
  | 'branding';

/** Facts read from the database. Anything unknown is passed as its "not done" value. */
export type ChecklistSignals = {
  adiNumber?: string | null;
  mobileNumber?: string | null;
  numberPlate?: string | null;
  studentCount: number;
  /** At least one lesson exists for this instructor. */
  hasLesson: boolean;
  /** At least one student has set up their own login (auth_user_id). */
  anyStudentOnApp: boolean;
  /** Deadlines being tracked (the derived standards check counts). */
  deadlineCount: number;
  /** The school has uploaded a logo. */
  hasLogo: boolean;
};

export type ChecklistStep = {
  id: ChecklistStepId;
  title: string;
  hint: string;
  /** expo-router path the step's button opens. */
  route: string;
  done: boolean;
};

export const NEW_ACCOUNT_DAYS = 30;

const filled = (v: string | null | undefined): boolean => (v ?? '').trim().length > 0;

/** Steps that apply to a plan, in the order they are shown. */
export function stepIdsForTier(tier: string | null | undefined): ChecklistStepId[] {
  const ids: ChecklistStepId[] = [];
  if (!isFranchiseTier(tier)) ids.push('details');
  ids.push('first_student', 'first_lesson', 'invite_student');
  if (isPaidTier(tier)) ids.push('deadline');
  if (tier === 'pro') ids.push('branding');
  return ids;
}

const COPY: Record<ChecklistStepId, { title: string; hint: string; route: string }> = {
  details: {
    title: 'Complete your details',
    hint: 'Add your ADI number and mobile number.',
    route: '/profile-screen',
  },
  first_student: {
    title: 'Add your first student',
    hint: 'Add one by hand, or import from your phone contacts.',
    route: '/student-crm-screen',
  },
  first_lesson: {
    title: 'Book your first lesson',
    hint: 'Put a lesson in your diary.',
    route: '/lesson-diary-screen',
  },
  invite_student: {
    title: 'Invite a student to the app',
    hint: 'So lesson reminders and their progress reach them.',
    route: '/student-crm-screen',
  },
  deadline: {
    title: 'Add a renewal deadline',
    hint: 'MOT, insurance, ADI badge: we will remind you before each one.',
    route: '/deadlines-screen',
  },
  branding: {
    title: 'Add your logo',
    hint: 'Show your own branding on invoices and to your students.',
    route: '/school-profile-screen',
  },
};

function isDone(id: ChecklistStepId, s: ChecklistSignals): boolean {
  switch (id) {
    case 'details': return filled(s.adiNumber) && filled(s.mobileNumber);
    case 'first_student': return s.studentCount >= 1;
    case 'first_lesson': return s.hasLesson;
    case 'invite_student': return s.anyStudentOnApp;
    case 'deadline': return s.deadlineCount >= 1;
    case 'branding': return s.hasLogo;
  }
}

export function buildChecklist(signals: ChecklistSignals, tier: string | null | undefined): ChecklistStep[] {
  return stepIdsForTier(tier).map((id) => ({ id, ...COPY[id], done: isDone(id, signals) }));
}

export function checklistProgress(steps: ChecklistStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, complete: steps.length > 0 && done === steps.length };
}

/** The first step still to do, in display order. */
export function nextStep(steps: ChecklistStep[]): ChecklistStep | undefined {
  return steps.find((s) => !s.done);
}

/** True when the account is at most `days` old. A missing or unreadable date
 *  means "unknown", which is treated as NOT new: better to skip the checklist
 *  than to show it to an established instructor. */
export function withinNewAccountWindow(
  createdAt: string | null | undefined,
  now: Date = new Date(),
  days: number = NEW_ACCOUNT_DAYS,
): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  const ageMs = now.getTime() - created;
  return ageMs >= 0 && ageMs <= days * 86_400_000;
}

export function shouldShowChecklist(args: {
  steps: ChecklistStep[];
  createdAt: string | null | undefined;
  dismissed: boolean;
  now?: Date;
}): boolean {
  if (args.dismissed) return false;
  if (!withinNewAccountWindow(args.createdAt, args.now)) return false;
  const { complete, total } = checklistProgress(args.steps);
  return total > 0 && !complete;
}
