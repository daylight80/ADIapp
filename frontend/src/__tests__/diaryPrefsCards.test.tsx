import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const mockGet = jest.fn();
const mockSet = jest.fn();
jest.mock('../supabaseDb', () => ({
  getMyDiaryPrefs: (...a: unknown[]) => mockGet(...a),
  setMyDiaryPrefs: (...a: unknown[]) => mockSet(...a),
}));

import { LessonTypesCard, WorkingHoursCard, LessonLengthsCard } from '../DiaryPrefsCards';

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue({});
  mockSet.mockReset().mockImplementation(async (p: object) => p);
});

describe('Lesson types card', () => {
  it('ticks everything by default and saves the list when one is unticked', async () => {
    await render(<LessonTypesCard />);
    await fireEvent.press(screen.getByTestId('lesson-type-pref-Night'));
    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1));
    const saved = mockSet.mock.calls[0][0].lesson_types as string[];
    expect(saved).toHaveLength(10);
    expect(saved).not.toContain('Night');
  });

  it('will not untick the last type', async () => {
    mockGet.mockResolvedValue({ lesson_types: ['Standard'] });
    await render(<LessonTypesCard />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('lesson-type-pref-Standard'));
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('shows the reason when saving fails', async () => {
    mockSet.mockRejectedValue(new Error('Nope'));
    await render(<LessonTypesCard />);
    await fireEvent.press(screen.getByTestId('lesson-type-pref-Night'));
    expect(await screen.findByTestId('lesson-types-error')).toBeTruthy();
  });
});

describe('Working hours card', () => {
  it('saves both ends when one is changed', async () => {
    await render(<WorkingHoursCard />);
    await fireEvent.press(screen.getByTestId('work-end-17:00'));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith({ work_start: '08:00', work_end: '17:00' }));
  });
});

describe('Lesson lengths card', () => {
  it('adds a length, then saves the price typed for it', async () => {
    await render(<LessonLengthsCard />);
    await fireEvent.press(screen.getByTestId('length-pref-90'));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith({ lesson_lengths: [{ minutes: 90, price: null }] }));
    await fireEvent.changeText(await screen.findByTestId('length-price-90'), '55');
    await fireEvent.press(screen.getByTestId('length-prices-save'));
    await waitFor(() => expect(mockSet).toHaveBeenLastCalledWith({ lesson_lengths: [{ minutes: 90, price: 55 }] }));
  });
});
