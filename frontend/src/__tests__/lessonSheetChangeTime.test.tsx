import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../supabaseDb', () => ({
  listWaitingList: jest.fn(async () => []),
  studentAppUsageWarning: () => null,
  listMyLessonNoteQuestions: jest.fn(async () => []),
  getLastLessonFocus: jest.fn(async () => null),
  DVSA_SYLLABUS: [],
}));
jest.mock('../offlineSync', () => ({
  patchLessonOfflineAware: jest.fn(), queueLessonWrite: jest.fn(), useIsOnline: () => true,
  isNetworkError: jest.requireActual('../networkError').isNetworkError,
}));
jest.mock('../useSupabaseData', () => ({
  patchLesson: jest.fn(),
  useStudent: () => ({ student: { id: 'st1', name: 'Sam Lee', phone: '07700900123', email: '', address: '', postcode: '', hourly_rate: 40 } }),
  useStudents: () => ({ students: [] }),
  useVehicles: () => ({ vehicles: [] }),
  useInstructorProfile: () => ({ profile: null }),
  useCompetencies: () => ({ competencies: [] }),
  countUpcomingInSeries: jest.fn(async () => 0),
  cancelSeriesFromDate: jest.fn(),
}));
let mockRole: string | undefined;
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { tier: 'pro', instructor_id: 'i1', role: mockRole } }) }));
jest.mock('../PaywallModal', () => ({ PaywallModal: () => null }));
jest.mock('../LessonSummarySheet', () => ({ LessonSummarySheet: () => null }));
jest.mock('../SlotAlertLine', () => ({ SlotAlertLine: () => null }));
jest.mock('../AddressSearch', () => ({ AddressSearch: () => null }));
jest.mock('../DateTimeFields', () => ({ TimeField: () => null, DateField: () => null }));
jest.mock('../notifications', () => ({ fireInstantNotification: jest.fn() }));
jest.mock('../tools', () => ({ openNavigation: jest.fn(), openSmsComposer: jest.fn() }));
jest.mock('../maps', () => ({ getTravelTime: jest.fn(async () => null), lessonAddress: () => '' }));
jest.mock('../precheckMemory', () => ({ pupilHasConfirmedPrecheck: jest.fn(async () => false) }));
// The sheet itself is tested on its own (changeTimeSheet.test.tsx): here only how the lesson sheet opens and closes it.
jest.mock('../diary/ChangeTimeSheet', () => ({
  ChangeTimeSheet: ({ visible, onMoved }: any) => {
    const { TouchableOpacity } = require('react-native');
    return visible ? <TouchableOpacity testID="mock-change-time" onPress={() => onMoved({ date: '2099-11-02', startTime: '10:00', endTime: '12:00', queued: false })} /> : null;
  },
}));

import { LessonToolsSheet } from '../LessonToolsSheet';

const lesson: any = {
  id: 'l1', student_id: 'st1', instructor_id: 'i1', vehicle_id: 'v1', date: '2099-11-01', start_time: '09:00', end_time: '11:00',
  duration_hours: 2, topic: 'Roundabouts', lesson_type: 'Standard', driving_faults: 0, serious_faults: 0, dangerous_faults: 0,
  status: 'Scheduled', amount_paid: 40,
};
const open = async (l: any = lesson, handlers: { onClose?: jest.Mock; onChanged?: jest.Mock } = {}) => {
  await render(<LessonToolsSheet visible lesson={l} onClose={handlers.onClose ?? jest.fn()} onChanged={handlers.onChanged ?? jest.fn()} />);
};

beforeEach(() => { mockRole = undefined; });

describe('the Change date or time link on the lesson sheet', () => {
  it('is there for the teacher on a lesson still to be taught', async () => {
    await open();
    expect(screen.getByTestId('btn-change-time')).toHaveTextContent('Change date or time');
  });

  it.each(['Completed', 'Cancelled'])('is not there once the lesson is %s', async (status) => {
    await open({ ...lesson, status });
    expect(screen.queryByTestId('btn-change-time')).toBeNull();
  });

  it('is not there for a Practical Test, which has its own edit sheet', async () => {
    await open({ ...lesson, lesson_type: 'Practical Test' });
    expect(screen.queryByTestId('btn-change-time')).toBeNull();
  });

  it('is never there for a pupil, even on a scheduled lesson', async () => {
    mockRole = 'student';
    await open();
    expect(screen.queryByTestId('btn-change-time')).toBeNull();
  });

  it('opens the sheet, and once the lesson has moved closes both and tells the diary to redraw', async () => {
    const onClose = jest.fn();
    const onChanged = jest.fn();
    await open(lesson, { onClose, onChanged });
    expect(screen.queryByTestId('mock-change-time')).toBeNull();
    await fireEvent.press(screen.getByTestId('btn-change-time'));
    await fireEvent.press(screen.getByTestId('mock-change-time'));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mock-change-time')).toBeNull();
  });
});
