import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

const mockPatch = jest.fn();
jest.mock('../offlineSync', () => ({ patchLessonOfflineAware: (...a: unknown[]) => mockPatch(...a) }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));

import { addTopic, removeTopic, toggleCovered, suggestTopics, planSummary, topicName, MAX_PLAN_TOPICS } from '../lessonPlan';
import { LessonPlanSection } from '../LessonPlanSection';

describe('plan logic', () => {
  const plan = { topics: ['roundabouts', 'junctions'], covered: ['junctions'] };

  it('adds a topic once, and not past the limit', () => {
    expect(addTopic(plan, 'parallel_park').topics).toEqual(['roundabouts', 'junctions', 'parallel_park']);
    expect(addTopic(plan, 'roundabouts')).toBe(plan);
    const full = { topics: Array.from({ length: MAX_PLAN_TOPICS }, (_, i) => `t${i}`), covered: [] };
    expect(addTopic(full, 'x')).toBe(full);
  });

  it('removing a topic also unticks it', () => {
    expect(removeTopic(plan, 'junctions')).toEqual({ topics: ['roundabouts'], covered: [] });
  });

  it('ticks and unticks only planned topics', () => {
    expect(toggleCovered(plan, 'roundabouts').covered).toEqual(['junctions', 'roundabouts']);
    expect(toggleCovered(plan, 'junctions').covered).toEqual([]);
    expect(toggleCovered(plan, 'motorways')).toBe(plan);
  });

  it('suggests the weakest assessed topics not already planned, at most three', () => {
    const comps = [
      { category_key: 'parallel_park', level: 1 }, { category_key: 'roundabouts', level: 2 }, { category_key: 'junctions', level: 2 },
      { category_key: 'mirrors', level: 2 }, { category_key: 'motorways', level: 1, touched: false }, { category_key: 'controls', level: 5 },
    ];
    expect(suggestTopics(comps, ['junctions'])).toEqual(['parallel_park', 'roundabouts', 'mirrors']);
  });

  it('names topics and summarises a plan for the pupil', () => {
    expect(topicName('roundabouts')).toBe('Roundabouts');
    expect(topicName('unknown_key')).toBe('unknown_key');
    expect(planSummary(['roundabouts', 'junctions'])).toBe('Roundabouts, Junctions');
    expect(planSummary(undefined)).toBe('');
  });
});

describe('LessonPlanSection', () => {
  beforeEach(() => mockPatch.mockReset().mockResolvedValue({ queued: false }));
  const lesson = { id: 'l1', plan_topics: ['roundabouts'], plan_covered: [] as string[], plan_brief: '' };
  const view = (over = {}) => render(<LessonPlanSection lesson={{ ...lesson, ...over }} suggestions={['parallel_park']} label="Lesson plan: Sam" />);

  it('ticking a planned topic saves the ticked list', async () => {
    await view();
    await fireEvent.press(screen.getByTestId('plan-tick-roundabouts'));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('l1', { plan_topics: ['roundabouts'], plan_covered: ['roundabouts'] }, 'Lesson plan: Sam'));
  });

  it('adds a suggested topic and removes one', async () => {
    await view();
    await fireEvent.press(screen.getByTestId('plan-suggest-parallel_park'));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('l1', { plan_topics: ['roundabouts', 'parallel_park'], plan_covered: [] }, expect.any(String)));
    await fireEvent.press(screen.getByTestId('plan-remove-roundabouts'));
    await waitFor(() => expect(mockPatch).toHaveBeenLastCalledWith('l1', { plan_topics: ['parallel_park'], plan_covered: [] }, expect.any(String)));
  });

  it('saves the briefing when editing ends, trimmed, and clears it when emptied', async () => {
    await view();
    await fireEvent.changeText(screen.getByTestId('plan-brief'), '  Sutton roundabouts  ');
    await fireEvent(screen.getByTestId('plan-brief'), 'endEditing');
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('l1', { plan_brief: 'Sutton roundabouts' }, expect.any(String)));
  });

  it('shows an error when saving fails', async () => {
    mockPatch.mockRejectedValue(new Error('permission denied'));
    await view();
    await fireEvent.press(screen.getByTestId('plan-tick-roundabouts'));
    expect(await screen.findByTestId('plan-error')).toHaveTextContent('permission denied');
  });

  it('lists every other syllabus topic under Add topics', async () => {
    await view();
    await fireEvent.press(screen.getByTestId('plan-add-toggle'));
    expect(screen.getByTestId('plan-add-junctions')).toBeTruthy();
    expect(screen.queryByTestId('plan-add-roundabouts')).toBeNull();
  });
});
