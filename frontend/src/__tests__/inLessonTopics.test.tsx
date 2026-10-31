import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../supabaseClient', () => ({ supabase: {} }));
const mockGetLesson = jest.fn();
jest.mock('../supabaseDb', () => ({
  getLessonById: (...a: unknown[]) => mockGetLesson(...a),
  DVSA_SYLLABUS: [{ key: 'signals', name: 'Signals' }, { key: 'roundabouts', name: 'Roundabouts' }],
}));
const mockPatch = jest.fn();
jest.mock('../offlineSync', () => ({ patchLessonOfflineAware: (...a: unknown[]) => mockPatch(...a) }));
const mockUpdate = jest.fn();
let mockComps: any[] = [];
jest.mock('../useSupabaseData', () => ({
  useCompetencies: () => ({ competencies: mockComps }),
  updateCompetency: (...a: unknown[]) => mockUpdate(...a),
}));

import { InLessonTopicsCard } from '../InLessonTopicsCard';
import { shouldAutostart } from '../routeRecorder';

const open = async () => { await render(<InLessonTopicsCard lessonId="l1" studentId="s1" studentName="Sam Lee" />); };

beforeEach(() => {
  [mockGetLesson, mockPatch, mockUpdate].forEach((m) => m.mockReset());
  mockPatch.mockResolvedValue({ queued: false });
  mockUpdate.mockResolvedValue({});
  mockGetLesson.mockResolvedValue({ plan_topics: ['signals', 'roundabouts'], plan_covered: ['signals'] });
  mockComps = [{ category_key: 'signals', level: 3 }, { category_key: 'roundabouts', level: 1 }];
});

describe('InLessonTopicsCard', () => {
  it('lists the planned topics with the pupil\'s level on each and the ticked ones marked', async () => {
    await open();
    expect(await screen.findByTestId('topic-tick-signals')).toBeTruthy();
    expect(screen.getByTestId('topic-level-signals').props.children.join('')).toContain('3 of 5');
    expect(screen.getByTestId('topic-level-roundabouts').props.children.join('')).toContain('1 of 5');
    expect(screen.getByTestId('topic-tick-signals').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('topic-tick-roundabouts').props.accessibilityState).toEqual({ checked: false });
  });

  it('ticking a topic saves the lesson with it covered', async () => {
    await open();
    await fireEvent.press(await screen.findByTestId('topic-tick-roundabouts'));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('l1', { plan_topics: ['signals', 'roundabouts'], plan_covered: ['signals', 'roundabouts'] }, 'Lesson plan: Sam Lee'));
  });

  it('+ and - move the level by one, and - does nothing at level 1', async () => {
    await open();
    await fireEvent.press(await screen.findByTestId('topic-up-signals'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('s1', 'signals', { level: 4 }));
    await fireEvent.press(screen.getByTestId('topic-down-roundabouts')); // already at 1
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('+ does nothing at level 5', async () => {
    mockComps = [{ category_key: 'signals', level: 5 }, { category_key: 'roundabouts', level: 1 }];
    await open();
    await fireEvent.press(await screen.findByTestId('topic-up-signals'));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('says so when a level change cannot be saved', async () => {
    mockUpdate.mockRejectedValue(new Error('permission denied'));
    await open();
    await fireEvent.press(await screen.findByTestId('topic-up-signals'));
    expect((await screen.findByTestId('topics-error')).props.children).toBe('permission denied');
  });

  it('says so, rather than vanishing, when the lesson has no plan', async () => {
    mockGetLesson.mockResolvedValue({ plan_topics: [], plan_covered: [] });
    await open();
    expect(await screen.findByTestId('in-lesson-topics-empty')).toBeTruthy();
    expect(screen.queryByTestId('in-lesson-topics')).toBeNull();
  });
});

describe('shouldAutostart', () => {
  const base = { autostart: '1', lessonId: 'l1', alreadyStarted: false, isRecording: false, isPaid: true };
  it('starts once, for a paid plan, on a linked lesson, when asked to', () => {
    expect(shouldAutostart(base)).toBe(true);
  });
  it('does not start without the flag, without a lesson, twice, while recording, or on Starter', () => {
    expect(shouldAutostart({ ...base, autostart: undefined })).toBe(false);
    expect(shouldAutostart({ ...base, lessonId: undefined })).toBe(false);
    expect(shouldAutostart({ ...base, alreadyStarted: true })).toBe(false);
    expect(shouldAutostart({ ...base, isRecording: true })).toBe(false);
    expect(shouldAutostart({ ...base, isPaid: false })).toBe(false);
  });
});
