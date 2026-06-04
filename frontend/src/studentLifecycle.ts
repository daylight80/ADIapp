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
