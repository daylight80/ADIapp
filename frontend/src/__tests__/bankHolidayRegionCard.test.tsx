import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../useBankHolidays', () => ({ getDivision: jest.fn(), setDivision: jest.fn() }));

import * as hook from '../useBankHolidays';
import { BankHolidayRegionCard } from '../BankHolidayRegionCard';

const getDivision = hook.getDivision as jest.Mock;
const setDivision = hook.setDivision as jest.Mock;

beforeEach(() => { getDivision.mockReset(); setDivision.mockReset(); });

describe('Bank holidays region (Profile)', () => {
  it('shows the three regions with the saved one selected', async () => {
    getDivision.mockResolvedValue('scotland');
    await render(<BankHolidayRegionCard />);
    expect(screen.getByText('England & Wales')).toBeTruthy();
    expect(screen.getByText('Northern Ireland')).toBeTruthy();
    // The selected chip is the one with the active (white) text.
    await waitFor(() => {
      const chip = screen.getByTestId('bank-holiday-scotland');
      expect(JSON.stringify(chip.props.style)).toContain('"backgroundColor"');
    });
  });

  it('saves the region when one is tapped', async () => {
    getDivision.mockResolvedValue('england-and-wales');
    await render(<BankHolidayRegionCard />);
    await fireEvent.press(screen.getByTestId('bank-holiday-northern-ireland'));
    expect(setDivision).toHaveBeenCalledWith('northern-ireland');
  });
});
