// getLastLessonFocus: which earlier lesson's notes are used for the "From last lesson" card.
const mockLessons = jest.fn();
const mockNotes = jest.fn();
const calls: Record<string, any[]> = {};
jest.mock('../supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      calls[table] = [];
      const q: any = {};
      const chain = (name: string) => (...a: unknown[]) => { calls[table].push([name, ...a]); return q; };
      for (const m of ['select', 'eq', 'lt', 'neq', 'order', 'limit', 'in']) q[m] = chain(m);
      q.then = (resolve: any) => resolve(table === 'lessons' ? mockLessons() : mockNotes());
      return q;
    },
  },
}));

import { getLastLessonFocus } from '../supabaseDb';

const Q = [
  { id: 'q2', instructor_id: 'i', question_text: 'What needs more practice?', sort_order: 1, is_active: true },
  { id: 'q3', instructor_id: 'i', question_text: 'Goal for next lesson', sort_order: 2, is_active: true },
];

beforeEach(() => { mockLessons.mockReset(); mockNotes.mockReset(); });

describe('getLastLessonFocus', () => {
  it('uses the most recent earlier lesson that has a practice or goal answer, skipping ones with no notes', async () => {
    mockLessons.mockReturnValue({ data: [{ id: 'l3', start_time: '2026-10-20T09:00:00Z' }, { id: 'l2', start_time: '2026-10-13T09:00:00Z' }, { id: 'l1', start_time: '2026-10-06T09:00:00Z' }], error: null });
    mockNotes.mockReturnValue({ data: [{ lesson_id: 'l2', answers: { q2: 'Mirrors', q3: 'Roundabouts' } }, { lesson_id: 'l1', answers: { q3: 'Older goal' } }], error: null });
    await expect(getLastLessonFocus('stu-1', '2026-10-22T09:00:00Z', Q as any)).resolves.toEqual({
      lessonDate: '2026-10-13T09:00:00Z', practice: 'Mirrors', goal: 'Roundabouts',
    });
  });

  it('skips a lesson whose notes answered neither question', async () => {
    mockLessons.mockReturnValue({ data: [{ id: 'l2', start_time: '2026-10-13T09:00:00Z' }, { id: 'l1', start_time: '2026-10-06T09:00:00Z' }], error: null });
    mockNotes.mockReturnValue({ data: [{ lesson_id: 'l2', answers: { q9: 'something else', q3: '  ' } }, { lesson_id: 'l1', answers: { q3: 'Older goal' } }], error: null });
    const r = await getLastLessonFocus('stu-1', '2026-10-22T09:00:00Z', Q as any);
    expect(r).toMatchObject({ lessonDate: '2026-10-06T09:00:00Z', goal: 'Older goal', practice: null });
  });

  it('asks only for this pupil’s earlier lessons that were not cancelled, newest first', async () => {
    mockLessons.mockReturnValue({ data: [], error: null });
    await getLastLessonFocus('stu-1', '2026-10-22T09:00:00Z', Q as any);
    const c = calls.lessons;
    expect(c).toEqual(expect.arrayContaining([
      ['eq', 'student_id', 'stu-1'], ['lt', 'start_time', '2026-10-22T09:00:00Z'], ['neq', 'status', 'Cancelled'],
      ['order', 'start_time', { ascending: false }], ['limit', 6],
    ]));
  });

  it('is null with no earlier lessons or no notes, and passes a read error on', async () => {
    mockLessons.mockReturnValue({ data: [], error: null });
    await expect(getLastLessonFocus('s', 'x', Q as any)).resolves.toBeNull();
    mockLessons.mockReturnValue({ data: [{ id: 'l1', start_time: 't' }], error: null });
    mockNotes.mockReturnValue({ data: [], error: null });
    await expect(getLastLessonFocus('s', 'x', Q as any)).resolves.toBeNull();
    mockLessons.mockReturnValue({ data: null, error: new Error('denied') });
    await expect(getLastLessonFocus('s', 'x', Q as any)).rejects.toThrow('denied');
  });
});
