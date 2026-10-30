import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../BottomSheet', () => ({ BottomSheet: ({ visible, children }: any) => (visible ? children : null) }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', tier: 'franchise', name: 'Jon Duncombe' } }) }));
const mockSms = jest.fn();
const mockWhatsApp = jest.fn();
jest.mock('../tools', () => ({ openSmsComposer: (...a: any[]) => mockSms(...a), openWhatsApp: (...a: any[]) => mockWhatsApp(...a) }));

let mockAnilPhone: string | null = '07700 900123';
const mockChain = (result: any) => {
  const c: any = { select: () => c, eq: () => c, order: () => c, maybeSingle: () => Promise.resolve(result), then: (res: any, rej: any) => Promise.resolve(result).then(res, rej) };
  return c;
};
jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: 'owner-auth' } } } }) },
    from: (table: string) => {
      if (table === 'driving_schools') return mockChain({ data: { id: 'sc1', owner_auth_id: 'owner-auth', business_name: 'FJ' }, error: null });
      if (table === 'instructors') return mockChain({ data: [
        { id: 'iJ', full_name: 'Jon Duncombe', adi_number: '1', auth_user_id: 'owner-auth', mobile_number: '07111 111111' },
        { id: 'iA', full_name: 'Anil Mruthinjayan', adi_number: '2', auth_user_id: 'auth-anil', mobile_number: mockAnilPhone },
      ], error: null });
      return mockChain({ data: [
        { id: 's1', full_name: 'Dayana Arachchige', email: null, status: 'New', instructor_id: 'iJ', progress: 0 },
        { id: 's2', full_name: 'Ben Carter', email: null, status: 'Active', instructor_id: 'iA', progress: 10 },
      ], error: null });
    },
  },
}));

import ManageAssignmentsScreen from '../../app/manage-assignments-screen';

const mockFetch = jest.fn();
beforeEach(() => {
  mockSms.mockReset(); mockWhatsApp.mockReset(); mockFetch.mockReset();
  mockAnilPhone = '07700 900123';
  (global as any).fetch = mockFetch;
});

async function moveDayanaToAnil(response: any) {
  mockFetch.mockResolvedValue({ ok: true, json: async () => response });
  await render(<ManageAssignmentsScreen />);
  await fireEvent.press(await screen.findByTestId('row-s1'));
  await fireEvent.press(screen.getByTestId('btn-move-to'));
  await fireEvent.press(screen.getByTestId('pick-iA'));
  await screen.findByTestId('sheet-allocated', {}, { timeout: 5000 }).catch(() => null);
}

describe('Moving a pupil to another instructor', () => {
  it('says the instructor was notified, and offers a ready-written text and WhatsApp', async () => {
    await moveDayanaToAnil({ moved: 1, skipped: 0, errors: [], notified: 1 });
    await waitFor(() => expect(screen.getByTestId('alloc-note')).toBeTruthy());
    expect(screen.getByTestId('alloc-note').props.children).toContain('Anil has been sent a notification');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).assignments).toEqual([{ student_id: 's1', new_instructor_id: 'iA' }]);

    await fireEvent.press(screen.getByTestId('alloc-sms'));
    const [phone, text] = mockSms.mock.calls[0];
    expect(phone).toBe('07700 900123');
    expect(text).toContain('Hi Anil');
    expect(text).toContain('Dayana Arachchige');
    expect(text).toContain('Thanks, Jon');

    await fireEvent.press(screen.getByTestId('alloc-whatsapp'));
    expect(mockWhatsApp).toHaveBeenCalledWith('07700 900123', text);
  });

  it('says so when no notification could be sent', async () => {
    await moveDayanaToAnil({ moved: 1, skipped: 0, errors: [], notified: 0 });
    await waitFor(() => expect(screen.getByTestId('alloc-note')).toBeTruthy());
    expect(screen.getByTestId('alloc-note').props.children).toContain('could not be sent a notification');
  });

  it('offers no text or WhatsApp when the instructor has no mobile number saved', async () => {
    mockAnilPhone = null;
    await moveDayanaToAnil({ moved: 1, skipped: 0, errors: [], notified: 1 });
    await waitFor(() => expect(screen.getByTestId('alloc-no-phone')).toBeTruthy());
    expect(screen.queryByTestId('alloc-sms')).toBeNull();
    expect(screen.queryByTestId('alloc-whatsapp')).toBeNull();
  });
});
