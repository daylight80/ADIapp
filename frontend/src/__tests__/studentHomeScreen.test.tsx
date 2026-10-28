import React from 'react';
import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

let mockTier = 'pro';
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'priya@example.com', tier: mockTier } }) }));

const mockStudent = { id: 's1', name: 'Priya Nair', email: 'priya@example.com', phone: '07000000000', address: '1 Elm', postcode: 'M1 1AA', test_date: '2026-11-06' as string | null };
const mockLessons = [
  { id: 'l1', student_id: 's1', date: '2026-10-01', start_time: '09:00', end_time: '10:00', status: 'Completed', lesson_type: 'Standard', topic: 'Roundabouts' },
  { id: 'l2', student_id: 's1', date: '2099-01-01', start_time: '10:20', end_time: '11:20', status: 'Scheduled', lesson_type: 'Standard', topic: 'Parallel parking', pickup_address: '14 Station Rd' },
];
let mockBookings: any[] = [];
jest.mock('../useSupabaseData', () => ({
  useStudentByAuthId: () => ({ student: mockStudent }),
  useStudentByEmail: () => ({ student: null }),
  useCompetencies: () => ({ competencies: [
    { category_key: 'roundabouts', category_name: 'Roundabouts', level: 2, progress: 40 },
    { category_key: 'junctions', category_name: 'Junctions', level: 5, progress: 100 },
  ] }),
  useLessonsForStudent: () => ({ lessons: mockLessons, loading: false, refresh: jest.fn() }),
  useBadges: () => ({ badges: [] }),
  useReflectiveLogs: () => ({ logs: [] }),
  useMockTestAttempts: () => ({ attempts: [] }),
  useBlockBookings: () => ({ bookings: mockBookings, loading: false }),
  createReflectiveLog: jest.fn(),
}));
const mockCard = jest.fn();
jest.mock('../supabaseDb', () => ({
  DVSA_SYLLABUS: new Array(30).fill(0),
  rateLessonConfidence: jest.fn(),
  getMyInstructorCard: () => mockCard(),
}));
jest.mock('../usePupilGoal', () => ({ usePupilGoal: () => null }));
jest.mock('../pupilAgreement', () => ({ agreementStatus: () => ({ signed: true }) }));
jest.mock('../pupilDetails', () => ({ missingPupilDetails: () => [] }));
jest.mock('../BottomNav', () => ({ BottomNav: () => null }));
jest.mock('../SlotAlertsCard', () => ({ SlotAlertsCard: () => null }));
jest.mock('../PupilMockResultCard', () => ({ PupilMockResultCard: () => null }));
jest.mock('../PupilSummariesCard', () => ({ PupilSummariesCard: () => null, usePupilSummaries: () => [] }));
jest.mock('../SignInFasterCard', () => ({ SignInFasterCard: () => null }));
jest.mock('../PupilConfidenceCard', () => ({ PupilConfidenceCard: () => null }));

import StudentHome from '../../app/student-home-screen';

beforeEach(() => {
  mockPush.mockReset();
  mockTier = 'pro';
  mockStudent.test_date = '2026-11-06';
  mockBookings = [];
  mockCard.mockResolvedValue({ instructor_name: 'Sam Okafor', contact_phone: '07111 222 333' });
});

describe('Pupil home screen', () => {
  it('greets the pupil and shows the next lesson card with a Message button for their instructor', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    await render(<StudentHome />);
    expect(screen.getByText('Your learner account')).toBeTruthy();
    expect(screen.getByText('Hi Priya')).toBeTruthy();
    expect(screen.getByText('Your next lesson')).toBeTruthy();
    expect(screen.getByTestId('v2-student-next-lesson-when')).toBeTruthy();

    await fireEvent.press(await screen.findByText('Message Sam'));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^sms:07111222333/));
    open.mockRestore();
  });

  it('has no Message button when the instructor shares no phone number', async () => {
    mockCard.mockResolvedValue({ instructor_name: 'Sam Okafor', contact_phone: null });
    await render(<StudentHome />);
    await screen.findByText('Your next lesson');
    expect(screen.queryByTestId('v2-student-message-instructor')).toBeNull();
  });

  it('shows lessons done, prepaid hours left and the test date as tiles', async () => {
    mockBookings = [{ hours_paid: 10, hours_used: 7 }];
    await render(<StudentHome />);
    expect(screen.getByTestId('v2-tile-lessons')).toHaveTextContent('1');
    expect(screen.getByTestId('v2-tile-prepaid')).toHaveTextContent('3 h');
    expect(screen.getByTestId('v2-tile-test')).toHaveTextContent('6 Nov');
  });

  it('hides the prepaid tile with no bookings and says Not set with no test date', async () => {
    mockStudent.test_date = null;
    await render(<StudentHome />);
    expect(screen.queryByTestId('v2-tile-prepaid')).toBeNull();
    expect(screen.getByTestId('v2-tile-test')).toHaveTextContent('Not set');
  });

  it('shows skill bars as level out of 5 and opens the skill on a tap', async () => {
    await render(<StudentHome />);
    expect(screen.getByText('2 of 5')).toBeTruthy();
    expect(screen.getByText('5 of 5')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('v2-comp-roundabouts'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/competency-detail-screen', params: { id: 's1', key: 'roundabouts' } });
  });

  it('locks the skill tracker on a Starter plan but keeps the tiles', async () => {
    mockTier = 'starter';
    await render(<StudentHome />);
    expect(screen.getByText('Tracker locked')).toBeTruthy();
    expect(screen.queryByTestId('v2-comp-roundabouts')).toBeNull();
    expect(screen.getByTestId('v2-tile-lessons')).toBeTruthy();
  });
});
