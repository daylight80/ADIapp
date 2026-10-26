import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { lessonToRate, confidenceSummary } from '../pupilConfidence';
import { PupilConfidenceCard } from '../PupilConfidenceCard';
import { buildDrivingProfile } from '../drivingProfile';

const done = (date: string, over: Record<string, unknown> = {}) => ({ date, start_time: '10:00', end_time: '11:00', status: 'Completed', ...over });
const NOW = new Date('2026-10-26T12:00:00');

describe('lessonToRate', () => {
  it('asks about the most recent completed lesson when it is unrated and within a week', () => {
    const lessons = [done('2026-10-10'), done('2026-10-24')];
    expect(lessonToRate(lessons, NOW)).toBe(lessons[1]);
  });

  it('does not ask once rated, when the lesson is old, or when nothing is completed', () => {
    expect(lessonToRate([done('2026-10-24', { pupil_confidence: 4 })], NOW)).toBeUndefined();
    expect(lessonToRate([done('2026-10-10')], NOW)).toBeUndefined();
    expect(lessonToRate([done('2026-10-25', { status: 'Scheduled' })], NOW)).toBeUndefined();
  });

  it('only asks about the latest lesson, never an older unrated one', () => {
    expect(lessonToRate([done('2026-10-22'), done('2026-10-24', { pupil_confidence: 3 })], NOW)).toBeUndefined();
  });
});

describe('confidenceSummary', () => {
  it('is null until the pupil has rated a lesson', () => {
    expect(confidenceSummary([done('2026-10-24')])).toBeNull();
  });

  it('gives the latest rating and the average of the last five, to one decimal', () => {
    const lessons = [1, 2, 3, 4, 5, 5].map((n, i) => done(`2026-10-0${i + 1}`, { pupil_confidence: n }));
    expect(confidenceSummary(lessons)).toEqual({ latest: 5, average: 3.8, count: 5 });
  });
});

describe('driving profile', () => {
  it('carries the confidence summary, so the instructor sees it', () => {
    const p = buildDrivingProfile({ competencies: [], lessons: [done('2026-10-24', { pupil_confidence: 2 })], focus: null, unmetCriteria: [] });
    expect(p.confidence).toEqual({ latest: 2, average: 2, count: 1 });
  });
});

describe('PupilConfidenceCard', () => {
  it('sends the tapped score', async () => {
    const onRate = jest.fn().mockResolvedValue(undefined);
    await render(<PupilConfidenceCard onRate={onRate} />);
    await fireEvent.press(screen.getByTestId('confidence-4'));
    await waitFor(() => expect(onRate).toHaveBeenCalledWith(4));
  });

  it('shows why it failed and lets the pupil try again', async () => {
    const onRate = jest.fn().mockRejectedValueOnce(new Error('You can rate a lesson once it has finished.')).mockResolvedValue(undefined);
    await render(<PupilConfidenceCard onRate={onRate} />);
    await fireEvent.press(screen.getByTestId('confidence-3'));
    expect((await screen.findByTestId('confidence-error')).props.children).toBe('You can rate a lesson once it has finished.');
    await fireEvent.press(screen.getByTestId('confidence-3'));
    await waitFor(() => expect(screen.queryByTestId('confidence-error')).toBeNull());
  });
});
