import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }), useLocalSearchParams: () => ({}) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', tier: 'pro' } }) }));
jest.mock('../useBankHolidays', () => ({ useBankHolidays: () => ({ holidays: {} }) }));

const mockLessons = jest.fn();
jest.mock('../useSupabaseData', () => ({
  useLessonsForWeek: () => ({ lessons: mockLessons(), error: null, refresh: jest.fn(), offline: false }),
  useLessonsForMonth: () => ({ lessons: mockLessons(), error: null, refresh: jest.fn(), offline: false }),
  useStudents: () => ({ students: [{ id: 's1', name: 'Sam Lee' }, { id: 's2', name: 'Jo Park' }] }),
  useAvailabilityBlocks: () => ({ blocks: [] }),
}));
jest.mock('../supabaseDb', () => ({ getInstructorHourlyRate: jest.fn().mockResolvedValue(36) }));
jest.mock('../offlineSync', () => ({ patchLessonOfflineAware: jest.fn() }));
jest.mock('../OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('../BottomNav', () => ({ BottomNav: () => null }));
jest.mock('../LessonToolsSheet', () => ({ LessonToolsSheet: () => null }));
jest.mock('../diary/AddLessonSheet', () => ({ AddLessonSheet: () => null }));
jest.mock('../UnavailabilityModal', () => ({ UnavailabilityModal: () => null }));
jest.mock('../diary/DraggableLessonBlock', () => {
  const { View } = require('react-native');
  return { DraggableLessonBlock: ({ children, testID }: any) => <View testID={testID}>{children}</View> };
});

import LessonDiaryScreen from '../../app/lesson-diary-screen';
import { localDateKey } from '../diary/dateUtils';

const today = localDateKey(new Date());
const lesson = (id: string, student_id: string, start_time: string, end_time: string, status: string) => ({
  id, student_id, date: today, start_time, end_time, status, lesson_type: 'Standard', topic: null, travel_minutes: 0,
});

beforeEach(() => {
  mockLessons.mockReset().mockReturnValue([
    lesson('live1', 's1', '09:00', '10:00', 'Scheduled'),
    lesson('gone1', 's2', '11:00', '12:00', 'Cancelled'),
  ]);
});

describe('cancelled lessons in the diary', () => {
  it('leaves them out of the day, and out of the lesson count and hours', async () => {
    await render(<LessonDiaryScreen />);
    expect(screen.getByTestId('v2-lesson-live1')).toBeTruthy();
    expect(screen.queryByTestId('v2-lesson-gone1')).toBeNull();
    expect(screen.queryByTestId('v2-cancelled-gone1')).toBeNull();
    expect(screen.getByText('1 lessons · 1h')).toBeTruthy();
  });

  it('offers a Show cancelled chip with the count, and shows them greyed and tagged when pressed', async () => {
    await render(<LessonDiaryScreen />);
    await fireEvent.press(screen.getByText('Show cancelled (1)'));
    expect(screen.getByTestId('v2-cancelled-gone1')).toBeTruthy();
    expect(screen.getByText('CANCELLED')).toBeTruthy();
    // still not counted as a lesson, and the live one is untouched
    expect(screen.getByText('1 lessons · 1h')).toBeTruthy();
    expect(screen.getByTestId('v2-lesson-live1')).toBeTruthy();
    await fireEvent.press(screen.getByText('Hide cancelled'));
    expect(screen.queryByTestId('v2-cancelled-gone1')).toBeNull();
  });

  it('shows no chip when nothing is cancelled that day', async () => {
    mockLessons.mockReturnValue([lesson('live1', 's1', '09:00', '10:00', 'Scheduled')]);
    await render(<LessonDiaryScreen />);
    expect(screen.queryByTestId('v2-show-cancelled')).toBeNull();
  });

  it('does not count them in the month view either', async () => {
    await render(<LessonDiaryScreen />);
    await fireEvent.press(screen.getByTestId('v2-view-month'));
    expect(screen.getByText('1 lesson')).toBeTruthy();
  });
});
