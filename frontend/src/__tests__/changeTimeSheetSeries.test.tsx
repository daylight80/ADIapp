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
let mockSeries: { data: any[] | null; error: any } = { data: [], error: null };
const mockQueries: any[][] = []; // every query method called, with its arguments
// Every query method returns the same chain. Awaiting it gives the series rows when it was ordered (the series
// lookup), and the day's lessons otherwise.
jest.mock('../supabaseClient', () => ({
  supabase: {
    from: () => {
      const calls: string[] = [];
      const chain: any = new Proxy({}, {
        get: (_t, prop) => (prop === 'then'
          ? (res: any, rej: any) => Promise.resolve(calls.includes('order') ? mockSeries : mockDay).then(res, rej)
          : (...args: any[]) => { calls.push(String(prop)); mockQueries.push([String(prop), ...args]); return chain; }),
      });
      return chain;
    },
  },
}));
jest.mock('../supabaseDb', () => ({ listAvailabilityBlocks: jest.fn(async () => []) }));
const mockPatch = jest.fn();
jest.mock('../offlineSync', () => ({ patchLessonOfflineAware: (...a: any[]) => mockPatch(...a) }));

import { ChangeTimeSheet } from '../diary/ChangeTimeSheet';

// A weekly lesson, 10:00-12:00, on 3, 10 and 17 November 2099. The lesson being changed is the first.
const lesson: any = {
  id: 'a', student_id: 's1', instructor_id: 'i1', date: '2099-11-03', start_time: '10:00', end_time: '12:00',
  duration_hours: 2, travel_minutes: 0, status: 'Scheduled', topic: 'Roundabouts', series_id: 'ser1',
};
const at = (day: string, start: string, end: string) => ({
  start_time: new Date(`${day}T${start}:00`).toISOString(), end_time: new Date(`${day}T${end}:00`).toISOString(),
});
const seriesRows = () => [
  { id: 'a', ...at('2099-11-03', '10:00', '12:00'), travel_minutes: 0 },
  { id: 'b', ...at('2099-11-10', '10:00', '12:00'), travel_minutes: 0 },
  { id: 'c', ...at('2099-11-17', '10:00', '12:00'), travel_minutes: 0 },
];
const jane = () => ({ id: 'x', ...at('2099-11-11', '13:00', '15:00'), status: 'Scheduled', travel_minutes: 0, students: { full_name: 'Jane Smith' } });
const onMoved = jest.fn();

beforeEach(() => {
  mockPatch.mockReset(); onMoved.mockReset();
  mockPatch.mockResolvedValue({ queued: false });
  mockDay = { data: [], error: null };
  mockSeries = { data: seriesRows(), error: null };
  mockQueries.length = 0;
});

const open = async (l: any = lesson) => {
  await render(<ChangeTimeSheet visible lesson={l} studentName="Issie Stemp" onClose={jest.fn()} onMoved={onMoved} />);
};
const move = async (date: string, start: string) => {
  await fireEvent.changeText(screen.getByTestId('change-time-date'), date);
  await fireEvent.changeText(screen.getByTestId('change-time-start'), start);
};
const press = () => fireEvent.press(screen.getByTestId('btn-change-time-save'));
const chooseFollowing = async () => { await fireEvent.press(await screen.findByTestId('scope-following')); };

describe('a lesson in a repeating series', () => {
  it('offers no choice for a lesson that is not in a series', async () => {
    await open({ ...lesson, series_id: undefined });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('change-time-scope')).toBeNull();
  });

  it('offers no choice when no lesson comes after it', async () => {
    mockSeries = { data: [seriesRows()[0]], error: null };
    await open();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('change-time-scope')).toBeNull();
  });

  it('offers just this lesson, or this and the ones after it, starting on just this lesson', async () => {
    await open();
    expect(await screen.findByTestId('scope-following')).toHaveTextContent('This and the 2 after it');
    expect(screen.getByTestId('scope-one').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('btn-change-time-save')).toHaveTextContent('Move lesson');
  });

  it('moves only this lesson by default, leaving the rest of the series alone', async () => {
    await open();
    await screen.findByTestId('scope-following');
    await move('2099-11-04', '14:00');
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith({ date: '2099-11-04', startTime: '14:00', endTime: '16:00', queued: false, count: 1 }));
    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch.mock.calls[0][0]).toBe('a');
  });

  it('moves this lesson and every one after it by the same amount, each keeping its length', async () => {
    await open();
    await chooseFollowing();
    await move('2099-11-04', '14:00');
    expect(screen.getByTestId('change-time-summary')).toHaveTextContent(/3 lessons\. The first becomes Wed 4 Nov, 14:00–16:00; each one after it moves by the same amount\./);
    expect(screen.getByTestId('btn-change-time-save')).toHaveTextContent('Move 3 lessons');
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith({ date: '2099-11-04', startTime: '14:00', endTime: '16:00', queued: false, count: 3 }));
    expect(mockPatch.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['a', { date: '2099-11-04', start_time: '14:00', end_time: '16:00' }],
      ['b', { date: '2099-11-11', start_time: '14:00', end_time: '16:00' }],
      ['c', { date: '2099-11-18', start_time: '14:00', end_time: '16:00' }],
    ]);
  });

  it('lists a clash on any one of the days, by date, and saves nothing', async () => {
    mockDay = { data: [jane()], error: null };
    await open();
    await chooseFollowing();
    await move('2099-11-04', '14:00');
    await press();
    expect(await screen.findByTestId('change-time-blocker')).toHaveTextContent('Wed 11 Nov: Jane Smith already has a lesson from 13:00 to 15:00.');
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('does not count the lessons being moved as clashes with each other', async () => {
    // The day lookup returns the series' own lessons too: a week later puts each where the next one is now.
    mockDay = { data: seriesRows().map((r) => ({ ...r, status: 'Scheduled', students: { full_name: 'Issie Stemp' } })), error: null };
    await open();
    await chooseFollowing();
    await move('2099-11-10', '10:00');
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ count: 3 })));
  });

  it('says how far it got when one of the saves fails, and does not say it finished', async () => {
    mockPatch.mockResolvedValueOnce({ queued: false }).mockRejectedValueOnce(new Error('permission denied'));
    await open();
    await chooseFollowing();
    await move('2099-11-04', '14:00');
    await press();
    expect(await screen.findByTestId('change-time-error')).toHaveTextContent('Moved 1 of 3 lessons, then it stopped: permission denied. Check the diary.');
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('passes on that it was queued when they had no signal', async () => {
    mockPatch.mockResolvedValue({ queued: true });
    await open();
    await chooseFollowing();
    await move('2099-11-04', '14:00');
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ queued: true, count: 3 })));
  });

  it('forgets an earlier check when the teacher switches between the two choices', async () => {
    mockDay = { data: [jane()], error: null };
    await open();
    await chooseFollowing();
    await move('2099-11-04', '14:00');
    await press();
    await screen.findByTestId('change-time-blocker');
    await fireEvent.press(screen.getByTestId('scope-one'));
    expect(screen.queryByTestId('change-time-blocker')).toBeNull();
    await press(); // just this one: 4 Nov has no clash, so it moves
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ count: 1 })));
  });

  it('warns for a series too, and moves only on the second press of "Move anyway"', async () => {
    await open();
    await chooseFollowing();
    await move('2000-01-05', '09:00'); // long past
    await press();
    const warnings = await screen.findAllByTestId('change-time-warning'); // one for each lesson, by date
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toHaveTextContent('Wed 5 Jan: That time has already passed.');
    expect(mockPatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('btn-change-time-save')).toHaveTextContent('Move anyway');
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ count: 3 })));
  });

  it('still lets the teacher move the lessons when the diary could not be checked', async () => {
    mockDay = { data: null, error: { message: 'offline' } };
    await open();
    await chooseFollowing();
    await move('2099-11-04', '14:00');
    await press();
    expect(await screen.findByTestId('change-time-unchecked')).toHaveTextContent(/move the lessons/);
    expect(mockPatch).not.toHaveBeenCalled();
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ count: 3 })));
  });

  it('asks only for this series\' lessons that are still scheduled and start from this one on, oldest first', async () => {
    await open();
    await screen.findByTestId('scope-following');
    expect(mockQueries).toEqual(expect.arrayContaining([
      ['eq', 'series_id', 'ser1'],
      ['eq', 'status', 'Scheduled'],
      ['gte', 'start_time', new Date('2099-11-03T10:00:00').toISOString()],
      ['order', 'start_time', { ascending: true }],
    ]));
  });

  it('keeps each lesson\'s own start time, so lessons that start at different times move by the same amount', async () => {
    mockSeries = { data: [
      { id: 'a', ...at('2099-11-03', '10:00', '12:00'), travel_minutes: 0 },
      { id: 'b', ...at('2099-11-10', '11:00', '12:30'), travel_minutes: 0 }, // a week later, an hour later, 90 minutes long
    ], error: null };
    await open();
    await chooseFollowing();
    await move('2099-11-03', '14:00'); // same day, four hours later
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ count: 2 })));
    expect(mockPatch.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['a', { date: '2099-11-03', start_time: '14:00', end_time: '16:00' }],
      ['b', { date: '2099-11-10', start_time: '15:00', end_time: '16:30' }],
    ]);
  });

  it('can still move the one lesson when the series could not be read', async () => {
    mockSeries = { data: null, error: { message: 'offline' } };
    await open();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('change-time-scope')).toBeNull();
    await move('2099-11-04', '14:00');
    await press();
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(expect.objectContaining({ count: 1 })));
  });
});
