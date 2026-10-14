import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../supabaseDb', () => ({ getSlotAlertStatus: jest.fn() }));

import * as db from '../supabaseDb';
import { SlotAlertLine } from '../SlotAlertLine';
import { describeSlotAlert, type SlotAlertStatus } from '../slotAlertStatus';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const inMin = (m: number) => NOW + m * 60_000;
const status = (over: Partial<NonNullable<SlotAlertStatus>> = {}): SlotAlertStatus => ({
  sent_at: null, lesson_updated_at: new Date(NOW - 60_000).toISOString(), told: 0, ...over,
});

describe('describeSlotAlert', () => {
  it('says how many pupils were told, singular and plural', () => {
    expect(describeSlotAlert(status({ sent_at: 'x', told: 1 }), inMin(600), NOW, true)).toBe('Slot alert sent to 1 pupil.');
    expect(describeSlotAlert(status({ sent_at: 'x', told: 3 }), inMin(600), NOW, true)).toBe('Slot alert sent to 3 pupils.');
  });

  it('explains when it was sent but nobody needed telling', () => {
    expect(describeSlotAlert(status({ sent_at: 'x', told: 0 }), inMin(600), NOW, true)).toMatch(/no pupil needed telling/);
  });

  it('says pupils are about to be told for a fresh cancellation', () => {
    expect(describeSlotAlert(status(), inMin(600), NOW, true)).toMatch(/within a few minutes/);
  });

  it('explains why a slot under 2 hours away or over 14 days away gets no alert', () => {
    expect(describeSlotAlert(status(), inMin(90), NOW, true)).toBe('No slot alert: the slot is less than 2 hours away.');
    expect(describeSlotAlert(status(), inMin(15 * 24 * 60), NOW, true)).toBe('No slot alert: the slot is more than 14 days away.');
  });

  it('says nothing for an old cancellation that will never be announced', () => {
    const old = status({ lesson_updated_at: new Date(NOW - 3 * 3600_000).toISOString() });
    expect(describeSlotAlert(old, inMin(600), NOW, true)).toBeNull();
  });

  it('says nothing on a Starter plan, for a lesson in the past, for someone else\'s lesson, or a bad date', () => {
    expect(describeSlotAlert(status({ sent_at: 'x', told: 2 }), inMin(600), NOW, false)).toBeNull();
    expect(describeSlotAlert(status({ sent_at: 'x', told: 2 }), inMin(-30), NOW, true)).toBeNull();
    expect(describeSlotAlert(null, inMin(600), NOW, true)).toBeNull();
    expect(describeSlotAlert(status(), NaN, NOW, true)).toBeNull();
  });
});

describe('SlotAlertLine', () => {
  const get = db.getSlotAlertStatus as jest.Mock;
  const future = Date.now() + 5 * 24 * 3600_000;
  beforeEach(() => get.mockReset());

  it('shows how many pupils were told', async () => {
    get.mockResolvedValue({ sent_at: new Date().toISOString(), lesson_updated_at: new Date().toISOString(), told: 2 });
    await render(<SlotAlertLine lessonId="l1" lessonStartMs={future} paid />);
    await waitFor(() => expect(screen.getByTestId('slot-alert-line')).toHaveTextContent('Slot alert sent to 2 pupils.'));
    expect(get).toHaveBeenCalledWith('l1');
  });

  it('asks nothing and shows nothing on a Starter plan', async () => {
    await render(<SlotAlertLine lessonId="l1" lessonStartMs={future} paid={false} />);
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByTestId('slot-alert-line')).toBeNull();
  });

  it('shows nothing, quietly, if the lookup fails', async () => {
    get.mockRejectedValue(new Error('network down'));
    await render(<SlotAlertLine lessonId="l1" lessonStartMs={future} paid />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId('slot-alert-line')).toBeNull();
  });
});
