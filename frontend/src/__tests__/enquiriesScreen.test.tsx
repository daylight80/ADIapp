import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }), useFocusEffect: () => {} }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('../BottomSheet', () => {
  const { View } = require('react-native');
  return { BottomSheet: ({ visible, children }: any) => (visible ? <View>{children}</View> : null) };
});
let mockTier = 'pro';
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { tier: mockTier } }) }));
jest.mock('../useSupabaseData', () => ({ useStudents: () => ({ students: [] }) }));

const mockState = { enquiries: [] as any[], loading: false, error: null as string | null };
jest.mock('../useEnquiries', () => ({ useEnquiries: () => ({ ...mockState, refresh: jest.fn() }) }));
const mockAdd = jest.fn();
const mockUpdate = jest.fn();
const mockLog = jest.fn();
const mockClose = jest.fn();
const mockConvert = jest.fn();
jest.mock('../enquiriesDb', () => ({
  addEnquiry: (...a: unknown[]) => mockAdd(...a),
  updateEnquiry: (...a: unknown[]) => mockUpdate(...a),
  listContacts: jest.fn(async () => [{ id: 'c1', enquiry_id: 'e1', kind: 'call', note: 'left voicemail', contacted_at: new Date().toISOString() }]),
  logContact: (...a: unknown[]) => mockLog(...a),
  closeEnquiry: (...a: unknown[]) => mockClose(...a),
  convertEnquiry: (...a: unknown[]) => mockConvert(...a),
}));
const mockOpenURL = jest.spyOn(require('react-native').Linking, 'openURL').mockResolvedValue(true as never);

import EnquiriesScreen from '../../app/enquiries-screen';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const enq = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Person ${id}`, phone: '07700 900123', email: 'p@x.co.uk', postcode: null, source: 'Website', notes: 'Wants Saturdays',
  stage: 'Waiting', stage_at: iso(1), last_contacted_at: null, converted_student_id: null, converted_at: null,
  closed_at: null, closed_reason: null, created_at: iso(3), ...over,
});

beforeEach(() => {
  [mockPush, mockAdd, mockUpdate, mockLog, mockClose, mockConvert, mockOpenURL].forEach((m) => (m as jest.Mock).mockReset());
  mockOpenURL.mockResolvedValue(true as never);
  mockState.enquiries = [enq('e1'), enq('e2', { stage: 'Contacted' })];
  mockState.loading = false;
  mockState.error = null;
  mockTier = 'pro';
});

describe('plan gating (Enquiries is a DC Pro feature)', () => {
  it('Starter sees a locked screen with no enquiries', async () => {
    mockTier = 'starter';
    await render(<EnquiriesScreen />);
    expect(screen.getByTestId('enquiries-locked')).toBeTruthy();
    expect(screen.queryByTestId('enquiry-add')).toBeNull();
  });

  it('Franchise gets the board', async () => {
    mockTier = 'franchise';
    await render(<EnquiriesScreen />);
    expect(screen.getByTestId('enquiry-add')).toBeTruthy();
  });
});

describe('Enquiries screen', () => {
  it('shows counts per stage and the people at the chosen stage', async () => {
    await render(<EnquiriesScreen />);
    expect(screen.getByTestId('enquiry-tab-waiting')).toHaveTextContent('Waiting1');
    expect(screen.getByTestId('enquiry-tab-contacted')).toHaveTextContent('Contacted1');
    expect(screen.getByTestId('enquiry-e1')).toBeTruthy();
    expect(screen.queryByTestId('enquiry-e2')).toBeNull();
    await fireEvent.press(screen.getByTestId('enquiry-tab-contacted'));
    expect(screen.getByTestId('enquiry-e2')).toBeTruthy();
  });

  it('shows the postcode on the card only when there is one', async () => {
    mockState.enquiries = [enq('e1', { postcode: 'CR4 1AA' }), enq('e3')];
    await render(<EnquiriesScreen />);
    expect(screen.getByTestId('enquiry-postcode-e1')).toBeTruthy();
    expect(screen.getByText('CR4 1AA')).toBeTruthy();
    expect(screen.queryByTestId('enquiry-postcode-e3')).toBeNull();
  });

  it('has a friendly empty state', async () => {
    mockState.enquiries = [];
    await render(<EnquiriesScreen />);
    expect(screen.getByTestId('enquiry-empty')).toBeTruthy();
  });

  it('shows a load error', async () => {
    mockState.error = 'permission denied';
    await render(<EnquiriesScreen />);
    expect(screen.getByTestId('enquiry-error')).toHaveTextContent('permission denied');
  });

  it('Call opens the dialler and logs the call', async () => {
    mockLog.mockResolvedValue(undefined);
    await render(<EnquiriesScreen />);
    await fireEvent.press(screen.getByTestId('enquiry-call-e1'));
    expect(mockOpenURL).toHaveBeenCalledWith('tel:07700900123');
    await waitFor(() => expect(mockLog).toHaveBeenCalledWith('e1', 'call'));
  });

  it('Text opens messages and logs it; Email opens mail', async () => {
    mockLog.mockResolvedValue(undefined);
    await render(<EnquiriesScreen />);
    await fireEvent.press(screen.getByTestId('enquiry-text-e1'));
    expect(mockOpenURL).toHaveBeenCalledWith('sms:07700900123');
    await waitFor(() => expect(mockLog).toHaveBeenCalledWith('e1', 'text'));
    await fireEvent.press(screen.getByTestId('enquiry-email-e1'));
    expect(mockOpenURL).toHaveBeenCalledWith('mailto:p@x.co.uk');
  });

  it('will not call a number it cannot dial, and logs nothing', async () => {
    mockState.enquiries = [enq('e1', { phone: '12' })];
    await render(<EnquiriesScreen />);
    await fireEvent.press(screen.getByTestId('enquiry-call-e1'));
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('shows the contact log when a card is opened', async () => {
    await render(<EnquiriesScreen />);
    await fireEvent.press(screen.getByTestId('enquiry-toggle-e1'));
    expect(await screen.findByText('left voicemail')).toBeTruthy();
    expect(screen.getByText('Called')).toBeTruthy();
  });

  it('adds an enquiry, and refuses one with no way to reach them', async () => {
    mockAdd.mockResolvedValue({});
    await render(<EnquiriesScreen />);
    await fireEvent.press(screen.getByTestId('enquiry-add'));
    await fireEvent.changeText(screen.getByTestId('enquiry-input-name'), 'Sam Lee');
    await fireEvent.press(screen.getByTestId('enquiry-save'));
    expect(screen.getByTestId('enquiry-form-error')).toHaveTextContent(/phone number or an email/);
    expect(mockAdd).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('enquiry-input-phone'), '07700 900999');
    await fireEvent.press(screen.getByTestId('enquiry-save'));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sam Lee', phone: '07700 900999' })));
  });

  it('moves an enquiry to the next stage', async () => {
    mockUpdate.mockResolvedValue(undefined);
    await render(<EnquiriesScreen />);
    await fireEvent.press(screen.getByTestId('enquiry-toggle-e1'));
    await fireEvent.press(screen.getByTestId('enquiry-next-e1'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('e1', { stage: 'Contacted' }));
  });

  it('starting as a pupil needs a second tap, then opens the new pupil', async () => {
    mockConvert.mockResolvedValue('pupil-9');
    await render(<EnquiriesScreen />);
    await fireEvent.press(screen.getByTestId('enquiry-toggle-e1'));
    await fireEvent.press(screen.getByTestId('enquiry-start-e1'));
    expect(mockConvert).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('enquiry-start-e1'));
    await waitFor(() => expect(mockConvert).toHaveBeenCalled());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/student-lifecycle-screen', params: { id: 'pupil-9' } }));
  });

  it('closing also needs a second tap', async () => {
    mockClose.mockResolvedValue(undefined);
    await render(<EnquiriesScreen />);
    await fireEvent.press(screen.getByTestId('enquiry-toggle-e1'));
    await fireEvent.press(screen.getByTestId('enquiry-close-e1'));
    expect(mockClose).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('enquiry-close-e1'));
    await waitFor(() => expect(mockClose).toHaveBeenCalledWith('e1'));
  });

  it('logs a note against an enquiry', async () => {
    mockLog.mockResolvedValue(undefined);
    await render(<EnquiriesScreen />);
    await fireEvent.press(screen.getByTestId('enquiry-toggle-e1'));
    await fireEvent.press(screen.getByTestId('enquiry-log-e1'));
    await fireEvent.changeText(screen.getByTestId('log-text'), 'Ring back Thursday');
    await fireEvent.press(screen.getByTestId('log-save'));
    await waitFor(() => expect(mockLog).toHaveBeenCalledWith('e1', 'note', 'Ring back Thursday'));
  });
});
