import { verdictSub } from '../dl25Verdict';
import { mockReportRoute, mockTestLabel } from '../mockTestLink';

const base = { driving: 0, serious: 0, dangerous: 0 };

describe('verdictSub', () => {
  it('keeps the pupil messages for a pupil', () => {
    expect(verdictSub({ ...base, passed: true, instructor: false })).toBe('Well done! You have met DVSA test standards.');
    expect(verdictSub({ ...base, serious: 1, passed: false, instructor: false })).toBe('Not quite there yet. Review the faults below and keep practising.');
  });

  it('tells an instructor a pass would pass a real test', () => {
    expect(verdictSub({ ...base, driving: 4, passed: true, instructor: true })).toMatch(/^Would pass a real test/);
  });

  it('tells an instructor exactly why a real test would fail', () => {
    expect(verdictSub({ driving: 1, serious: 1, dangerous: 1, passed: false, instructor: true }))
      .toBe('Would not pass a real test: 1 dangerous fault, 1 serious fault.');
    expect(verdictSub({ driving: 16, serious: 2, dangerous: 0, passed: false, instructor: true }))
      .toBe('Would not pass a real test: 2 serious faults, 16 driving faults (15 allowed).');
    expect(verdictSub({ driving: 16, serious: 0, dangerous: 0, passed: false, instructor: true }))
      .toBe('Would not pass a real test: 16 driving faults (15 allowed).');
  });
});

describe('mock test link helpers', () => {
  const m: any = { id: 'a1', route_id: 'r1', driving_faults: 4, serious_faults: 0, dangerous_faults: 1, passed: false, category_breakdown: { x: 1 } };

  it('writes one line for a saved test', () => {
    expect(mockTestLabel(m)).toBe('Mock test · FAIL · 4 driving, 0 serious, 1 dangerous');
  });

  it('opens its report with the recording id and the pupil', () => {
    expect(mockReportRoute(m, 's1')).toEqual({
      pathname: '/dl25-report-screen',
      params: { d: '4', s: '0', x: '1', passed: '0', breakdown: '{"x":1}', routeId: 'r1', studentId: 's1' },
    });
    expect((mockReportRoute(m, null).params as any).studentId).toBeUndefined();
  });
});
