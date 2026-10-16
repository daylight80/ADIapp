import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockBump = jest.fn();
jest.mock('../api', () => ({ api: { post: (...a: unknown[]) => mockPost(...a), delete: (...a: unknown[]) => mockDelete(...a) } }));
jest.mock('../useSupabaseData', () => ({ bump: (...a: unknown[]) => mockBump(...a) }));

import { MockDebriefCard } from '../MockDebriefCard';
import { PupilMockResultCard } from '../PupilMockResultCard';
import { generateMockDebrief, removeMockDebrief, mockDebriefErrorMessage } from '../mockDebrief';

beforeEach(() => { mockPost.mockReset(); mockDelete.mockReset().mockResolvedValue({}); mockBump.mockReset(); });

describe('calls and wording', () => {
  it('asks the backend to write one, with time to wait for the model', async () => {
    mockPost.mockResolvedValue({ data: { debrief: 'Well done.', generated_at: '2026-10-17T10:00:00Z' } });
    expect((await generateMockDebrief('a1')).debrief).toBe('Well done.');
    expect(mockPost).toHaveBeenCalledWith('/v2/mock-tests/a1/debrief', undefined, { timeout: 45000 });
  });

  it('removes one', async () => {
    await removeMockDebrief('a1');
    expect(mockDelete).toHaveBeenCalledWith('/v2/mock-tests/a1/debrief');
  });

  it('shows the backend’s own wording, but never leaks a settings problem', () => {
    expect(mockDebriefErrorMessage({ response: { data: { detail: 'Mock test not found.' } } })).toBe('Mock test not found.');
    expect(mockDebriefErrorMessage({ response: { data: { detail: 'ANTHROPIC_API_KEY not configured on backend.' } } })).toMatch(/try again/);
    expect(mockDebriefErrorMessage(new Error('Network Error'))).toMatch(/try again/);
  });
});

describe('instructor card', () => {
  it('offers to write one, then shows it with write-again and remove', async () => {
    mockPost.mockResolvedValue({ data: { debrief: 'You handled roundabouts well. Next, practise junctions.', generated_at: 'x' } });
    await render(<MockDebriefCard attemptId="a1" pupilFirstName="Sam" />);
    expect(screen.getByText('Debrief for Sam')).toBeTruthy();
    expect(screen.queryByTestId('mock-debrief-text')).toBeNull();
    expect(screen.getByText('Write a debrief')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('btn-write-debrief'));
    await waitFor(() => expect(screen.getByTestId('mock-debrief-text')).toHaveTextContent(/practise junctions/));
    expect(mockBump).toHaveBeenCalled();
    expect(screen.getByText('Write it again')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('btn-remove-debrief'));
    await waitFor(() => expect(screen.queryByTestId('mock-debrief-text')).toBeNull());
    expect(mockDelete).toHaveBeenCalledWith('/v2/mock-tests/a1/debrief');
  });

  it('shows one already attached, and tells the instructor the pupil will see it', async () => {
    await render(<MockDebriefCard attemptId="a1" pupilFirstName="Sam" existing="Already written." />);
    expect(screen.getByTestId('mock-debrief-text')).toHaveTextContent(/Already written/);
    expect(screen.getByText(/The pupil sees it on their home screen/)).toBeTruthy();
  });

  it('says what went wrong and keeps what was there', async () => {
    mockPost.mockRejectedValue({ response: { data: { detail: 'The debrief came back empty. Please try again.' } } });
    await render(<MockDebriefCard attemptId="a1" pupilFirstName="Sam" existing="Keep me." />);
    await fireEvent.press(screen.getByTestId('btn-write-debrief'));
    await waitFor(() => expect(screen.getByTestId('mock-debrief-error')).toHaveTextContent(/came back empty/));
    expect(screen.getByTestId('mock-debrief-text')).toHaveTextContent(/Keep me/);
  });
});

describe('pupil card', () => {
  const attempt = { taken_at: '2026-10-10T10:00:00Z', passed: false, driving_faults: 9, serious_faults: 1, dangerous_faults: 0, ai_debrief: 'Good effort, Sam.' };

  it('shows the result and the debrief, and says it was written by AI', async () => {
    await render(<PupilMockResultCard attempt={attempt} />);
    expect(screen.getByTestId('pupil-mock-pill')).toHaveTextContent(/Not yet/);
    expect(screen.getByTestId('pupil-mock-debrief')).toHaveTextContent(/Good effort, Sam/);
    expect(screen.getByText(/9 driving · 1 serious · 0 dangerous/)).toBeTruthy();
    expect(screen.getByText(/Written by AI from your instructor.s marks/)).toBeTruthy();
  });

  it('says Pass for a pass', async () => {
    await render(<PupilMockResultCard attempt={{ ...attempt, passed: true }} />);
    expect(screen.getByTestId('pupil-mock-pill')).toHaveTextContent(/Pass/);
  });

  it('shows nothing until the instructor has attached a debrief', async () => {
    const { rerender } = await render(<PupilMockResultCard attempt={{ ...attempt, ai_debrief: null }} />);
    expect(screen.queryByTestId('pupil-mock-result')).toBeNull();
    await rerender(<PupilMockResultCard attempt={undefined} />);
    expect(screen.queryByTestId('pupil-mock-result')).toBeNull();
  });
});
