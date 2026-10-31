import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
const mockGetLesson = jest.fn();
const mockFocus = jest.fn();
jest.mock('../supabaseDb', () => ({
  getLessonById: (...a: unknown[]) => mockGetLesson(...a),
  listMyLessonNoteQuestions: jest.fn(async () => []),
  getLastLessonFocus: (...a: unknown[]) => mockFocus(...a),
  DVSA_SYLLABUS: [{ key: 'signals', name: 'Signals' }],
}));
jest.mock('../offlineSync', () => ({ patchLessonOfflineAware: jest.fn() }));
jest.mock('../useSupabaseData', () => ({ useCompetencies: () => ({ competencies: [] }), updateCompetency: jest.fn() }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { instructor_id: 'i1' } }) }));

import { InLessonFocusCard } from '../InLessonFocusCard';

const open = async () => { await render(<InLessonFocusCard lessonId="l1" studentId="s1" studentName="Sam Lee" />); };

beforeEach(() => {
  mockPush.mockClear();
  mockGetLesson.mockReset();
  mockFocus.mockReset();
  mockGetLesson.mockResolvedValue({ date: '2099-11-01', start_time: '09:00', plan_topics: [], plan_covered: [], plan_brief: 'Test routes around Croydon' });
  mockFocus.mockResolvedValue({ lessonDate: '2099-10-25', practice: 'Clearances', goal: 'Mock test practice' });
});

describe('the lesson focus while recording', () => {
  it("shows last lesson's goal and practice points, and the briefing for this lesson", async () => {
    await open();
    expect(await screen.findByTestId('focus-goal')).toHaveTextContent(/Mock test practice/);
    expect(screen.getByTestId('focus-practice')).toHaveTextContent(/Clearances/);
    expect(screen.getByTestId('focus-briefing')).toHaveTextContent(/Test routes around Croydon/);
  });

  it('shows the topics, or says none are planned', async () => {
    await open();
    expect(await screen.findByTestId('in-lesson-topics-empty')).toBeTruthy();
  });

  it('has no briefing box when none was written', async () => {
    mockGetLesson.mockResolvedValue({ date: '2099-11-01', start_time: '09:00', plan_topics: ['signals'], plan_covered: [], plan_brief: '  ' });
    await open();
    expect(await screen.findByTestId('in-lesson-topics')).toBeTruthy();
    expect(screen.queryByTestId('focus-briefing')).toBeNull();
  });

  it("opens the pupil's profile on the competency tab", async () => {
    await open();
    await fireEvent.press(await screen.findByTestId('btn-open-pupil-profile'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/student-lifecycle-screen', params: { id: 's1', tab: 'competency' } });
  });
});
