import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../BottomSheet', () => ({ BottomSheet: ({ visible, children }: any) => (visible ? children : null) }));
jest.mock('../DateTimeFields', () => {
  const { TextInput } = require('react-native');
  return {
    DateField: ({ value, onChange, testID }: any) => <TextInput testID={testID} value={value} onChangeText={onChange} />,
    TimeField: ({ value, onChange, testID }: any) => <TextInput testID={testID} value={value} onChangeText={onChange} />,
  };
});
let mockDay: { data: any[] | null; error: any } = { data: [], error: null };
jest.mock('../supabaseClient', () => ({
  supabase: { from: () => { const c: any = { select: () => c, eq: () => c, gte: () => c, lte: () => Promise.resolve(mockDay) }; return c; } },
}));
let mockBlocks: any[] = [];
jest.mock('../supabaseDb', () => ({ listAvailabilityBlocks: jest.fn(async () => mockBlocks) }));
const mockPatch = jest.fn();
jest.mock('../offlineSync', () => ({ patchLessonOfflineAware: (...a: any[]) => mockPatch(...a) }));

import { ChangeTimeSheet } from '../diary/ChangeTimeSheet';

const lesson: any = {
  id: 'l1', student_id: 's1', instructor_id: 'i1', date: '2099-11-01', start_time: '09:00', end_time: '11:00',
  duration_hours: 2, travel_minutes: 30, status: 'Scheduled', topic: 'Roundabouts',
};
const onMoved = jest.fn();

// A lesson of another pupil that day, as the database returns it (full timestamps).
const row = (id: string, start: string, end: string, extra: object = {}) => ({
  id, start_time: new Date(`2099-11-02T${start}:00`).toISOString(), end_time: new Date(`2099-11-02T${end}:00`).toISOString(),
  status: 'Scheduled', travel_minutes: 15, students: { full_name: 'Jane Smith' }, ...extra,
});

beforeEach(() => {
  mockPatch.mockReset(); onMoved.mockReset();
  mockPatch.mockResolvedValue({ queued: false });
  mockDay = { data: [], error: null };
  mockBlocks = [];
});

const open = async () => {
  await render(<ChangeTimeSheet visible lesson={lesson} studentName="Issie Stemp" onClose={jest.fn()} onMoved={onMoved} />);
};
const move = async (date: string, start: string) => {
  await fireEvent.changeText(screen.getByTestId('change-time-date'), date);
  await fireEvent.changeText(screen.getByTestId('change-time-start'), start);
};
const press = () => fireEvent.press(screen.getByTestId('btn-change-time-save'));

describe('Change date or time', () => {
  it('starts from the lesson\'s own date and time and shows where it is now', async () => {
    await open();
    expect(screen.getByTestId('change-time-date').props.value).toBe('2099-11-01');
    expect(screen.getByTestId('change-time-start').props.value).toBe('09:00');
    expect(screen.getByTestId('change-time-now')).toHaveTextContent(/09:00–11:00/);
  });

  it('keeps the length, so the end time follows the start', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('change-time-start'), '14:30');
    expect(screen.getByTestId('change-time-summary')).toHaveTextContent(/14:30–16:30 \(the lesson stays 2h long\)/);
  });

  it('saves a clear move with the new date, start and end, and says it was saved', async () => {
    await open();
    await move('2099-11-02', '10:00');
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith({ date: '2099-11-02', startTime: '10:00', endTime: '12:00', queued: false, count: 1 }));
    expect(mockPatch).toHaveBeenCalledWith('l1', { date: '2099-11-02', start_time: '10:00', end_time: '12:00' }, expect.stringContaining('2099-11-01 09:00 to 2099-11-02 10:00'));
  });

  it('is stopped by a clash with another lesson, names it, and saves nothing', async () => {
    mockDay = { data: [row('l2', '13:00', '15:00')], error: null };
    await open();
    await move('2099-11-02', '12:00');
    await press();
    expect(await screen.findByTestId('change-time-blocker')).toHaveTextContent('Jane Smith already has a lesson from 13:00 to 15:00.');
    expect(mockPatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('btn-change-time-save').props.accessibilityState?.disabled ?? screen.getByTestId('btn-change-time-save').props.disabled).toBeTruthy();
  });

  it('clears the message once the teacher changes the time, and then the move works', async () => {
    mockDay = { data: [row('l2', '13:00', '15:00')], error: null };
    await open();
    await move('2099-11-02', '12:00');
    await press();
    await screen.findByTestId('change-time-blocker');
    await fireEvent.changeText(screen.getByTestId('change-time-start'), '10:00');
    expect(screen.queryByTestId('change-time-blocker')).toBeNull();
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
  });

  it('is stopped by time marked as unavailable', async () => {
    mockBlocks = [{ starts_at: new Date('2099-11-02T09:00:00').toISOString(), ends_at: new Date('2099-11-02T12:00:00').toISOString() }];
    await open();
    await move('2099-11-02', '10:00');
    await press();
    expect(await screen.findByTestId('change-time-blocker')).toHaveTextContent(/unavailable/);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('refuses a move to the same date and time', async () => {
    await open();
    await press();
    expect(await screen.findByTestId('change-time-blocker')).toHaveTextContent('That is the date and time it already has.');
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('warns about too little travel time, and moves only on a second press of "Move anyway"', async () => {
    mockDay = { data: [row('l2', '08:00', '10:10')], error: null };
    await open();
    await move('2099-11-02', '10:20');
    await press();
    expect(await screen.findByTestId('change-time-warning')).toHaveTextContent(/Jane Smith's lesson ends 10 mins before this one/);
    expect(mockPatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('btn-change-time-save')).toHaveTextContent('Move anyway');
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ startTime: '10:20', endTime: '12:20' })));
  });

  it('warns about a time that has already passed', async () => {
    await open();
    await move('2000-01-05', '09:00');
    await press();
    expect(await screen.findByTestId('change-time-warning')).toHaveTextContent('That time has already passed.');
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('says when the diary could not be checked, and still lets the teacher move the lesson', async () => {
    mockDay = { data: null, error: { message: 'offline' } };
    await open();
    await move('2099-11-02', '10:00');
    await press();
    expect(await screen.findByTestId('change-time-unchecked')).toHaveTextContent(/Could not check your diary/);
    expect(mockPatch).not.toHaveBeenCalled();
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
  });

  it('passes on that the change was queued when there is no signal', async () => {
    mockPatch.mockResolvedValue({ queued: true });
    await open();
    await move('2099-11-02', '10:00');
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ queued: true })));
  });

  it('shows a failed save, and does not say the lesson moved', async () => {
    mockPatch.mockRejectedValue(new Error('permission denied'));
    await open();
    await move('2099-11-02', '10:00');
    await press();
    expect(await screen.findByTestId('change-time-error')).toHaveTextContent('permission denied');
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('will not let a lesson run past midnight', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('change-time-start'), '23:00');
    expect(screen.getByTestId('change-time-summary')).toHaveTextContent(/before midnight/);
    await press();
    expect(await screen.findByTestId('change-time-blocker')).toHaveTextContent(/past midnight/);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
