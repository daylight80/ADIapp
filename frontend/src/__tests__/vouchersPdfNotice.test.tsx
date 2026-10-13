import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => useEffect(cb, []),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { tier: 'pro', name: 'Grant', email: 'g@x.co' } }) }));
jest.mock('../invoice', () => ({ generateAndSharePdf: jest.fn(), A4_POINTS: { width: 595, height: 842 } }));
jest.mock('../supabaseDb', () => ({
  listGiftVouchers: jest.fn(),
  createGiftVoucher: jest.fn(),
  setGiftVoucherStatus: jest.fn(),
  getInstructorProfile: jest.fn(),
  getMySchoolProfile: jest.fn(),
}));

import * as db from '../supabaseDb';
import * as invoice from '../invoice';
import VouchersScreen from '../../app/vouchers-screen';

const mdb = db as unknown as Record<string, jest.Mock>;
const pdf = invoice.generateAndSharePdf as jest.Mock;
const voucher = {
  id: 'v1', school_id: 's1', instructor_id: 'i1', code: 'ABCD-EFGH-JKLM', hours: 2, recipient_name: 'Sam',
  message: null, issued_at: '2026-10-01T10:00:00Z', expires_at: '2027-10-01', status: 'active', redeemed_at: null,
};

beforeEach(() => {
  mdb.listGiftVouchers.mockResolvedValue([voucher]);
  mdb.getInstructorProfile.mockResolvedValue({ id: 'i1', school_id: 's1', full_name: 'Grant Robery' });
  mdb.getMySchoolProfile.mockResolvedValue(null);
  pdf.mockReset();
});

describe('Vouchers: PDF that fails to open', () => {
  it('says so on the page (Alert.alert does nothing in a browser)', async () => {
    pdf.mockResolvedValue({ ok: false, error: 'Browser blocked the voucher window' });
    await render(<VouchersScreen />);
    expect(screen.queryByTestId('voucher-notice')).toBeNull();
    fireEvent.press(await screen.findByTestId('btn-share-v1'));
    const notice = await screen.findByTestId('voucher-notice');
    expect(notice).toHaveTextContent(/Could not make the PDF.*Browser blocked the voucher window/);
  });

  it('shows no notice when the PDF opens', async () => {
    pdf.mockResolvedValue({ ok: true });
    await render(<VouchersScreen />);
    fireEvent.press(await screen.findByTestId('btn-share-v1'));
    await waitFor(() => expect(pdf).toHaveBeenCalled());
    expect(screen.queryByTestId('voucher-notice')).toBeNull();
  });
});
