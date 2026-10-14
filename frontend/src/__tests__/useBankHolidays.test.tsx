import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBankHolidays, setDivision, getDivision, resetBankHolidayCache } from '../useBankHolidays';

const feedJson = {
  'england-and-wales': { events: [{ title: 'Christmas Day', date: '2026-12-25' }] },
  scotland: { events: [{ title: '2nd January', date: '2027-01-02' }] },
  'northern-ireland': { events: [] },
};

const fetchMock = () => (global as any).fetch as jest.Mock;

function Probe() {
  const { holidays, division } = useBankHolidays();
  return <Text testID="out">{`${division}|${JSON.stringify(holidays)}`}</Text>;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetBankHolidayCache();
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => feedJson });
});

describe('useBankHolidays', () => {
  it('fetches the GOV.UK feed once and shows the England & Wales holidays by default', async () => {
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('england-and-wales|{"2026-12-25":"Christmas Day"}'));
    expect(fetchMock()).toHaveBeenCalledWith('https://www.gov.uk/bank-holidays.json');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('switches region when the instructor picks another, and remembers it', async () => {
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent(/england-and-wales\|\{"2026/));
    await act(async () => { await setDivision('scotland'); });
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('scotland|{"2027-01-02":"2nd January"}'));
    expect(await getDivision()).toBe('scotland');
  });

  it('uses the saved copy instead of fetching again, within a week', async () => {
    await AsyncStorage.setItem('bankHolidays.feed.v1', JSON.stringify({
      at: Date.now() - 60_000, feed: { 'england-and-wales': { '2026-12-25': 'Saved Christmas' } },
    }));
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent(/Saved Christmas/));
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('falls back to an old saved copy when the service is down', async () => {
    await AsyncStorage.setItem('bankHolidays.feed.v1', JSON.stringify({
      at: Date.now() - 30 * 24 * 3600 * 1000, feed: { 'england-and-wales': { '2026-12-25': 'Old copy' } },
    }));
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent(/Old copy/));
  });

  it('shows no holidays, and does not crash, when the service is down and nothing is saved', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await render(<Probe />);
    await waitFor(() => expect(fetchMock()).toHaveBeenCalled());
    expect(screen.getByTestId('out')).toHaveTextContent('england-and-wales|{}');
  });
});
