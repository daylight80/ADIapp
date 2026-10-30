import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

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
const mockPatchAware = jest.fn();
jest.mock('../offlineSync', () => ({
  patchLessonOfflineAware: (...a: unknown[]) => mockPatchAware(...a),
  queueLessonWrite: jest.fn(),
  useIsOnline: () => true,
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
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { tier: 'pro', instructor_id: 'i1' } }) }));
jest.mock('../PaywallModal', () => ({ PaywallModal: () => null }));
jest.mock('../LessonSummarySheet', () => ({ LessonSummarySheet: () => null }));
jest.mock('../SlotAlertLine', () => ({ SlotAlertLine: () => null }));
jest.mock('../AddressSearch', () => ({ AddressSearch: () => null }));
jest.mock('../DateTimeFields', () => ({ TimeField: () => null }));
jest.mock('../notifications', () => ({ fireInstantNotification: jest.fn() }));
jest.mock('../tools', () => ({ openNavigation: jest.fn(), openSmsComposer: jest.fn() }));
jest.mock('../maps', () => ({ getTravelTime: jest.fn(async () => null), lessonAddress: () => '' }));
let mockRemembered = false;
jest.mock('../precheckMemory', () => ({ pupilHasConfirmedPrecheck: jest.fn(async () => mockRemembered) }));

import { LessonToolsSheet } from '../LessonToolsSheet';

const lesson: any = {
  id: 'l2', student_id: 'st1', instructor_id: 'i1', vehicle_id: 'v1', date: '2026-10-30', start_time: '10:00', end_time: '11:00',
  duration_hours: 1, topic: 'Roundabouts', lesson_type: 'Standard', driving_faults: 0, serious_faults: 0, dangerous_faults: 0,
  status: 'Scheduled', amount_paid: 40,
};

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockPatchAware.mockReset();
  mockRemembered = false;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const open = async () => { await render(<LessonToolsSheet visible lesson={lesson} onClose={jest.fn()} onChanged={jest.fn()} />); };

describe('the lesson sheet buttons', () => {
  it('put your private notes before the summary for the pupil, the order a lesson goes in', async () => {
    await open();
    const ids = screen.getAllByTestId(/^(btn-lesson-notes|btn-write-summary-open)$/).map((n) => n.props.testID);
    expect(ids).toEqual(['btn-lesson-notes', 'btn-write-summary-open']);
  });
});

describe('the pre-lesson check', () => {
  it('asks for all three at a pupil\'s first lesson', async () => {
    await open();
    expect(screen.queryByTestId('precheck-remembered')).toBeNull();
    await fireEvent.press(screen.getByTestId('precheck-fit'));
    await fireEvent.press(screen.getByTestId('btn-confirm-precheck'));
    expect(mockPatchAware).not.toHaveBeenCalled();
  });

  it('remembers eyesight and licence from an earlier lesson, so only fit to drive is needed', async () => {
    mockRemembered = true;
    mockPatchAware.mockResolvedValue({ queued: false });
    await open();
    expect(await screen.findByTestId('precheck-remembered')).toHaveTextContent("Eyesight and licence were confirmed at Sam's first lesson. Only fit to drive needs checking now.");
    await fireEvent.press(screen.getByTestId('btn-confirm-precheck')); // fit to drive not ticked yet
    expect(mockPatchAware).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('precheck-fit'));
    await fireEvent.press(screen.getByTestId('btn-confirm-precheck'));
    await waitFor(() => expect(mockPatchAware).toHaveBeenCalledWith('l2', { pre_check_completed_at: expect.any(String) }, expect.any(String)));
  });
});
