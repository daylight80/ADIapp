import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../supabaseDb', () => ({ setMySlotAlerts: jest.fn() }));

import * as db from '../supabaseDb';
import { SlotAlertsCard } from '../SlotAlertsCard';

const save = db.setMySlotAlerts as jest.Mock;
const toggle = () => screen.getByTestId('v2-slot-alerts-toggle');

beforeEach(() => save.mockReset());

describe('Slot alerts (pupil home)', () => {
  it('shows the saved choice and says what it does', async () => {
    await render(<SlotAlertsCard enabled />);
    expect(toggle().props.value).toBe(true);
    expect(screen.getByTestId('slot-alerts-copy')).toHaveTextContent(/free slot.*Contact your instructor to book it/);
  });

  it('shows it off, with the off wording', async () => {
    await render(<SlotAlertsCard enabled={false} />);
    expect(toggle().props.value).toBe(false);
    expect(screen.getByTestId('slot-alerts-copy')).toHaveTextContent(/won't be told/);
  });

  it('saves the choice when switched off, and keeps it', async () => {
    save.mockResolvedValue(false);
    await render(<SlotAlertsCard enabled />);
    await fireEvent(toggle(), 'valueChange', false);
    expect(save).toHaveBeenCalledWith(false);
    await waitFor(() => expect(toggle().props.value).toBe(false));
  });

  it('puts the switch back and says so when the save fails', async () => {
    save.mockRejectedValue(new Error('network down'));
    await render(<SlotAlertsCard enabled />);
    await fireEvent(toggle(), 'valueChange', false);
    expect(await screen.findByTestId('slot-alerts-error')).toHaveTextContent(/network down/);
    expect(toggle().props.value).toBe(true);
  });

  it('follows the pupil record when it arrives after the first render', async () => {
    const { rerender } = await render(<SlotAlertsCard enabled />);
    await rerender(<SlotAlertsCard enabled={false} />);
    expect(toggle().props.value).toBe(false);
  });
});
