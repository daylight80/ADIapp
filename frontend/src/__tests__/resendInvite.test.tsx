import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../BottomNav', () => ({ BottomNav: () => null }));
jest.mock('../BottomSheet', () => ({ BottomSheet: ({ visible, children }: any) => (visible ? children : null) }));
jest.mock('../QrCode', () => ({ QrCode: () => null }));
jest.mock('../ContactsImportSheet', () => ({ ContactsImportSheet: () => null }));
jest.mock('../PaywallModal', () => ({ PaywallModal: () => null }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', tier: 'pro' } }) }));
const mockStudents = {
  students: [
    { id: 's1', name: 'Ben Carter', status: 'Active', email: 'Ben@x.com', phone: '07000', instructor_id: 'i1', school_id: 'sc1', auth_user_id: null },
    { id: 's2', name: 'Priya Nair', status: 'Active', email: 'p@x.com', phone: '07111', instructor_id: 'i1', school_id: 'sc1', auth_user_id: 'a2' },
    { id: 's3', name: 'No Email', status: 'Active', email: '', phone: '07222', instructor_id: 'i1', school_id: 'sc1', auth_user_id: null },
  ],
  loading: false, error: null, refresh: jest.fn(),
};
jest.mock('../useSupabaseData', () => ({ useStudents: () => mockStudents, createStudent: jest.fn() }));
jest.mock('../supabaseDb', () => ({
  listStudentBalances: async () => ({}),
  listHoursBalanceForStudents: async () => ({}),
  studentAppUsageWarning: () => null,
}));
jest.mock('../tools', () => ({ copyToClipboard: jest.fn(), openSmsComposer: jest.fn() }));
jest.mock('../notifications', () => ({ fireInstantNotification: jest.fn() }));
const mockPost = jest.fn();
jest.mock('../api', () => ({ api: { post: (...a: any[]) => mockPost(...a) } }));

import StudentsScreen from '../../app/student-crm-screen';
import { copyToClipboard } from '../tools';

describe('Students list: send the invite again', () => {
  beforeEach(() => mockPost.mockReset());

  it('offers it only to a pupil who has not signed up and has an email', async () => {
    await render(<StudentsScreen />);
    // One card is open at a time, so open each in turn.
    await fireEvent.press(screen.getByTestId('v2-student-toggle-s1'));
    expect(screen.getByTestId('v2-resend-invite-s1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('v2-student-toggle-s2'));
    expect(screen.queryByTestId('v2-resend-invite-s2')).toBeNull();
    await fireEvent.press(screen.getByTestId('v2-student-toggle-s3'));
    expect(screen.queryByTestId('v2-resend-invite-s3')).toBeNull();
  });

  it('sends a new invite email and shows the back-up link again', async () => {
    mockPost.mockResolvedValue({ data: { sent: true, detail: 'Invite email sent to ben@x.com.' } });
    await render(<StudentsScreen />);
    await fireEvent.press(screen.getByTestId('v2-student-toggle-s1'));
    await fireEvent.press(screen.getByTestId('v2-resend-invite-s1'));
    await waitFor(() => expect(screen.getByTestId('v2-invite-email-sent')).toBeTruthy());
    expect(mockPost).toHaveBeenCalledWith('/v2/students/invite', { email: 'ben@x.com', student_name: 'Ben Carter', student_id: 's1' });
    expect(screen.getByTestId('v2-invite-link-value').props.children.props.children).toContain('?invite=');
  });

  it('still shows the back-up link when the email could not be sent', async () => {
    mockPost.mockRejectedValue({ response: { data: { detail: 'Supabase invite failed' } } });
    await render(<StudentsScreen />);
    await fireEvent.press(screen.getByTestId('v2-student-toggle-s1'));
    await fireEvent.press(screen.getByTestId('v2-resend-invite-s1'));
    await waitFor(() => expect(screen.getByTestId('v2-invite-email-fallback')).toBeTruthy());
    expect(screen.getByText('Supabase invite failed')).toBeTruthy();
    expect(screen.getByTestId('v2-invite-link-value')).toBeTruthy();
  });

  const openInviteSheet = async () => {
    mockPost.mockResolvedValue({ data: { sent: true, detail: 'ok' } });
    await render(<StudentsScreen />);
    await fireEvent.press(screen.getByTestId('v2-student-toggle-s1'));
    await fireEvent.press(screen.getByTestId('v2-resend-invite-s1'));
    await waitFor(() => expect(screen.getByTestId('v2-btn-copy-invite')).toBeTruthy());
  };

  it('Copy link copies the link and says so', async () => {
    (copyToClipboard as jest.Mock).mockReturnValue(true);
    await openInviteSheet();
    await fireEvent.press(screen.getByTestId('v2-btn-copy-invite'));
    expect((copyToClipboard as jest.Mock).mock.calls[0][0]).toContain('?invite=');
    expect(screen.getByText('Copied ✓')).toBeTruthy();
  });

  it('Copy link shows the link instead when copying is not possible', async () => {
    (copyToClipboard as jest.Mock).mockReturnValue(false);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openInviteSheet();
    await fireEvent.press(screen.getByTestId('v2-btn-copy-invite'));
    expect(alertSpy).toHaveBeenCalledWith('Invite link', expect.stringContaining('?invite='));
    expect(screen.queryByText('Copied ✓')).toBeNull();
    alertSpy.mockRestore();
  });
});
