import { renderHook, waitFor } from '@testing-library/react-native';

const mockGoal = jest.fn();
jest.mock('../lessonSummary', () => ({ fetchMyNextGoal: (...a: unknown[]) => mockGoal(...a) }));
jest.mock('../useSupabaseData', () => ({ useVersion: () => 0 }));

import { usePupilGoal } from '../usePupilGoal';

describe('usePupilGoal', () => {
  beforeEach(() => mockGoal.mockReset());

  it('gives the goal the instructor set for the next lesson', async () => {
    mockGoal.mockResolvedValue({ goal: 'Practise the test route', from_lesson: 'a', next_lesson: 'b' });
    const { result } = await renderHook(() => usePupilGoal(true));
    await waitFor(() => expect(result.current?.goal).toBe('Practise the test route'));
  });

  it('is empty when there is no goal, when it fails, and when switched off', async () => {
    mockGoal.mockResolvedValue(null);
    const none = await renderHook(() => usePupilGoal(true));
    await waitFor(() => expect(mockGoal).toHaveBeenCalled());
    expect(none.result.current).toBeNull();

    mockGoal.mockReset().mockRejectedValue(new Error('boom'));
    const failing = await renderHook(() => usePupilGoal(true));
    await waitFor(() => expect(mockGoal).toHaveBeenCalled());
    expect(failing.result.current).toBeNull();

    mockGoal.mockReset();
    const off = await renderHook(() => usePupilGoal(false));
    expect(off.result.current).toBeNull();
    expect(mockGoal).not.toHaveBeenCalled();
  });
});
