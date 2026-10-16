import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const mockGet = jest.fn();
const mockSet = jest.fn();
jest.mock('../supabaseDb', () => ({
  getMyReminderBalanceSetting: (...a: unknown[]) => mockGet(...a),
  setMyReminderBalanceSetting: (...a: unknown[]) => mockSet(...a),
}));

import { ReminderBalanceCard } from '../ReminderBalanceCard';

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(false);
  mockSet.mockReset().mockImplementation(async (v: boolean) => v);
});

describe('Mention unpaid balances in reminders (Profile)', () => {
  it('starts off and says reminders only give the lesson time', async () => {
    await render(<ReminderBalanceCard />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.getByTestId('reminder-balance-toggle').props.value).toBe(false);
    expect(screen.getByTestId('reminder-balance-copy')).toHaveTextContent(/Off\. Reminders only say when the lesson is/);
  });

  it('shows it on when it was saved on, and explains what that does', async () => {
    mockGet.mockResolvedValue(true);
    await render(<ReminderBalanceCard />);
    await waitFor(() => expect(screen.getByTestId('reminder-balance-toggle').props.value).toBe(true));
    expect(screen.getByTestId('reminder-balance-copy')).toHaveTextContent(/with the amount\. The notification just says to see their Wallet/);
  });

  it('saves a change', async () => {
    await render(<ReminderBalanceCard />);
    await fireEvent(screen.getByTestId('reminder-balance-toggle'), 'valueChange', true);
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByTestId('reminder-balance-toggle').props.value).toBe(true));
  });

  it('goes back and says so when saving fails', async () => {
    mockSet.mockRejectedValue(new Error('offline'));
    await render(<ReminderBalanceCard />);
    await fireEvent(screen.getByTestId('reminder-balance-toggle'), 'valueChange', true);
    await waitFor(() => expect(screen.getByTestId('reminder-balance-error')).toHaveTextContent(/offline/));
    expect(screen.getByTestId('reminder-balance-toggle').props.value).toBe(false);
  });
});
