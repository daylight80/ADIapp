import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../useSupabaseData', () => ({
  useStudent: () => ({ student: { id: 'stu-1', name: 'Test Pupil' } }),
  useStudentByAuthId: () => ({ student: undefined }),
  useStudentByEmail: () => ({ student: undefined }),
  useMockTestAttempts: () => ({ attempts: [], loading: false }),
}));
jest.mock('../MockDebriefCard', () => ({ MockDebriefCard: () => null }));
const mockListRoutes = jest.fn();
jest.mock('../routeRecorder', () => ({ listRoutes: () => mockListRoutes() }));

import Dl25ReportScreen from '../../app/dl25-report-screen';

beforeEach(() => {
  mockPush.mockReset();
  mockListRoutes.mockReset().mockResolvedValue([{ id: 'route-9' }]);
  mockParams = { d: '3', s: '0', x: '0', passed: '1', breakdown: '{}', studentId: 'stu-1', routeId: 'route-9' };
});

describe('DL25 report: link to the recording', () => {
  it('offers View recording when the recording is on this phone, and opens it', async () => {
    await render(<Dl25ReportScreen />);
    await fireEvent.press(await screen.findByTestId('btn-view-recording'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/route-recorder-screen', params: { openRoute: 'route-9' } });
  });

  it('hides the link when the recording is not on this phone, or the test has none', async () => {
    mockListRoutes.mockResolvedValue([{ id: 'someone-else' }]);
    await render(<Dl25ReportScreen />);
    await waitFor(() => expect(mockListRoutes).toHaveBeenCalled());
    expect(screen.queryByTestId('btn-view-recording')).toBeNull();
  });

  it('shows nothing extra for a test run on its own', async () => {
    mockParams = { d: '3', s: '0', x: '0', passed: '1', breakdown: '{}', studentId: 'stu-1' };
    await render(<Dl25ReportScreen />);
    expect(mockListRoutes).not.toHaveBeenCalled();
    expect(screen.queryByTestId('btn-view-recording')).toBeNull();
  });

  it('tells an instructor what a real test would do, not a pupil-style message', async () => {
    await render(<Dl25ReportScreen />);
    expect(screen.getByText(/Would pass a real test/)).toBeTruthy();
  });

  it('keeps the pupil-style message when a pupil opens their own report', async () => {
    mockParams = { d: '3', s: '0', x: '0', passed: '1', breakdown: '{}' };
    await render(<Dl25ReportScreen />);
    expect(screen.getByText(/Well done!/)).toBeTruthy();
  });
});
