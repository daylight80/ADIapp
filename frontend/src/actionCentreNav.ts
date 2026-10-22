import type { ActionTarget } from './actionCentre';

/** The route to push for an Action Centre item: the pupil, the diary, or Deadlines. */
export function routeForTarget(target: ActionTarget): { pathname: string; params?: Record<string, string> } {
  switch (target.screen) {
    case 'student': return { pathname: '/student-lifecycle-screen', params: { id: target.studentId } };
    case 'deadlines': return { pathname: '/deadlines-screen' };
    case 'enquiries': return { pathname: '/enquiries-screen' };
    case 'diary':
    default: return { pathname: '/lesson-diary-screen' };
  }
}
