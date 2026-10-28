import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = { studentId: 'stu-1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../BottomNav', () => ({ BottomNav: () => null }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../useSupabaseData', () => ({
  useStudent: () => ({ student: { id: 'stu-1', name: 'Test Pupil' } }),
  useStudentByAuthId: () => ({ student: undefined }),
  useStudentByEmail: () => ({ student: undefined }),
  awardMockPassBadge: jest.fn(),
}));
const mockAdd = jest.fn();
jest.mock('../supabaseDb', () => ({ addMockTestAttempt: (...a: unknown[]) => mockAdd(...a) }));

import Dl25MockTestScreen from '../../app/dl25-mock-test-screen';

beforeEach(() => { mockPush.mockReset(); mockReplace.mockReset(); mockParams = { studentId: 'stu-1' }; mockAdd.mockReset().mockResolvedValue({}); });

describe('DL25 mock test screen', () => {
  it('shows the car items in form order and none of the ones that do not apply', async () => {
    await render(<Dl25MockTestScreen />);
    expect(screen.getByTestId('item-1a')).toBeTruthy();
    expect(screen.getByTestId('item-21')).toBeTruthy();
    expect(screen.getByTestId('item-27')).toBeTruthy();
    for (const n of ['9', '10', '28', '29', '30', '31', '32', '33']) expect(screen.queryByTestId(`item-${n}`)).toBeNull();
    expect(screen.queryByText(/balance|door exercise|wheelchair|spare/i)).toBeNull();
  });

  it('the eyesight line only takes a serious fault', async () => {
    await render(<Dl25MockTestScreen />);
    expect(screen.queryByTestId('dl25_1a-driving-add')).toBeNull();
    expect(screen.queryByTestId('dl25_1a-dangerous-add')).toBeNull();
    expect(screen.getByTestId('dl25_1a-serious-add')).toBeTruthy();
    expect(screen.getByTestId('dl25_13_safety-driving-add')).toBeTruthy();
  });

  it('counts faults into the totals and saves each line with its name', async () => {
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('dl25_13_safety-serious-add'));
    expect(screen.getByTestId('summary-driving')).toHaveTextContent(/^2/);
    expect(screen.getByTestId('summary-serious')).toHaveTextContent(/^1/);
    await fireEvent.press(screen.getByTestId('btn-finish-test'));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    const saved = mockAdd.mock.calls[0][0];
    expect(saved).toMatchObject({ student_id: 'stu-1', driving_faults: 2, serious_faults: 1, dangerous_faults: 0, passed: false });
    expect(saved.category_breakdown.dl25_21_right).toEqual({ driving: 2, serious: 0, dangerous: 0, label: '21 Junctions – turning right' });
    expect(Object.keys(saved.category_breakdown).length).toBeGreaterThan(40);
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });

  it('run from the Route Recorder: saves a copy, then replaces itself with the report so back lands on the recording', async () => {
    mockParams = { studentId: 'stu-1', from: 'recorder' };
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('btn-finish-test'));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/dl25-report-screen', params: expect.objectContaining({ from: 'recorder', studentId: 'stu-1' }) })));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('passes with up to 15 driving faults and nothing serious', async () => {
    await render(<Dl25MockTestScreen />);
    for (let i = 0; i < 15; i += 1) await fireEvent.press(screen.getByTestId('dl25_18-driving-add'));
    await fireEvent.press(screen.getByTestId('btn-finish-test'));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd.mock.calls[0][0].passed).toBe(true);
  });
});
