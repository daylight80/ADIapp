import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

let mockTier = 'pro';
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Sam Okafor', tier: mockTier } }) }));

const mockToday = { lessons: [] as any[], loading: false, error: null as string | null, refresh: jest.fn() };
jest.mock('../useSupabaseData', () => ({
  useStudents: () => ({ students: [
    { id: 's1', name: 'Ben Carter', status: 'Active', phone: '07000000001', address: '1 Elm Grove' },
    { id: 's2', name: 'Priya Nair', status: 'Test Ready', phone: '07000000002' },
  ] }),
  useTodayLessons: () => mockToday,
  useInstructorEarnings: () => ({ mtdEarned: 3486, mtdUnpaid: 420, mtdLessonCount: 40, byMonth: [{ label: 'Sep', value: 3390 }, { label: 'Oct', value: 3486 }] }),
  useInstructorTestOutcomes: () => ({ rows: [] }),
  useCompetencyPatterns: () => ({ patterns: [{ category_key: 'pp', category_name: 'Parallel parking', studentsStruggling: 1, studentsAssessed: 2 }] }),
}));
jest.mock('../supabaseDb', () => ({
  computeTestKpis: () => ({ passRatePct: 71, total: 7 }),
  getMySchoolProfile: jest.fn().mockResolvedValue(null),
}));
jest.mock('../offlineSync', () => ({ usePendingSyncCount: () => 0 }));
const mockSms = jest.fn();
jest.mock('../tools', () => ({ openSmsComposer: (...a: any[]) => mockSms(...a) }));
jest.mock('../OpenInMapsButton', () => {
  const { Text } = require('react-native');
  return { OpenInMapsButton: ({ label, testID }: any) => <Text testID={testID}>{label}</Text> };
});
// Cards with their own data and tests: not part of this screen's layout.
jest.mock('../BottomNav', () => ({ BottomNav: () => null }));
jest.mock('../LessonToolsSheet', () => ({ LessonToolsSheet: () => null }));
jest.mock('../ContactsImportBanner', () => ({ ContactsImportBanner: () => null }));
jest.mock('../ReferralBanner', () => ({ ReferralBanner: () => null }));
jest.mock('../DeadlinesBanner', () => ({ DeadlinesBanner: () => null }));
jest.mock('../ActionCentreCard', () => ({ ActionCentreCard: () => null }));
jest.mock('../RoadBriefingCard', () => ({ RoadBriefingCard: () => null }));
jest.mock('../SetupChecklistCard', () => ({ SetupChecklistCard: () => null }));
jest.mock('../PaywallModal', () => ({ PaywallModal: () => null }));
jest.mock('../OfflineBanner', () => ({ OfflineBanner: () => null }));

import HomeScreen from '../../app/home-screen';

const lesson = (id: string, student_id: string, start_time: string, end_time: string, extra: any = {}) => ({
  id, student_id, start_time, end_time, status: 'Scheduled', lesson_type: 'Standard', topic: null, pickup_address: null, ...extra,
});

beforeEach(() => {
  mockPush.mockReset();
  mockSms.mockReset();
  mockToday.lessons = [];
  mockToday.loading = false;
  mockToday.error = null;
  mockTier = 'pro';
});

describe('Instructor Home', () => {
  it('greets by first name and shows the lesson card with Navigate and I\'ve arrived', async () => {
    mockToday.lessons = [lesson('l1', 's1', '23:00', '23:59', { topic: 'Parallel parking', pickup_address: '22 Elm Grove' })];
    await render(<HomeScreen />);
    expect(screen.getByText(/^(Morning|Afternoon|Evening), Sam$/)).toBeTruthy();
    expect(screen.getAllByText('Ben Carter')).toHaveLength(2); // the lesson card and the timeline
    expect(screen.getByText('Pick-up: 22 Elm Grove')).toBeTruthy();
    expect(screen.getByTestId('v2-home-nav-quick-l1')).toHaveTextContent('Navigate');

    await fireEvent.press(screen.getByTestId('v2-home-arrived-l1'));
    expect(mockSms).toHaveBeenCalledWith('07000000001', "Hi Ben, I've arrived for your lesson!");
  });

  it('shows the gap between lessons on the timeline, tagged Tight when short', async () => {
    mockToday.lessons = [lesson('l1', 's1', '09:00', '10:00'), lesson('l2', 's2', '10:10', '11:10')];
    await render(<HomeScreen />);
    expect(screen.getByText('10 min until the next lesson')).toBeTruthy();
    expect(screen.getByText('Tight')).toBeTruthy();
    expect(screen.getByTestId('v2-home-row-l2')).toBeTruthy();
  });

  it('shows an empty day with a way to open the diary', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('No lessons today')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('v2-home-cta-empty'));
    expect(mockPush).toHaveBeenCalledWith('/lesson-diary-screen');
  });

  it('shows a failed load as an error with Try again, not as an empty day', async () => {
    mockToday.error = 'offline';
    await render(<HomeScreen />);
    expect(screen.getByTestId('v2-home-lessons-error')).toBeTruthy();
    expect(screen.queryByText('No lessons today')).toBeNull();
    await fireEvent.press(screen.getByTestId('v2-home-lessons-retry'));
    expect(mockToday.refresh).toHaveBeenCalled();
  });

  it('opens the Students list on the matching filter from each pupil tile', async () => {
    await render(<HomeScreen />);
    for (const [id, filter] of [['active', 'Active'], ['testready', 'Test Ready'], ['waitlist', 'Waitlist'], ['passed', 'Passed']]) {
      mockPush.mockReset();
      await fireEvent.press(screen.getByTestId(`v2-pupils-${id}`));
      expect(mockPush).toHaveBeenCalledWith({ pathname: '/student-crm-screen', params: { filter } });
    }
  });

  it('keeps earnings hidden until Reveal is pressed', async () => {
    await render(<HomeScreen />);
    expect(screen.getAllByText('£•••').length).toBeGreaterThan(0);
    expect(screen.queryByText('£3486')).toBeNull();
    await fireEvent.press(screen.getByTestId('v2-toggle-earnings'));
    expect(screen.getByText('£3486')).toBeTruthy();
    expect(screen.getByText('£420')).toBeTruthy();
  });

  it('hides the paid money, pupils and help cards on Starter and shows the upgrade banner', async () => {
    mockTier = 'starter';
    await render(<HomeScreen />);
    expect(screen.queryByTestId('v2-toggle-earnings')).toBeNull();
    expect(screen.queryByText('Where pupils need help')).toBeNull();
    expect(screen.getByTestId('v2-upgrade-banner')).toBeTruthy();
  });
});
