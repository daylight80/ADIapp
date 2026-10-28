import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

let mockTier = 'franchise';
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Sam Okafor', tier: mockTier } }) }));
jest.mock('../supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }));
jest.mock('../DateTimeFields', () => ({ DateField: () => null }));
jest.mock('../tools', () => ({ copyToClipboard: jest.fn(), openSmsComposer: jest.fn() }));
jest.mock('../useSupabaseData', () => ({ inviteInstructor: jest.fn() }));
jest.mock('../supabaseDb', () => ({
  listTestOutcomesForSchool: async () => [],
  computeTestKpis: () => ({ practicalTotal: 0, practicalPasses: 0, practicalPassRatePct: 0, total: 0, passRatePct: 0 }),
  getArrearsSummary: async () => ({ count: 14, total_gbp: 3180 }),
  getMySchoolProfile: async () => ({ id: 'sch1' }),
  buildInstructorInviteLink: () => 'https://example.test/invite',
}));

const leaderboard = (tier: string) => ({
  school_id: 'sch1', business_name: 'Northside Driving School', month_iso: '2026-10', tier,
  seat_count: 3, seat_limit: 6, can_add_instructor: true,
  totals: { students_active: 118, lessons_month: 512, revenue_month: 18420, pass_rate: 71 },
  totals_prev_month: { lessons_month: 480, revenue_month: 17010 },
  rows: [
    { instructor_id: 'i1', full_name: 'Sam Okafor', adi_number: '111', is_owner: true, students_active: 24, lessons_month: 118, revenue_month: 5000, pass_rate: 74 },
    { instructor_id: 'i2', full_name: 'Hannah Doyle', adi_number: '222', is_owner: false, students_active: 21, lessons_month: 140, revenue_month: 4000, pass_rate: 68 },
  ],
});
let mockBoardStatus = 200;
beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockTier = 'franchise';
  mockBoardStatus = 200;
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url.includes('/leaderboard')) {
      return mockBoardStatus === 200
        ? { ok: true, status: 200, json: async () => leaderboard(mockTier) }
        : { ok: false, status: mockBoardStatus, json: async () => ({ detail: 'Leaderboard exploded' }) };
    }
    if (url.includes('/today')) {
      return { ok: true, status: 200, json: async () => [
        { lesson_id: 'l1', instructor_id: 'i1', instructor_name: 'Sam Okafor', student_id: 's1', student_name: 'Ben Carter', start_time: '2026-10-28T09:00:00', end_time: '2026-10-28T10:00:00', status: 'Completed', topic: 'Parking', pickup_address: null },
        { lesson_id: 'l2', instructor_id: 'i2', instructor_name: 'Hannah Doyle', student_id: 's2', student_name: 'Priya Nair', start_time: '2026-10-28T10:00:00', end_time: '2026-10-28T11:00:00', status: 'Scheduled', topic: null, pickup_address: null },
      ] };
    }
    return { ok: true, status: 200, json: async () => ({ rows: [] }) };
  });
});

import OwnerDashboard from '../../app/owner-dashboard-screen';

const boardOrder = () => screen.getAllByTestId(/^v2-board-/).map((n) => n.props.testID.replace('v2-board-', ''));

describe('School owner dashboard', () => {
  it('shows the school and keeps revenue hidden until Reveal is pressed', async () => {
    await render(<OwnerDashboard />);
    expect(await screen.findByText('Northside Driving School')).toBeTruthy();
    expect(screen.getByTestId('v2-revenue-value')).toHaveTextContent('£•••');
    await fireEvent.press(screen.getByTestId('v2-toggle-revenue'));
    expect(screen.getByTestId('v2-revenue-value')).toHaveTextContent('£18420');
    expect(screen.getByText('£17010')).toBeTruthy(); // last month, in the comparison bar
  });

  it('shows the four key figures, with money owed masked until revealed', async () => {
    await render(<OwnerDashboard />);
    await screen.findByTestId('v2-kpi-lessons');
    expect(within(screen.getByTestId('v2-kpi-lessons')).getByText('512', { exact: false })).toBeTruthy();
    expect(within(screen.getByTestId('v2-kpi-students')).getByText('118', { exact: false })).toBeTruthy();
    expect(within(screen.getByTestId('v2-kpi-pass')).getByText('71%', { exact: false })).toBeTruthy();
    expect(within(screen.getByTestId('v2-kpi-owed')).getByText('£•••', { exact: false })).toBeTruthy();
    expect(within(screen.getByTestId('v2-kpi-owed')).getByText('14 pupils', { exact: false })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('v2-toggle-revenue'));
    expect(within(screen.getByTestId('v2-kpi-owed')).getByText('£3180', { exact: false })).toBeTruthy();
  });

  it('ranks instructors and re-sorts from the segmented control', async () => {
    await render(<OwnerDashboard />);
    await screen.findByTestId('v2-board-i1');
    expect(boardOrder()).toEqual(['i1', 'i2']); // by revenue
    await fireEvent.press(screen.getByTestId('v2-sort-lessons_month'));
    expect(boardOrder()).toEqual(['i2', 'i1']); // Hannah has more lessons
    expect(within(screen.getByTestId('v2-board-i2')).getByText('140', { exact: false })).toBeTruthy();
  });

  it('has the owner bar: Add instructor opens the form and Reassign pupils goes to assignments', async () => {
    await render(<OwnerDashboard />);
    await screen.findByTestId('v2-owner-dock');
    await fireEvent.press(screen.getByTestId('v2-dock-reassign'));
    expect(mockPush).toHaveBeenCalledWith('/manage-assignments-screen');
    await fireEvent.press(screen.getByTestId('btn-add-instructor'));
    expect(await screen.findByTestId('add-instructor-form')).toBeTruthy();
  });

  it('on a solo plan shows no leaderboard sorting, no today section and no owner bar, but the upsell', async () => {
    mockTier = 'pro';
    await render(<OwnerDashboard />);
    await screen.findByTestId('v2-upsell');
    expect(screen.queryByTestId('v2-sort-leaderboard')).toBeNull();
    expect(screen.queryByText('Today across the school')).toBeNull();
    expect(screen.queryByTestId('v2-dock-reassign')).toBeNull();
  });

  it('counts today across the school and lists the lessons', async () => {
    await render(<OwnerDashboard />);
    await screen.findByTestId('v2-today-l1');
    expect(within(screen.getByTestId('v2-today-l2')).getByText('Priya Nair', { exact: false })).toBeTruthy();
    expect(screen.getByText('lessons today')).toBeTruthy();
    expect(screen.getByText('instructors working')).toBeTruthy();
  });

  it('shows the load error from the backend', async () => {
    mockBoardStatus = 500;
    await render(<OwnerDashboard />);
    expect(await screen.findByText('Leaderboard exploded')).toBeTruthy();
  });
});
