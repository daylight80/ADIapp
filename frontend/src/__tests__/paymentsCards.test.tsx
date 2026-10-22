import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const mockLedger = { payments: [] as any[], balance: { charged: 100, paid: 54, outstanding: 46 } as any, loading: false, error: null as string | null };
const mockBump = jest.fn();
const mockPurchase = jest.fn();
const mockRecord = jest.fn();
const mockVoid = jest.fn();
const mockUpdateDate = jest.fn();
const mockSummary = jest.fn();
const mockPdf = jest.fn();

jest.mock('../useSupabaseData', () => ({
  usePaymentLedger: () => mockLedger,
  bump: (...a: unknown[]) => mockBump(...a),
  purchaseBlock: (...a: unknown[]) => mockPurchase(...a),
  useVersion: () => 0,
}));
jest.mock('../supabaseDb', () => ({
  recordPayment: (...a: unknown[]) => mockRecord(...a),
  voidPayment: (...a: unknown[]) => mockVoid(...a),
  updatePaymentDate: (...a: unknown[]) => mockUpdateDate(...a),
  getMySchoolProfile: async () => ({ business_name: "Grant's Driving School" }),
  listLessonPackages: async () => [
    { id: 'p10', name: '10-hour block', hours: 10, price: 350, active: true },
    { id: 'off', name: 'Switched off', hours: 5, price: 100, active: false },
    { id: 'noprice', name: 'No price', hours: 5, price: null, active: true },
  ],
  getMyPaymentSummary: (...a: unknown[]) => mockSummary(...a),
}));
const mockStatus = jest.fn();
const mockRemind = jest.fn();
jest.mock('../paymentReminder', () => ({
  ...jest.requireActual('../paymentReminder'),
  getReminderStatus: (...a: unknown[]) => mockStatus(...a),
  sendPaymentReminder: (...a: unknown[]) => mockRemind(...a),
}));
jest.mock('../api', () => ({ api: {} }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { name: 'Grant Robery', email: 'g@example.com' } }) }));
jest.mock('../invoice', () => ({ generateAndSharePdf: (...a: unknown[]) => mockPdf(...a) }));
jest.mock('../DateTimeFields', () => {
  const { TextInput } = require('react-native');
  return { DateField: ({ value, onChange, testID }: any) => <TextInput value={value} onChangeText={onChange} testID={testID} /> };
});

import { PaymentsCard, paidAtFor } from '../PaymentsCard';
import { PupilPaymentsCard } from '../PupilPaymentsCard';

const manual = { id: 'm1', amount: 36, method: 'cash', paid_at: '2026-10-10T10:00:00Z', source: 'manual', reference: null, note: null, voided_at: null };
const derived = { id: 'd1', amount: 72, method: 'bank_transfer', paid_at: '2026-10-09T10:00:00Z', source: 'lesson', reference: null, note: 'From the lesson', voided_at: null };
const voided = { id: 'v1', amount: 20, method: 'cash', paid_at: '2026-10-08T10:00:00Z', source: 'manual', reference: null, note: null, voided_at: '2026-10-09T00:00:00Z' };

beforeEach(() => {
  mockRecord.mockReset().mockResolvedValue({ id: 'pay-1' });
  mockVoid.mockReset().mockResolvedValue({});
  mockUpdateDate.mockReset().mockResolvedValue({});
  mockBump.mockReset();
  mockPurchase.mockReset().mockResolvedValue({});
  mockPdf.mockReset().mockResolvedValue({ ok: true });
  mockSummary.mockReset();
  mockStatus.mockReset().mockResolvedValue({ owes: 46, can_send: true, reachable: true, last_sent_at: null, next_allowed_at: null });
  mockRemind.mockReset().mockResolvedValue({ sent: true, channel: 'push', owes: 46 });
  mockLedger.payments = [];
  mockLedger.balance = { charged: 100, paid: 54, outstanding: 46 };
  mockLedger.loading = false;
  mockLedger.error = null;
});

describe('instructor payments card', () => {
  const student = { id: 's1', name: 'Test Pupil' };

  it('shows who owes what, and says the app takes no payments', async () => {
    await render(<PaymentsCard student={student} />);
    expect(screen.getByTestId('payments-balance')).toHaveTextContent(/Owes £46\.00/);
    expect(screen.getByTestId('payments-balance')).toHaveTextContent(/Charged £100.00 · Paid £54.00/);
    expect(screen.getByText(/The app doesn.t take payments/)).toBeTruthy();
    expect(screen.getByTestId('payments-empty')).toBeTruthy();
  });

  it('says a payment on a lesson that prepaid hours cover is not counted again', async () => {
    mockLedger.payments = [{ ...derived, id: 'cov', covered_by_prepaid: true }, manual];
    await render(<PaymentsCard student={student} />);
    expect(screen.getByTestId('payment-covered-cov')).toHaveTextContent(/Paid from prepaid hours/);
    expect(screen.queryByTestId('payment-covered-m1')).toBeNull();
  });

  it('does not add the note to a voided payment', async () => {
    mockLedger.payments = [{ ...voided, covered_by_prepaid: true }];
    await render(<PaymentsCard student={student} />);
    expect(screen.queryByTestId('payment-covered-v1')).toBeNull();
  });

  it('shows credit and up to date', async () => {
    mockLedger.balance = { charged: 50, paid: 74, outstanding: -24 };
    const { rerender } = await render(<PaymentsCard student={student} />);
    expect(screen.getByTestId('payments-balance')).toHaveTextContent(/£24\.00 in credit/);
    mockLedger.balance = { charged: 50, paid: 50, outstanding: 0 };
    await rerender(<PaymentsCard student={student} />);
    expect(screen.getByTestId('payments-balance')).toHaveTextContent(/Up to date/);
  });

  it('needs an amount and a method before it will save, then records and refreshes', async () => {
    await render(<PaymentsCard student={student} />);
    await fireEvent.press(screen.getByTestId('btn-record-payment'));
    await fireEvent.press(screen.getByTestId('btn-save-payment'));
    expect(mockRecord).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('input-payment-amount'), '£36.50');
    await fireEvent.press(screen.getByTestId('payment-method-bank_transfer'));
    await fireEvent.changeText(screen.getByTestId('input-payment-reference'), ' INV 7 ');
    await fireEvent.press(screen.getByTestId('btn-save-payment'));

    await waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(1));
    expect(mockRecord.mock.calls[0][0]).toMatchObject({ studentId: 's1', amount: 36.5, method: 'bank_transfer', reference: 'INV 7', paidAt: null });
    expect(mockRecord.mock.calls[0][0].id).toEqual(expect.any(String));
    await waitFor(() => expect(mockBump).toHaveBeenCalled());
  });

  it('keeps the same attempt id when a failed save is retried, so it can never be recorded twice', async () => {
    mockRecord.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
    await render(<PaymentsCard student={student} />);
    await fireEvent.press(screen.getByTestId('btn-record-payment'));
    await fireEvent.changeText(screen.getByTestId('input-payment-amount'), '10');
    await fireEvent.press(screen.getByTestId('payment-method-cash'));
    await fireEvent.press(screen.getByTestId('btn-save-payment'));
    await waitFor(() => expect(screen.getByTestId('payment-form-error')).toHaveTextContent(/Check your connection/));
    await fireEvent.press(screen.getByTestId('btn-save-payment'));
    await waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(2));
    expect(mockRecord.mock.calls[1][0].id).toBe(mockRecord.mock.calls[0][0].id);
  });

  describe('also adding hours to the wallet', () => {
    const rated = { id: 's1', name: 'Test Pupil', hourly_rate: 36 };
    const fill = async (amount: string) => {
      await render(<PaymentsCard student={rated} />);
      await fireEvent.press(screen.getByTestId('btn-record-payment'));
      await fireEvent.changeText(screen.getByTestId('input-payment-amount'), amount);
      await fireEvent.press(screen.getByTestId('payment-method-bank_transfer'));
    };

    it('warns not to also use Add hours in the wallet, which would count the money twice', async () => {
      await fill('144');
      expect(screen.getByTestId('payment-wallet-note')).toHaveTextContent(/counted twice/);
    });

    it('adds no hours unless the box is ticked', async () => {
      await fill('144');
      await fireEvent.press(screen.getByTestId('btn-save-payment'));
      await waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(1));
      expect(mockPurchase).not.toHaveBeenCalled();
    });

    it('suggests hours from the amount and rate, then records the payment and a top-up that carries no money of its own', async () => {
      await fill('144');
      await fireEvent.press(screen.getByTestId('toggle-add-hours'));
      expect(screen.getByTestId('input-wallet-hours').props.value).toBe('4');
      await fireEvent.press(screen.getByTestId('btn-save-payment'));
      await waitFor(() => expect(mockPurchase).toHaveBeenCalledTimes(1));
      expect(mockRecord.mock.calls[0][0]).toMatchObject({ amount: 144 });
      expect(mockPurchase.mock.calls[0][0]).toMatchObject({ student_id: 's1', hours_paid: 4, amount: 0, payment_method: 'bank_transfer' });
      // The hours are linked to the payment they were added with, so the Wallet can show its amount.
      expect(mockPurchase.mock.calls[0][0].payment_id).toBe('pay-1');
    });

    it('lets the instructor pick the package that was paid for: its hours are added and its price becomes the amount', async () => {
      await render(<PaymentsCard student={rated} />);
      await fireEvent.press(screen.getByTestId('btn-record-payment'));
      await fireEvent.press(screen.getByTestId('payment-method-cash'));
      await fireEvent.press(screen.getByTestId('toggle-add-hours'));
      await waitFor(() => expect(screen.getByTestId('pay-pkg-p10')).toBeTruthy());
      expect(screen.queryByTestId('pay-pkg-off')).toBeNull();
      expect(screen.queryByTestId('pay-pkg-noprice')).toBeNull();
      await fireEvent.press(screen.getByTestId('pay-pkg-p10'));
      expect(screen.getByTestId('input-payment-amount').props.value).toBe('350');
      expect(screen.getByTestId('pay-package-summary')).toHaveTextContent(/10-hour block: 10 hours for £350\.00/);
      expect(screen.queryByTestId('input-wallet-hours')).toBeNull();
      await fireEvent.press(screen.getByTestId('btn-save-payment'));
      await waitFor(() => expect(mockPurchase).toHaveBeenCalledTimes(1));
      expect(mockRecord.mock.calls[0][0]).toMatchObject({ amount: 350, method: 'cash' });
      expect(mockPurchase.mock.calls[0][0]).toMatchObject({ hours_paid: 10, amount: 0, notes: 'Package: 10-hour block' });
    });

    it('uses the hours typed instead of the suggestion, and will not save without usable hours', async () => {
      await fill('144');
      await fireEvent.press(screen.getByTestId('toggle-add-hours'));
      await fireEvent.changeText(screen.getByTestId('input-wallet-hours'), '');
      await fireEvent.press(screen.getByTestId('btn-save-payment'));
      expect(mockRecord).not.toHaveBeenCalled();
      await fireEvent.changeText(screen.getByTestId('input-wallet-hours'), '5.5');
      await fireEvent.press(screen.getByTestId('btn-save-payment'));
      await waitFor(() => expect(mockPurchase).toHaveBeenCalled());
      expect(mockPurchase.mock.calls[0][0].hours_paid).toBe(5.5);
    });

    it('if the hours fail after the payment saved, says so, and a retry reuses both ids', async () => {
      mockPurchase.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
      await fill('36');
      await fireEvent.press(screen.getByTestId('toggle-add-hours'));
      await fireEvent.press(screen.getByTestId('btn-save-payment'));
      await waitFor(() => expect(screen.getByTestId('payment-form-error')).toHaveTextContent(/payment is recorded, but the hours/));
      await fireEvent.press(screen.getByTestId('btn-save-payment'));
      await waitFor(() => expect(mockPurchase).toHaveBeenCalledTimes(2));
      expect(mockRecord.mock.calls[1][0].id).toBe(mockRecord.mock.calls[0][0].id);
      expect(mockPurchase.mock.calls[1][0].id).toBe(mockPurchase.mock.calls[0][0].id);
    });
  });

  it('shows the database’s own message when it refuses', async () => {
    mockRecord.mockRejectedValue({ code: '22023', message: 'Enter an amount between £0.01 and £10,000.' });
    await render(<PaymentsCard student={student} />);
    await fireEvent.press(screen.getByTestId('btn-record-payment'));
    await fireEvent.changeText(screen.getByTestId('input-payment-amount'), '10');
    await fireEvent.press(screen.getByTestId('payment-method-card'));
    await fireEvent.press(screen.getByTestId('btn-save-payment'));
    await waitFor(() => expect(screen.getByTestId('payment-form-error')).toHaveTextContent(/Enter an amount between/));
  });

  it('lists payments, offers Void only on ones you recorded, and asks twice before voiding', async () => {
    mockLedger.payments = [manual, derived, voided];
    await render(<PaymentsCard student={student} />);
    expect(screen.getByTestId('payment-m1')).toHaveTextContent(/£36\.00/);
    expect(screen.getByTestId('payment-d1')).toHaveTextContent(/from the lesson/);
    expect(screen.getByTestId('payment-v1')).toHaveTextContent(/voided/);
    expect(screen.queryByTestId('btn-void-d1')).toBeNull();   // edited from the lesson instead
    expect(screen.queryByTestId('btn-void-v1')).toBeNull();   // already void
    expect(screen.queryByTestId('btn-receipt-v1')).toBeNull();

    await fireEvent.press(screen.getByTestId('btn-void-m1'));
    expect(mockVoid).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('btn-void-no-m1'));
    expect(screen.getByTestId('btn-void-m1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('btn-void-m1'));
    await fireEvent.press(screen.getByTestId('btn-void-yes-m1'));
    await waitFor(() => expect(mockVoid).toHaveBeenCalledWith('m1', null));
    await waitFor(() => expect(mockBump).toHaveBeenCalled());
  });

  it('changes the date of a payment, including one that came from a lesson', async () => {
    mockLedger.payments = [manual, derived, voided];
    await render(<PaymentsCard student={student} />);
    expect(screen.queryByTestId('btn-change-date-v1')).toBeNull(); // a voided payment can't be changed
    await fireEvent.press(screen.getByTestId('btn-change-date-d1'));
    expect(screen.getByTestId('input-date-edit-d1').props.value).toBe('2026-10-09');
    await fireEvent.changeText(screen.getByTestId('input-date-edit-d1'), '2026-10-05');
    await fireEvent.press(screen.getByTestId('btn-date-save-d1'));
    await waitFor(() => expect(mockUpdateDate).toHaveBeenCalledTimes(1));
    expect(mockUpdateDate.mock.calls[0][0]).toBe('d1');
    expect(mockUpdateDate.mock.calls[0][1]).toEqual(expect.stringMatching(/^2026-10-05T/));
    await waitFor(() => expect(mockBump).toHaveBeenCalled());
    expect(screen.queryByTestId('date-edit-d1')).toBeNull();
  });

  it('refuses a future date without calling the server, and can be cancelled', async () => {
    mockLedger.payments = [manual];
    await render(<PaymentsCard student={student} />);
    await fireEvent.press(screen.getByTestId('btn-change-date-m1'));
    await fireEvent.changeText(screen.getByTestId('input-date-edit-m1'), '2999-01-01');
    await fireEvent.press(screen.getByTestId('btn-date-save-m1'));
    expect(screen.getByTestId('date-edit-error-m1')).toHaveTextContent(/future/);
    expect(mockUpdateDate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('btn-date-cancel-m1'));
    expect(screen.queryByTestId('date-edit-m1')).toBeNull();
  });

  it('shows the database message if the change is refused, and notes a changed date', async () => {
    mockUpdateDate.mockRejectedValue({ code: '22023', message: 'A voided payment can’t be changed.' });
    mockLedger.payments = [{ ...manual, date_changed_at: '2026-10-12T09:00:00Z', original_paid_at: '2026-10-10T10:00:00Z' }];
    await render(<PaymentsCard student={student} />);
    expect(screen.getByTestId('payment-date-changed-m1')).toHaveTextContent(/first recorded 10-10-2026/);
    await fireEvent.press(screen.getByTestId('btn-change-date-m1'));
    await fireEvent.changeText(screen.getByTestId('input-date-edit-m1'), '2026-10-01');
    await fireEvent.press(screen.getByTestId('btn-date-save-m1'));
    await waitFor(() => expect(screen.getByTestId('date-edit-error-m1')).toHaveTextContent(/can.t be changed/));
  });

  it('makes a receipt as a PDF', async () => {
    mockLedger.payments = [manual];
    await render(<PaymentsCard student={student} />);
    await fireEvent.press(screen.getByTestId('btn-receipt-m1'));
    await waitFor(() => expect(mockPdf).toHaveBeenCalledTimes(1));
    expect(mockPdf.mock.calls[0][0]).toContain('Payment receipt');
    expect(mockPdf.mock.calls[0][0]).toContain("Grant's Driving School");
    expect(mockPdf.mock.calls[0][0]).not.toMatch(/VAT/i);
    expect(mockPdf.mock.calls[0][1]).toMatch(/^Receipt-/);
  });
});

describe('payment reminder button', () => {
  const student = { id: 's1', name: 'Test Pupil' };

  it('is only there when the pupil owes money', async () => {
    mockLedger.balance = { charged: 50, paid: 74, outstanding: -24 };
    await render(<PaymentsCard student={student} />);
    expect(screen.queryByTestId('btn-send-reminder')).toBeNull();
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('sends a reminder, says how it went, and refreshes the status', async () => {
    await render(<PaymentsCard student={student} />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalledWith('s1'));
    await fireEvent.press(screen.getByTestId('btn-send-reminder'));
    await waitFor(() => expect(mockRemind).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.getByTestId('reminder-message')).toHaveTextContent(/Reminder sent to Test as a notification/));
    expect(mockStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('says it was an email when the pupil has no app', async () => {
    mockRemind.mockResolvedValue({ sent: true, channel: 'email', owes: 46 });
    await render(<PaymentsCard student={student} />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('btn-send-reminder'));
    await waitFor(() => expect(screen.getByTestId('reminder-message')).toHaveTextContent(/by email/));
  });

  it('shows the backend’s own reason when it refuses', async () => {
    mockRemind.mockRejectedValue({ response: { data: { detail: 'You reminded Test on 14 Oct. You can send another from 17 Oct.' } } });
    await render(<PaymentsCard student={student} />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('btn-send-reminder'));
    await waitFor(() => expect(screen.getByTestId('reminder-message')).toHaveTextContent(/You can send another from 17 Oct/));
  });

  it('does not send while a recent reminder is still in the waiting period, and says when', async () => {
    mockStatus.mockResolvedValue({ owes: 46, can_send: false, reachable: true, last_sent_at: '2026-10-14T09:00:00Z', next_allowed_at: '2026-10-17T09:00:00Z' });
    await render(<PaymentsCard student={student} />);
    await waitFor(() => expect(screen.getByTestId('reminder-history')).toHaveTextContent(/Last reminded 14 Oct\. You can send another from 17 Oct\./));
    await fireEvent.press(screen.getByTestId('btn-send-reminder'));
    expect(mockRemind).not.toHaveBeenCalled();
  });

  it('explains when there is no way to reach the pupil', async () => {
    mockStatus.mockResolvedValue({ owes: 46, can_send: true, reachable: false, last_sent_at: null, next_allowed_at: null });
    await render(<PaymentsCard student={student} />);
    await waitFor(() => expect(screen.getByTestId('reminder-unreachable')).toHaveTextContent(/no app login or email address/));
  });
});

describe('paidAtFor', () => {
  it('leaves today to the database and takes an earlier day at midday', () => {
    expect(paidAtFor('2026-10-15', '2026-10-15')).toBeNull();
    expect(paidAtFor('', '2026-10-15')).toBeNull();
    expect(paidAtFor('not a date', '2026-10-15')).toBeNull();
    expect(paidAtFor('2026-10-10', '2026-10-15')).toEqual(expect.stringMatching(/^2026-10-10T/));
  });
});

describe('pupil payments card', () => {
  it('says what the pupil owes and lists payments and prepaid top-ups', async () => {
    mockSummary.mockResolvedValue({
      charged: 100, paid: 54, balance: 46,
      payments: [{ id: 'a', amount: 36, method: 'cash', paid_at: '2026-10-10T10:00:00Z', reference: null }],
      topups: [{ id: 'k', amount: 18, hours: 0.5, at: '2026-10-12T10:00:00Z', method: 'cash' }],
    });
    await render(<PupilPaymentsCard instructorFirstName="Grant" />);
    await waitFor(() => expect(screen.getByTestId('pupil-balance')).toHaveTextContent('You owe £46.00 to Grant.'));
    expect(screen.getByTestId('pupil-payment-p-a')).toHaveTextContent(/£36\.00/);
    expect(screen.getByTestId('pupil-payment-t-k')).toHaveTextContent(/Prepaid 0\.5 hours/);
    expect(screen.getByText(/You pay your instructor directly/)).toBeTruthy();
  });

  it('reassures when all paid up, and never offers a way to pay', async () => {
    mockSummary.mockResolvedValue({ charged: 0, paid: 0, balance: 0, payments: [], topups: [] });
    await render(<PupilPaymentsCard />);
    await waitFor(() => expect(screen.getByTestId('pupil-balance')).toHaveTextContent('You are all paid up.'));
    expect(screen.getByTestId('pupil-payments-empty')).toBeTruthy();
    expect(screen.queryByText(/pay now/i)).toBeNull();
  });

  it('says so when it cannot load', async () => {
    mockSummary.mockRejectedValue(new Error('offline'));
    await render(<PupilPaymentsCard />);
    await waitFor(() => expect(screen.getByText(/Couldn.t load your payments/)).toBeTruthy());
  });
});
