// "Where students need help" on Home: a topic only counts once it has really been assessed. Every pupil's topics
// start at level 1 (seeded), which used to make every pupil look like they were struggling with everything.
const mockList = jest.fn();
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../supabaseDb', () => ({
  ...jest.requireActual('../supabaseDb'),
  listCompetenciesForStudents: (...a: unknown[]) => mockList(...a),
}));

import { renderHook, waitFor } from '@testing-library/react-native';
import { useCompetencyPatterns } from '../useSupabaseData';
import { wasEdited } from '../supabaseDb';

const row = (student_id: string, category_key: string, level: number, touched?: boolean) => ({
  id: `${student_id}-${category_key}`, student_id, category_key, category_name: category_key, level, progress: 0, touched,
});

describe('wasEdited', () => {
  it('is false for a row left as seeded and true once it has been changed later', () => {
    expect(wasEdited('2026-10-21T10:00:00Z', '2026-10-21T10:00:00Z')).toBe(false);
    expect(wasEdited('2026-10-21T10:00:00Z', '2026-10-21T10:00:02Z')).toBe(false);
    expect(wasEdited('2026-10-21T10:00:00Z', '2026-10-22T09:00:00Z')).toBe(true);
  });
  it('does not hide data when the dates are missing', () => {
    expect(wasEdited(undefined, undefined)).toBe(true);
    expect(wasEdited(null, '2026-10-22T09:00:00Z')).toBe(true);
  });
});

describe('useCompetencyPatterns', () => {
  beforeEach(() => mockList.mockReset());

  it('ignores topics nobody has assessed yet', async () => {
    mockList.mockResolvedValue([
      row('a', 'eyesight', 1, false), row('b', 'eyesight', 1, false), row('c', 'eyesight', 1, false),
    ]);
    const { result } = await renderHook(() => useCompetencyPatterns(['a', 'b', 'c']));
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.patterns).toEqual([]);
  });

  it('reports a pattern when two or more pupils have been assessed as struggling', async () => {
    mockList.mockResolvedValue([
      row('a', 'junctions', 2, true), row('b', 'junctions', 1, true), row('c', 'junctions', 4, true),
      row('a', 'eyesight', 1, false), row('b', 'eyesight', 1, false),
    ]);
    const { result } = await renderHook(() => useCompetencyPatterns(['a', 'b', 'c']));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.patterns).toEqual([
      { category_key: 'junctions', category_name: 'junctions', studentsStruggling: 2, studentsAssessed: 3 },
    ]);
  });

  it('still needs at least two pupils, not one', async () => {
    mockList.mockResolvedValue([row('a', 'junctions', 1, true), row('b', 'junctions', 5, true)]);
    const { result } = await renderHook(() => useCompetencyPatterns(['a', 'b']));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.patterns).toEqual([]);
  });
});
