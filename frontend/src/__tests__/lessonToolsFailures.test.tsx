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
let mockTier = 'pro';
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { tier: mockTier, instructor_id: 'i1' } }) }));
jest.mock('../PaywallModal', () => ({ PaywallModal: () => null }));
jest.mock('../LessonSummarySheet', () => ({
  LessonSummarySheet: ({ visible, onClose }: any) => {
    const { TouchableOpacity } = require('react-native');
    return visible ? <TouchableOpacity testID="mock-summary-close" onPress={onClose} /> : null;
  },
}));
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
  mockTier = 'pro';
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

  it('says on the form, not in an alert, that a grade is needed, and clears the message once one is picked', async () => {
    mockPatch.mockResolvedValue({});
    await open(jest.fn(), { onBookNext: jest.fn() });
    await fireEvent.press(screen.getByTestId('btn-open-complete'));
    await fireEvent.press(await screen.findByTestId('btn-save-complete'));
    expect(await screen.findByTestId('complete-error')).toHaveTextContent('Choose a grade from 1 to 5 before completing the lesson.');
    expect(mockPatch).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('grade-3'));
    expect(screen.queryByTestId('complete-error')).toBeNull();
  });

  it('offers the summary first, with no Book next button yet', async () => {
    mockPatch.mockResolvedValue({});
    const onBookNext = jest.fn();
    await open(jest.fn(), { onBookNext });
    await complete();
    expect(await screen.findByTestId('btn-saved-write-summary')).toBeTruthy();
    expect(screen.getByTestId('btn-saved-not-now')).toBeTruthy();
    expect(screen.queryByTestId('btn-book-next-lesson')).toBeNull();
    expect(onBookNext).not.toHaveBeenCalled();
  });

  it('Not now goes straight on to booking the next lesson', async () => {
    mockPatch.mockResolvedValue({});
    const onClose = jest.fn();
    const onBookNext = jest.fn();
    await render(<LessonToolsSheet visible lesson={lesson} onClose={onClose} onChanged={jest.fn()} onBookNext={onBookNext} />);
    await complete();
    await fireEvent.press(await screen.findByTestId('btn-saved-not-now'));
    expect(onBookNext).toHaveBeenCalledWith('st1');
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('lesson-saved-dialog')).toBeNull();
  });

  it('writing the summary comes first, and closing it (sent or not) then goes on to booking', async () => {
    mockPatch.mockResolvedValue({});
    const onBookNext = jest.fn();
    await open(jest.fn(), { onBookNext });
    await complete();
    await fireEvent.press(await screen.findByTestId('btn-saved-write-summary'));
    expect(onBookNext).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByTestId('mock-summary-close'));
    expect(onBookNext).toHaveBeenCalledTimes(1);
    expect(onBookNext).toHaveBeenCalledWith('st1');
  });

  it('a summary opened from Lesson Tools on its own does not start booking', async () => {
    const onBookNext = jest.fn();
    await open(jest.fn(), { onBookNext });
    await fireEvent.press(screen.getByTestId('btn-write-summary-open'));
    await fireEvent.press(await screen.findByTestId('mock-summary-close'));
    expect(onBookNext).not.toHaveBeenCalled();
  });

  it('a plan without summaries skips that step and goes straight to booking', async () => {
    mockTier = 'starter';
    mockPatch.mockResolvedValue({});
    const onBookNext = jest.fn();
    await open(jest.fn(), { onBookNext });
    await complete();
    await waitFor(() => expect(onBookNext).toHaveBeenCalledWith('st1'));
    expect(screen.queryByTestId('lesson-saved-dialog')).toBeNull();
  });

  it('correcting a lesson that was already completed just saves, with no prompts', async () => {
    mockPatch.mockResolvedValue({});
    const onBookNext = jest.fn();
    const onChanged = jest.fn();
    await render(<LessonToolsSheet visible lesson={{ ...lesson, status: 'Completed', grade: 3 }} onClose={jest.fn()} onChanged={onChanged} onBookNext={onBookNext} />);
    await fireEvent.press(screen.getByTestId('btn-open-complete'));
    await fireEvent.press(await screen.findByTestId('grade-4'));
    await fireEvent.press(screen.getByTestId('btn-save-complete'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByTestId('lesson-saved-dialog')).toBeNull();
    expect(onBookNext).not.toHaveBeenCalled();
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

  it('is greyed out and does nothing once the lesson is completed', async () => {
    const onClose = jest.fn();
    await render(<LessonToolsSheet visible lesson={{ ...lesson, status: 'Completed' }} onClose={onClose} onChanged={jest.fn()} />);
    const button = screen.getByTestId('btn-record-route');
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(button);
    expect(mockPush).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is still live for a lesson that is not completed, even if the pupil has completed others', async () => {
    await render(<LessonToolsSheet visible lesson={{ ...lesson, status: 'Scheduled' }} onClose={jest.fn()} onChanged={jest.fn()} />);
    expect(screen.getByTestId('btn-record-route').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('is greyed out on a completed lesson on a plan without route recording too, with no upgrade prompt', async () => {
    mockTier = 'starter';
    await render(<LessonToolsSheet visible lesson={{ ...lesson, status: 'Completed' }} onClose={jest.fn()} onChanged={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('btn-record-route'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByText(/upgrade/i)).toBeNull();
  });
});
