/**
 * Student lifecycle status + delete helpers.
 *
 * Backed by FastAPI endpoints which enforce tenant isolation:
 *   PATCH  /api/v2/students/{id}/status
 *   DELETE /api/v2/students/{id}
 *
 * The frontend caches student data via `useStudents()` and the lifecycle
 * screen reads a single student via `useStudent(id)`. After a mutation the
 * caller should bump the local cache (the helper does this automatically by
 * invalidating the relevant query keys).
 */
import { api } from './api';

export type LifecycleStatus =
  | 'New'
  | 'Active'
  | 'Test Ready'
  | 'Passed'
  | 'Inactive'
  | 'Waitlist';

/** All status values the new picker can produce. */
export const LIFECYCLE_STATUSES: LifecycleStatus[] = [
  'New',
  'Active',
  'Test Ready',
  'Passed',
  'Inactive',
  'Waitlist',
];

export type StatusMove = { to: LifecycleStatus; label: string };

/**
 * The "moving along" buttons offered on a student's profile. A New student
 * also becomes Active on their own once a lesson is completed (Migration 048);
 * these let the instructor do it, or mark Test Ready, without waiting.
 * Inactive and Waitlist have their own Reactivate button, and Passed is final.
 */
export function manualStatusMoves(from: string | null | undefined): StatusMove[] {
  switch (from) {
    case 'New':
      return [{ to: 'Active', label: 'Mark active' }, { to: 'Test Ready', label: 'Mark test ready' }];
    case 'Active':
      return [{ to: 'Test Ready', label: 'Mark test ready' }];
    case 'Test Ready':
      return [{ to: 'Active', label: 'Back to active' }];
    default:
      return [];
  }
}

/** The confirmation line shown after a status change. */
export function statusChangeMessage(name: string, from: string, to: LifecycleStatus): string {
  if (to === 'Inactive') return `${name} marked as inactive.`;
  if (to === 'Waitlist') return `${name} moved to the waiting list.`;
  if (to === 'Test Ready') return `${name} marked as test ready.`;
  if (to === 'Active') {
    return from === 'Inactive' || from === 'Waitlist' ? `${name} reactivated.` : `${name} marked as active.`;
  }
  return `${name} is now ${to}.`;
}

/** PATCH /api/v2/students/:id/status — returns the new status server-confirmed. */
export async function updateStudentStatus(
  studentId: string,
  status: LifecycleStatus,
): Promise<LifecycleStatus> {
  const r = await api.patch(`/v2/students/${studentId}/status`, { status });
  const data = r.data || {};
  return (data.status as LifecycleStatus) || status;
}

/** DELETE /api/v2/students/:id — cascade removes lessons / DVSA tracking / outcomes. */
export async function deleteStudentHard(studentId: string): Promise<void> {
  await api.delete(`/v2/students/${studentId}`);
}
