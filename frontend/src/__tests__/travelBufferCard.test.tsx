import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const mockGet = jest.fn();
const mockSet = jest.fn();
jest.mock('../supabaseDb', () => ({
  getMyDefaultTravelMinutes: (...a: unknown[]) => mockGet(...a),
  setMyDefaultTravelMinutes: (...a: unknown[]) => mockSet(...a),
}));

import { TravelBufferCard } from '../TravelBufferCard';

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(15);
  mockSet.mockReset().mockImplementation(async (n: number) => n);
});

const isActive = (id: string) => {
  const style = ([] as any[]).concat(screen.getByTestId(id).props.style).flat(Infinity).filter(Boolean);
  return style.some((s: any) => s.backgroundColor);
};

describe('Travel buffer setting', () => {
  it('shows the saved default as the chosen option', async () => {
    mockGet.mockResolvedValue(20);
    await render(<TravelBufferCard />);
    await waitFor(() => expect(isActive('travel-buffer-20')).toBe(true));
    expect(isActive('travel-buffer-15')).toBe(false);
  });

  it('saves a new choice', async () => {
    await render(<TravelBufferCard />);
    await fireEvent.press(screen.getByTestId('travel-buffer-30'));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith(30));
    await waitFor(() => expect(isActive('travel-buffer-30')).toBe(true));
  });

  it('goes back to the old choice and says so when saving fails', async () => {
    mockSet.mockRejectedValue(new Error('offline'));
    await render(<TravelBufferCard />);
    await waitFor(() => expect(isActive('travel-buffer-15')).toBe(true));
    await fireEvent.press(screen.getByTestId('travel-buffer-5'));
    await waitFor(() => expect(screen.getByTestId('travel-buffer-error')).toHaveTextContent(/offline/));
    expect(isActive('travel-buffer-15')).toBe(true);
    expect(isActive('travel-buffer-5')).toBe(false);
  });

  it('offers None as well as the minutes', async () => {
    await render(<TravelBufferCard />);
    expect(screen.getByText('None')).toBeTruthy();
    expect(screen.getByText('30 min')).toBeTruthy();
  });
});
