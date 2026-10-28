import type { MockTestAttempt } from './supabaseDb';

/** One line for a saved mock test: result and fault counts. */
export const mockTestLabel = (m: MockTestAttempt): string =>
  `Mock test · ${m.passed ? 'PASS' : 'FAIL'} · ${m.driving_faults} driving, ${m.serious_faults} serious, ${m.dangerous_faults} dangerous`;

/** The router target that opens a saved mock test's report, linked back to its recording. */
export const mockReportRoute = (m: MockTestAttempt, studentId?: string | null) => ({
  pathname: '/dl25-report-screen',
  params: {
    d: String(m.driving_faults), s: String(m.serious_faults), x: String(m.dangerous_faults),
    passed: m.passed ? '1' : '0', breakdown: JSON.stringify(m.category_breakdown),
    routeId: m.route_id as string, ...(studentId ? { studentId } : {}),
  },
});
