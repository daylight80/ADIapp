import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a) }) }));

import { LessonRowLinks, mockTestsForRoutes } from '../LessonRowLinks';

const route = { id: 'r1' } as any;
const attempt = (over = {}) => ({
  id: 'a1', route_id: 'r1', driving_faults: 4, serious_faults: 0, dangerous_faults: 0, passed: true, category_breakdown: {}, ...over,
}) as any;
const note = { lesson_id: 'l1', answers: { q1: 'Smooth steering', q2: '  ' } } as any;
const base = { lessonId: 'l1', studentId: 's1', studentName: 'Sam Smith', routes: [route], attempts: [attempt()], questionText: { q1: 'What went well?' } };

beforeEach(() => mockPush.mockReset());

describe('mockTestsForRoutes', () => {
  it('keeps only tests run during one of the lesson\'s recordings', () => {
    const got = mockTestsForRoutes([attempt(), attempt({ id: 'a2', route_id: 'other' }), attempt({ id: 'a3', route_id: null })], [route]);
    expect(got.map((a) => a.id)).toEqual(['a1']);
  });
});

describe('LessonRowLinks', () => {
  it('lists a linked mock test and opens its report with the recording id', async () => {
    await render(<LessonRowLinks {...base} />);
    await fireEvent.press(screen.getByTestId('lesson-mock-a1'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/dl25-report-screen',
      params: { d: '4', s: '0', x: '0', passed: '1', breakdown: '{}', studentId: 's1', routeId: 'r1' },
    });
  });

  it('shows no mock test row when none was run during the lesson', async () => {
    await render(<LessonRowLinks {...base} attempts={[]} />);
    expect(screen.queryByTestId('lesson-mock-a1')).toBeNull();
  });

  it('expands the instructor\'s notes in place (blank answers left out) and offers Edit', async () => {
    await render(<LessonRowLinks {...base} note={note} />);
    expect(screen.queryByTestId('lesson-notes-l1')).toBeNull();
    await fireEvent.press(screen.getByTestId('lesson-notes-toggle-l1'));
    expect(screen.getByText('What went well?')).toBeTruthy();
    expect(screen.getByText('Smooth steering')).toBeTruthy();
    expect(screen.queryByText('Question')).toBeNull();
    await fireEvent.press(screen.getByTestId('lesson-notes-edit-l1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/lesson-notes-screen', params: { lessonId: 'l1', studentId: 's1', studentName: 'Sam Smith' } });
  });

  it('offers Add notes when the lesson has none', async () => {
    await render(<LessonRowLinks {...base} note={undefined} />);
    await fireEvent.press(screen.getByTestId('lesson-notes-add-l1'));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/lesson-notes-screen' }));
  });
});

describe('the summary button on a lesson row', () => {
  it('is offered once the lesson has saved notes, and opens the summary', async () => {
    const onSummary = jest.fn();
    await render(<LessonRowLinks {...base} note={note} onSummary={onSummary} />);
    expect(screen.getByTestId('lesson-summary-l1')).toHaveTextContent('Write a summary for Sam');
    await fireEvent.press(screen.getByTestId('lesson-summary-l1'));
    expect(onSummary).toHaveBeenCalledTimes(1);
  });

  it('is not offered before there are saved notes', async () => {
    await render(<LessonRowLinks {...base} onSummary={jest.fn()} />);
    expect(screen.queryByTestId('lesson-summary-l1')).toBeNull();
  });

  it('is not offered when only blank answers were saved', async () => {
    await render(<LessonRowLinks {...base} note={{ lesson_id: 'l1', answers: { q1: '  ' } } as any} onSummary={jest.fn()} />);
    expect(screen.queryByTestId('lesson-summary-l1')).toBeNull();
  });

  it('is not offered on a free plan (the screen passes no handler)', async () => {
    await render(<LessonRowLinks {...base} note={note} />);
    expect(screen.queryByTestId('lesson-summary-l1')).toBeNull();
  });
});
