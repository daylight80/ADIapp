import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../BottomNav', () => ({ BottomNav: () => null }));
jest.mock('../BottomSheet', () => ({ BottomSheet: () => null }));
jest.mock('../QrCode', () => ({ QrCode: () => null }));
jest.mock('../ContactsImportSheet', () => ({ ContactsImportSheet: () => null }));
jest.mock('../PaywallModal', () => ({ PaywallModal: () => null }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', tier: 'pro' } }) }));
// One stable object: the screen's effects depend on these, so a fresh array each render would loop forever.
const mockStudents = {
  students: [
    { id: 's1', name: 'Ben Carter', status: 'Active', email: 'b@x.com' },
    { id: 's2', name: 'Priya Nair', status: 'Test Ready', email: 'p@x.com' },
  ],
  loading: false, error: null, refresh: jest.fn(),
};
jest.mock('../useSupabaseData', () => ({
  useStudents: () => mockStudents,
  createStudent: jest.fn(),
}));
jest.mock('../supabaseDb', () => ({
  listStudentBalances: async () => ({}),
  listHoursBalanceForStudents: async () => ({}),
  studentAppUsageWarning: () => null,
}));
jest.mock('../tools', () => ({ copyToClipboard: jest.fn(), openSmsComposer: jest.fn() }));
jest.mock('../notifications', () => ({ fireInstantNotification: jest.fn() }));
jest.mock('../api', () => ({ api: {} }));

import StudentsScreen from '../../app/student-crm-screen';

describe('Students list: filter from the Home pupil tiles', () => {
  it('opens on the chip named in ?filter and lists only that group', async () => {
    mockParams = { filter: 'Test Ready' };
    await render(<StudentsScreen />);
    expect(screen.getByText('Priya Nair')).toBeTruthy();
    expect(screen.queryByText('Ben Carter')).toBeNull();
  });

  it('shows everyone with no filter', async () => {
    mockParams = {};
    await render(<StudentsScreen />);
    expect(screen.getByText('Priya Nair')).toBeTruthy();
    expect(screen.getByText('Ben Carter')).toBeTruthy();
  });
});
