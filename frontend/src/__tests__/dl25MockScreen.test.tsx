import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { studentId: 'stu-1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: (...a: unknown[]) => mockBack(...a) }),
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
import { emptyDl25Faults } from '../dl25Items';
import { clearMockDraft, getMockDraft, saveMockDraft, setLiveRecording } from '../recordingSession';

beforeEach(() => { mockPush.mockReset(); mockReplace.mockReset(); mockBack.mockReset(); setLiveRecording(null); clearMockDraft('route-9'); mockParams = { studentId: 'stu-1' }; mockAdd.mockReset().mockResolvedValue({}); });

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
    mockParams = { studentId: 'stu-1', from: 'recorder', routeId: 'route-9' };
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('btn-finish-test'));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd.mock.calls[0][0].route_id).toBe('route-9'); // linked to the recording
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/dl25-report-screen', params: expect.objectContaining({ from: 'recorder', studentId: 'stu-1', routeId: 'route-9' }) })));
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

describe('DL25 mock test run from the Route Recorder', () => {
  beforeEach(() => { mockParams = { studentId: 'stu-1', from: 'recorder', routeId: 'route-9' }; });

  it('saves the marks as they are entered', async () => {
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    expect(getMockDraft('route-9')!.faults.dl25_21_right.driving).toBe(2);
    expect(getMockDraft('route-9')!.events).toHaveLength(2);
  });

  it('opens with the marks kept from before, when the instructor returns to the test', async () => {
    const kept = emptyDl25Faults();
    kept.dl25_21_right.driving = 2;
    saveMockDraft('route-9', { faults: kept, events: [] });
    await render(<Dl25MockTestScreen />);
    expect(screen.getByTestId('summary-driving')).toHaveTextContent(/^2/);
    expect(screen.getByTestId('dl25_21_right-driving-val')).toHaveTextContent('2');
  });

  it('goes back without asking, because nothing is lost', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('btn-back'));
    expect(alert).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('forgets the marks once the test is finished, so a Retake starts clean', async () => {
    saveMockDraft('route-9', { faults: { ...emptyDl25Faults() }, events: [] });
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('btn-finish-test'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(getMockDraft('route-9')).toBeUndefined();
  });

  it('shows that the recording is still running, with its timer', async () => {
    setLiveRecording({ routeId: 'route-9', bankedMs: 65_000, runStartedAt: null });
    await render(<Dl25MockTestScreen />);
    expect(screen.getByTestId('mock-recording-bar')).toBeTruthy();
    expect(screen.getByText(/Recording paused · 1m 05s/)).toBeTruthy();
  });

  it('shows no recording bar for a test run on its own', async () => {
    mockParams = { studentId: 'stu-1' };
    setLiveRecording({ routeId: 'route-9', bankedMs: 1000, runStartedAt: null });
    await render(<Dl25MockTestScreen />);
    expect(screen.queryByTestId('mock-recording-bar')).toBeNull();
  });
});

describe('DL25 mock test run on its own', () => {
  it('asks before leaving with marks entered, and leaves only when told to', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('btn-back'));
    expect(alert).not.toHaveBeenCalled(); // nothing marked yet: just goes back
    expect(mockBack).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('btn-back'));
    expect(alert).toHaveBeenCalledWith('Leave the mock test?', expect.any(String), expect.any(Array));
    expect(mockBack).toHaveBeenCalledTimes(1); // still here
    const leave = (alert.mock.calls[0][2] as any[]).find((b) => b.text === 'Leave');
    leave.onPress();
    expect(mockBack).toHaveBeenCalledTimes(2);
    alert.mockRestore();
  });
});

describe('DL25 mock test: when each fault was marked', () => {
  beforeEach(() => { mockParams = { studentId: 'stu-1', from: 'recorder', routeId: 'route-9' }; });

  it('notes the line, the kind and the time of each fault', async () => {
    await render(<Dl25MockTestScreen />);
    const before = Date.now();
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('dl25_13_safety-serious-add'));
    const ev = getMockDraft('route-9')!.events;
    expect(ev.map((e) => [e.key, e.type])).toEqual([['dl25_21_right', 'driving'], ['dl25_13_safety', 'serious']]);
    expect(ev[0].t).toBeGreaterThanOrEqual(before);
  });

  it('takes off the latest matching event when a fault is removed, and ignores minus at zero', async () => {
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-sub')); // nothing to remove
    expect(getMockDraft('route-9')!.events).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-sub'));
    expect(getMockDraft('route-9')!.events).toHaveLength(1);
  });

  it('saves them with the attempt and hands them to the report', async () => {
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('btn-finish-test'));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    const saved = mockAdd.mock.calls[0][0];
    expect(saved.fault_events).toEqual([expect.objectContaining({ key: 'dl25_21_right', type: 'driving' })]);
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const params = mockReplace.mock.calls[0][0].params;
    expect(JSON.parse(params.events)).toEqual(saved.fault_events);
  });

  it('clears them on Reset', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('btn-reset'));
    (alert.mock.calls[0][2] as any[]).find((b) => b.text === 'Reset').onPress();
    await waitFor(() => expect(getMockDraft('route-9')!.events).toHaveLength(0));
    alert.mockRestore();
  });

  it('keeps no times for a test run on its own', async () => {
    mockParams = { studentId: 'stu-1' };
    await render(<Dl25MockTestScreen />);
    await fireEvent.press(screen.getByTestId('dl25_21_right-driving-add'));
    await fireEvent.press(screen.getByTestId('btn-finish-test'));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd.mock.calls[0][0].fault_events).toBeUndefined();
  });
});
