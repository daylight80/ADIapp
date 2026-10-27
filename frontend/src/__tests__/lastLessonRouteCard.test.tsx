import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockList = jest.fn();
jest.mock('../routeRecorder', () => ({
  ...jest.requireActual('../routeRecorder'),
  listRoutesForStudent: (...a: any[]) => mockList(...a),
}));

import { LastLessonRouteCard, lastCompletedLesson, sketchLines } from '../LastLessonRouteCard';

const lessons = [
  { id: 'a', date: '2026-10-01', start_time: '09:00', status: 'Completed' },
  { id: 'b', date: '2026-10-08', start_time: '10:00', status: 'Completed' },
  { id: 'c', date: '2026-10-15', start_time: '10:00', status: 'Scheduled' },
];
const pt = (lat: number, lng: number, brk = false) => ({ lat, lng, t: 0, brk });

describe('lastCompletedLesson', () => {
  it('picks the newest completed lesson and ignores upcoming ones', () => {
    expect(lastCompletedLesson(lessons)?.id).toBe('b');
    expect(lastCompletedLesson([lessons[2]])).toBeNull();
  });
});

describe('sketchLines', () => {
  it('needs two points, keeps points inside the box, and splits at a pause', () => {
    expect(sketchLines([pt(51, 0)], 120)).toEqual([]);
    const lines = sketchLines([pt(51, 0), pt(51.01, 0.01), pt(51.02, 0.02, true), pt(51.03, 0.03)], 120);
    expect(lines).toHaveLength(2);
    for (const n of lines.join(' ').split(/[ ,]/).map(Number)) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(120); }
  });
});

describe('LastLessonRouteCard', () => {
  it('shows the route for the last lesson', async () => {
    mockList.mockResolvedValue([{ id: 'r', lessonId: 'b', distanceMeters: 8046, durationSec: 3600, points: [pt(51, 0), pt(51.01, 0.01)] }]);
    const { findByTestId } = await render(<LastLessonRouteCard studentId="s" lessons={lessons} />);
    expect(await findByTestId('last-route-card')).toBeTruthy();
  });

  it('nudges when the last lesson has no route, even if an older lesson has one', async () => {
    mockList.mockResolvedValue([{ id: 'r', lessonId: 'a', distanceMeters: 1, durationSec: 1, points: [] }]);
    const { findByTestId, queryByTestId } = await render(<LastLessonRouteCard studentId="s" lessons={lessons} />);
    expect(await findByTestId('last-route-missing')).toBeTruthy();
    expect(queryByTestId('last-route-card')).toBeNull();
  });

  it('shows nothing when no lesson has been completed', async () => {
    mockList.mockResolvedValue([]);
    const { queryByTestId } = await render(<LastLessonRouteCard studentId="s" lessons={[lessons[2]]} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(queryByTestId('last-route-missing')).toBeNull();
  });
});
