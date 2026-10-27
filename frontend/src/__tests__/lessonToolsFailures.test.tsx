import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../supabaseDb', () => ({
  listWaitingList: jest.fn(async () => []),
  studentAppUsageWarning: () => null,
  listMyLessonNoteQuestions: jest.fn(async () => []),
  getLastLessonFocus: jest.fn(async () => null),
  DVSA_SYLLABUS: [],
}));

const mockPatchAware = jest.fn();
const mockQueue = jest.fn();
jest.mock('../offlineSync', () => ({
  patchLessonOfflineAware: (...a: unknown[]) => mockPatchAware(...a),
  queueLessonWrite: (...a: unknown[]) => mockQueue(...a),
  useIsOnline: () => true,
  isNetworkError: jest.requireActual('../networkError').isNetworkError,
}));
const mockPatch = jest.fn();
jest.mock('../useSupabaseData', () => ({
  patchLesson: (...a: unknown[]) => mockPatch(...a),
  useStudent: () => ({ student: { id: 'st1', name: 'Sam Lee', phone: '07700900123', email: '', address: '', postcode: '', hourly_rate: 40 } }),
  useStudents: () => ({ students: [] }),
  useVehicles: () => ({ vehicles: [] }),
  useInstructorProfile: () => ({ profile: null }),
  useCompetencies: () => ({ competencies: [] }),
  countUpcomingInSeries: jest.fn(async () => 0),
  cancelSeriesFromDate: jest.fn(),
}));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { tier: 'pro', instructor_id: 'i1' } }) }));
jest.mock('../PaywallModal', () => ({ PaywallModal: () => null }));
jest.mock('../LessonSummarySheet', () => ({ LessonSummarySheet: () => null }));
jest.mock('../SlotAlertLine', () => ({ SlotAlertLine: () => null }));
jest.mock('../AddressSearch', () => ({ AddressSearch: () => null }));
jest.mock('../DateTimeFields', () => ({ TimeField: () => null }));
jest.mock('../notifications', () => ({ fireInstantNotification: jest.fn() }));
jest.mock('../tools', () => ({ openNavigation: jest.fn(), openSmsComposer: jest.fn() }));
jest.mock('../maps', () => ({ getTravelTime: jest.fn(async () => null), lessonAddress: () => '' }));

import { LessonToolsSheet } from '../LessonToolsSheet';

const lesson: any = {
  id: 'l1', student_id: 'st1', instructor_id: 'i1', vehicle_id: 'v1', date: '2026-10-30', start_time: '10:00', end_time: '11:00',
  duration_hours: 1, topic: 'Roundabouts', lesson_type: 'Standard', driving_faults: 0, serious_faults: 0, dangerous_faults: 0,
  status: 'Scheduled', amount_paid: 40,
};

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  [mockPatchAware, mockQueue, mockPatch, mockPush].forEach((m) => m.mockReset());
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const open = async (onChanged = jest.fn(), extra: Record<string, unknown> = {}) => {
  await render(<LessonToolsSheet visible lesson={lesson} onClose={jest.fn()} onChanged={onChanged} {...extra} />);
  return onChanged;
};

describe('a failed save is never reported as done', () => {
  it('cancelling: a real failure keeps the sheet open, says so, and does not offer the waiting-list alert', async () => {
    mockPatchAware.mockRejectedValue(new Error('JWT expired'));
    const onChanged = await open();
    await fireEvent.press(screen.getByTestId('btn-cancel-lesson'));
    await fireEvent.press(await screen.findByTestId('btn-cancel-waive-charge'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not cancel the lesson', 'JWT expired'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('btn-cancel-keep-lesson')).toBeTruthy(); // the cancel sheet is still open
  });

  it('cancelling works as before when the save succeeds', async () => {
    mockPatchAware.mockResolvedValue({ queued: false });
    const onChanged = await open();
    await fireEvent.press(screen.getByTestId('btn-cancel-lesson'));
    await fireEvent.press(await screen.findByTestId('btn-cancel-waive-charge'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(alertSpy).not.toHaveBeenCalledWith('Could not cancel the lesson', expect.anything());
  });

  it('pre-lesson check: a failure is reported, not logged as complete', async () => {
    mockPatchAware.mockRejectedValue(new Error('permission denied'));
    const onChanged = await open();
    for (const id of ['precheck-eye', 'precheck-fit', 'precheck-lic']) await fireEvent.press(screen.getByTestId(id));
    await fireEvent.press(screen.getByTestId('btn-confirm-precheck'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not save the pre-lesson check', 'permission denied'));
    expect(alertSpy).not.toHaveBeenCalledWith('Pre-lesson check complete', expect.anything());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('pre-lesson check: a saved check says so', async () => {
    mockPatchAware.mockResolvedValue({ queued: false });
    await open();
    for (const id of ['precheck-eye', 'precheck-fit', 'precheck-lic']) await fireEvent.press(screen.getByTestId(id));
    await fireEvent.press(screen.getByTestId('btn-confirm-precheck'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Pre-lesson check complete', expect.any(String)));
  });
});

describe('after completing a lesson', () => {
  const complete = async () => {
    await fireEvent.press(screen.getByTestId('btn-open-complete'));
    await fireEvent.press(await screen.findByTestId('grade-3'));
    await fireEvent.press(screen.getByTestId('btn-save-complete'));
  };

  it('offers Book next lesson, which closes the sheet and hands over the pupil', async () => {
    mockPatch.mockResolvedValue({});
    const onClose = jest.fn();
    const onBookNext = jest.fn();
    await render(<LessonToolsSheet visible lesson={lesson} onClose={onClose} onChanged={jest.fn()} onBookNext={onBookNext} />);
    await complete();
    await fireEvent.press(await screen.findByTestId('btn-book-next-lesson'));
    expect(onBookNext).toHaveBeenCalledWith('st1');
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('lesson-saved-dialog')).toBeNull();
  });

  it('Not now just closes the dialog and books nothing', async () => {
    mockPatch.mockResolvedValue({});
    const onBookNext = jest.fn();
    await open(jest.fn(), { onBookNext });
    await complete();
    await fireEvent.press(await screen.findByTestId('btn-saved-not-now'));
    expect(onBookNext).not.toHaveBeenCalled();
    expect(screen.queryByTestId('lesson-saved-dialog')).toBeNull();
  });

  it('a failed save shows no dialog', async () => {
    mockPatch.mockRejectedValue(new Error('JWT expired'));
    await open(jest.fn(), { onBookNext: jest.fn() });
    await complete();
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not save the lesson', 'JWT expired'));
    expect(screen.queryByTestId('lesson-saved-dialog')).toBeNull();
  });
});

describe('Start lesson', () => {
  it('opens the recorder for this lesson and pupil and asks it to start at once', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('btn-record-route'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/route-recorder-screen',
      params: { lessonId: 'l1', studentId: 'st1', studentName: 'Sam Lee', autostart: '1' },
    });
  });
});
