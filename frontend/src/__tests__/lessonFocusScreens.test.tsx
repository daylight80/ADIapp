import React from 'react';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('react-native-safe-area-context', () => { const { View } = require('react-native'); return { SafeAreaView: View }; });
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({ lessonId: 'les-1', studentId: 'stu-1', studentName: 'Maisie Harmer' }),
}));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
const mockUser: { tier: string } = { tier: 'pro' };
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { instructor_id: 'instr-1', tier: mockUser.tier } }) }));

const mockQuestions = jest.fn();
const mockGetNotes = jest.fn();
const mockSaveNotes = jest.fn();
const mockLastFocus = jest.fn();
jest.mock('../supabaseDb', () => ({
  listMyLessonNoteQuestions: (...a: unknown[]) => mockQuestions(...a),
  getLessonNotes: (...a: unknown[]) => mockGetNotes(...a),
  saveLessonNotes: (...a: unknown[]) => mockSaveNotes(...a),
  getLastLessonFocus: (...a: unknown[]) => mockLastFocus(...a),
}));
// the summary sheet is covered elsewhere: here it is just a marker
jest.mock('../LessonSummarySheet', () => {
  const { Text } = require('react-native');
  return { LessonSummarySheet: (p: any) => (p.visible ? <Text testID="summary-sheet-open">{`sheet for ${p.lessonId} / ${p.instructorId}`}</Text> : null) };
});

import LessonNotesScreen from '../../app/lesson-notes-screen';
import { LastLessonFocusCard, useLastLessonFocus } from '../LastLessonFocusCard';

const Q = [
  { id: 'q1', instructor_id: 'instr-1', question_text: 'What went well this lesson?', sort_order: 0, is_active: true },
  { id: 'q2', instructor_id: 'instr-1', question_text: 'What needs more practice?', sort_order: 1, is_active: true },
  { id: 'q3', instructor_id: 'instr-1', question_text: 'Goal for next lesson', sort_order: 2, is_active: true },
];

describe('the Lesson notes screen', () => {
  beforeEach(() => {
    mockUser.tier = 'pro';
    mockPush.mockReset();
    mockQuestions.mockReset().mockResolvedValue(Q);
    mockGetNotes.mockReset().mockResolvedValue(null);
    mockSaveNotes.mockReset().mockResolvedValue({});
  });

  it('no longer has the old generate-debrief button, and says the notes are private except the goal', async () => {
    await render(<LessonNotesScreen />);
    await waitFor(() => expect(screen.getByTestId('btn-save-lesson-notes')).toBeTruthy());
    expect(screen.queryByTestId('btn-generate-debrief')).toBeNull();
    expect(screen.queryByTestId('debrief-card')).toBeNull();
    expect(screen.getByTestId('notes-private-note')).toHaveTextContent(/private to you.*goal question/);
  });

  it('tells the instructor the goal answer will be seen by the pupil, and no other answer', async () => {
    await render(<LessonNotesScreen />);
    await waitFor(() => expect(screen.getByTestId('goal-hint-q3')).toBeTruthy());
    expect(screen.getByTestId('goal-hint-q3')).toHaveTextContent(/pupil will see this as the goal/);
    expect(screen.queryByTestId('goal-hint-q1')).toBeNull();
    expect(screen.queryByTestId('goal-hint-q2')).toBeNull();
  });

  it('offers a summary from the notes once they are saved (paid plans), opening the summary sheet for this lesson', async () => {
    await render(<LessonNotesScreen />);
    await waitFor(() => expect(screen.getByTestId('btn-write-summary-from-notes')).toBeTruthy());
    expect(screen.getByTestId('btn-write-summary-from-notes')).toHaveTextContent('Write a summary for Maisie from these notes');
    // greyed until saved
    await fireEvent.press(screen.getByTestId('btn-write-summary-from-notes'));
    expect(screen.queryByTestId('summary-sheet-open')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('input-answer-q1'), 'Smooth steering');
    await fireEvent.press(screen.getByTestId('btn-save-lesson-notes'));
    await waitFor(() => expect(mockSaveNotes).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('btn-write-summary-from-notes'));
    expect(screen.getByTestId('summary-sheet-open')).toHaveTextContent('sheet for les-1 / instr-1');
  });

  it('keeps the notes free: no summary button on a free plan', async () => {
    mockUser.tier = 'starter';
    await render(<LessonNotesScreen />);
    await waitFor(() => expect(screen.getByTestId('btn-save-lesson-notes')).toBeTruthy());
    expect(screen.queryByTestId('btn-write-summary-from-notes')).toBeNull();
  });
});

describe('the "From last lesson" card', () => {
  const focus = { lessonDate: '2026-10-19T15:00:00Z', practice: 'Parallel parking', goal: 'Test route' };

  it('shows the goal and what needs practice, with the date of the notes', async () => {
    await render(<LastLessonFocusCard focus={focus} />);
    expect(screen.getByTestId('last-lesson-focus')).toHaveTextContent(/From last lesson \(19-10-2026\)/);
    expect(screen.getByTestId('focus-goal')).toHaveTextContent('Goal for this lesson: Test route');
    expect(screen.getByTestId('focus-practice')).toHaveTextContent('Needs more practice: Parallel parking');
  });

  it('shows only what there is, and nothing when there is nothing', async () => {
    const { rerender } = await render(<LastLessonFocusCard focus={{ ...focus, practice: null }} />);
    expect(screen.queryByTestId('focus-practice')).toBeNull();
    expect(screen.getByTestId('focus-goal')).toBeTruthy();
    await rerender(<LastLessonFocusCard focus={{ ...focus, practice: null, goal: null }} />);
    expect(screen.queryByTestId('last-lesson-focus')).toBeNull();
    await rerender(<LastLessonFocusCard focus={null} />);
    expect(screen.queryByTestId('last-lesson-focus')).toBeNull();
  });

  it('is looked up for the lesson’s pupil before the lesson starts, with the instructor’s questions', async () => {
    mockQuestions.mockReset().mockResolvedValue(Q);
    mockLastFocus.mockReset().mockResolvedValue(focus);
    const { result } = await renderHook(() => useLastLessonFocus('stu-1', 'instr-1', '2026-10-22T09:00:00.000Z', true));
    await waitFor(() => expect(result.current).toEqual(focus));
    expect(mockLastFocus).toHaveBeenCalledWith('stu-1', '2026-10-22T09:00:00.000Z', Q);
  });

  it('makes no lookup when disabled or missing a pupil, and shows nothing if the lookup fails', async () => {
    mockLastFocus.mockReset();
    const off = await renderHook(() => useLastLessonFocus('stu-1', 'instr-1', '2026-10-22T09:00:00.000Z', false));
    const noPupil = await renderHook(() => useLastLessonFocus(undefined, 'instr-1', '2026-10-22T09:00:00.000Z', true));
    expect(off.result.current).toBeNull();
    expect(noPupil.result.current).toBeNull();
    expect(mockLastFocus).not.toHaveBeenCalled();
    mockLastFocus.mockRejectedValue(new Error('boom'));
    const failing = await renderHook(() => useLastLessonFocus('stu-1', 'instr-1', '2026-10-22T09:00:00.000Z', true));
    await waitFor(() => expect(mockLastFocus).toHaveBeenCalled());
    expect(failing.result.current).toBeNull();
  });
});
