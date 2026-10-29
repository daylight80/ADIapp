import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../supabaseClient', () => ({ supabase: { auth: { getSession: jest.fn() }, from: jest.fn() } }));
jest.mock('../useBankHolidays', () => ({ useBankHolidays: () => ({ holidays: [] }) }));
jest.mock('../useSupabaseData', () => ({ createLesson: jest.fn(), patchLesson: jest.fn(), patchStudent: jest.fn(), useStudentPlaces: () => [] }));
jest.mock('../AddressSearch', () => ({ AddressSearch: () => null }));
jest.mock('../notifications', () => ({ scheduleLessonReminders: jest.fn() }));
jest.mock('../maps', () => ({ getTravelTime: jest.fn(), lessonAddress: jest.fn() }));

const mockPrefs = jest.fn();
const mockLessons = jest.fn();
jest.mock('../supabaseDb', () => ({
  overlapsAnyBlock: () => false,
  getMyDefaultTravelMinutes: async () => 0,
  getMyDiaryPrefs: (...a: unknown[]) => mockPrefs(...a),
  getInstructorHourlyRate: async () => 40,
  listLessonsBetween: (...a: unknown[]) => mockLessons(...a),
  listAvailabilityBlocks: async () => [],
}));

import { AddLessonSheet } from '../diary/AddLessonSheet';

const student = { id: 'st1', name: 'Sam', hourly_rate: 40 } as any;
const props = { visible: true, onClose: jest.fn(), students: [student], lessons: [], availBlocks: [], pro: false, onCreated: jest.fn(), initialDate: '2030-03-04' };

beforeEach(() => {
  mockPrefs.mockReset().mockResolvedValue({});
  mockLessons.mockReset().mockResolvedValue([]);
});

describe('Add Lesson uses the instructor\'s own settings', () => {
  it('offers the instructor\'s lengths, not the fixed ones', async () => {
    mockPrefs.mockResolvedValue({ lesson_lengths: [{ minutes: 45, price: 30 }, { minutes: 75, price: null }] });
    await render(<AddLessonSheet {...props} />);
    expect(await screen.findByTestId('pick-length-45')).toBeTruthy();
    expect(screen.getByTestId('pick-length-75')).toBeTruthy();
    expect(screen.queryByTestId('pick-length-180')).toBeNull();
  });

  it('offers only the lesson types the instructor ticked, and moves off one that is no longer offered', async () => {
    mockPrefs.mockResolvedValue({ lesson_types: ['Night', 'Theory'] });
    await render(<AddLessonSheet {...props} />);
    expect(await screen.findByTestId('lesson-type-Night')).toBeTruthy();
    expect(screen.queryByTestId('lesson-type-Motorway')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('lesson-type-Standard')).toBeNull());
  });

  it('fills the price from the instructor\'s price for the chosen length, and tells them where it came from', async () => {
    mockPrefs.mockResolvedValue({ lesson_lengths: [{ minutes: 90, price: 55 }] });
    await render(<AddLessonSheet {...props} />);
    await fireEvent.press(await screen.findByTestId('pick-student-st1'));
    await waitFor(() => expect(screen.getByTestId('input-lesson-rate').props.value).toBe('55.00'));
    expect(screen.getByTestId('price-hint')).toBeTruthy();
  });

  it('shows the hourly rate times the length as the example price when no pupil is chosen', async () => {
    await render(<AddLessonSheet {...props} />);
    await waitFor(() => expect(screen.getByTestId('input-lesson-rate').props.placeholder).toBe('e.g. 80.00'));
  });

  it('suggests the next free slots, and tapping one fills the date and times', async () => {
    mockPrefs.mockResolvedValue({ lesson_lengths: [{ minutes: 60, price: null }], work_start: '09:00', work_end: '12:00' });
    await render(<AddLessonSheet {...props} />);
    const slots = await screen.findByTestId('next-slots');
    expect(slots).toBeTruthy();
    const chip = await screen.findByTestId(/^next-slot-\d{4}-\d{2}-\d{2}-09:00$/);
    await fireEvent.press(chip);
    // the Start and End fields show their times as text
    expect(screen.getByText('09:00')).toBeTruthy();
    expect(screen.getByText('10:00')).toBeTruthy();
  });

  it('booking the next lesson for a pupil starts on the first free slot, not the default time', async () => {
    mockPrefs.mockResolvedValue({ lesson_lengths: [{ minutes: 60, price: null }], work_start: '13:00', work_end: '16:00' });
    await render(<AddLessonSheet {...props} initialStudentId="st1" />);
    const chips = await screen.findAllByTestId(/^next-slot-\d{4}-\d{2}-\d{2}-\d{2}:\d{2}$/);
    const start = String(chips[0].props.testID).slice(-5);
    await waitFor(() => expect(screen.getByText(start)).toBeTruthy());
    expect(screen.queryByText('09:00')).toBeNull();
  });
});
