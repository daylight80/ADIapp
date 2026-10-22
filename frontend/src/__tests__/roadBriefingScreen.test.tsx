import React from 'react';
import { render, screen, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockTravel = jest.fn();
jest.mock('../maps', () => ({ ...jest.requireActual('../maps'), getTravelTime: (...a: unknown[]) => mockTravel(...a) }));
const mockCall = jest.fn();
jest.mock('../backendCall', () => ({ callBackend: (...a: unknown[]) => mockCall(...a) }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
const mockUser: { tier: string | null } = { tier: 'pro' };
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { tier: mockUser.tier } }) }));

import { useRoadBriefing, resetRoadBriefingCache } from '../useRoadBriefing';
import { RoadBriefingCard } from '../RoadBriefingCard';

// Only the clock is faked, so waiting for promises still works. "Now" is Thu 22 Oct 2026, 09:00.
beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  jest.setSystemTime(new Date(2026, 9, 22, 9, 0));
});
afterAll(() => { jest.useRealTimers(); });

const student = (id: string, name: string, address: string, postcode: string) => ({ id, name, address, postcode }) as any;
const students = [student('s1', 'Sam Smith', '1 High St, Mitcham', 'CR4 3AB'), student('s2', 'Pat Jones', '9 Park Rd, Morden', 'SM4 5XY')];
const lesson = (id: string, sid: string, start: string, end: string) => ({
  id, student_id: sid, date: '2026-10-22', start_time: start, end_time: end, status: 'Scheduled', lesson_type: 'Standard',
}) as any;
const lessons = [lesson('l1', 's1', '09:30', '10:30'), lesson('l2', 's2', '11:00', '12:00')];

beforeEach(() => {
  resetRoadBriefingCache();
  mockTravel.mockReset().mockResolvedValue({ status: 'ok', duration_minutes: 20, duration_in_traffic_minutes: 40, distance_km: 9, cached: false });
  mockCall.mockReset().mockResolvedValue({ status: 'ok', results: [] });
  mockUser.tier = 'pro';
});

describe('useRoadBriefing', () => {
  it('checks the drive between back-to-back lessons with live traffic and warns when you will be late', async () => {
    const { result } = await renderHook(() => useRoadBriefing(lessons, students, true));
    await waitFor(() => expect(result.current.briefing?.checked).toBe(true));
    expect(mockTravel).toHaveBeenCalledTimes(1);
    const [from, to] = mockTravel.mock.calls[0];
    expect(from).toMatch(/CR4 3AB/); expect(to).toMatch(/SM4 5XY/);
    expect(result.current.briefing?.items[0]).toMatchObject({ key: 'traffic-l2', severity: 'warn' });
    expect(result.current.briefing?.headline).toMatch(/1 changeover you may be late for/);
  });

  it('asks about the weather once per postcode area, sending only the area and the lesson times', async () => {
    await renderHook(() => useRoadBriefing(lessons, students, true));
    await waitFor(() => expect(mockCall).toHaveBeenCalledTimes(2));
    const bodies = mockCall.mock.calls.map((c) => c[2]);
    expect(bodies.map((b: any) => b.outcode).sort()).toEqual(['CR4', 'SM4']);
    for (const b of bodies) {
      expect(Object.keys(b).sort()).toEqual(['outcode', 'windows']);
      expect(JSON.stringify(b)).not.toMatch(/Sam|Pat|High St|Park Rd/);
    }
  });

  it('shows weather warnings from the backend', async () => {
    mockTravel.mockResolvedValue({ status: 'ok', duration_minutes: 10, duration_in_traffic_minutes: 10, distance_km: 3, cached: false });
    mockCall.mockImplementation(async (_p: string, _m: string, body: any) => ({
      status: 'ok',
      results: body.windows.map((w: any) => ({ id: w.id, flags: body.outcode === 'SM4' ? [{ kind: 'ice', text: 'Ice possible, take care on untreated roads' }] : [], summary: '1°C', covered: true })),
    }));
    const { result } = await renderHook(() => useRoadBriefing(lessons, students, true));
    await waitFor(() => expect(result.current.briefing?.checked).toBe(true));
    expect(result.current.briefing?.items.map((i) => i.key)).toEqual(['weather-l2']);
  });

  it('ignores a stand-in travel estimate and a weather failure, and shows no briefing rather than a false all-clear', async () => {
    mockTravel.mockResolvedValue({ status: 'fallback', duration_minutes: 8, duration_in_traffic_minutes: 60, distance_km: 3, cached: false });
    mockCall.mockRejectedValue(new Error('boom'));
    const { result } = await renderHook(() => useRoadBriefing(lessons, students, true));
    await waitFor(() => expect(mockCall).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.briefing?.checked).toBe(false);
    expect(result.current.briefing?.items).toEqual([]);
  });

  it('does nothing on a free plan, and nothing when there are no lessons left today', async () => {
    const free = await renderHook(() => useRoadBriefing(lessons, students, false));
    expect(free.result.current.briefing).toBeNull();
    const none = await renderHook(() => useRoadBriefing([], students, true));
    expect(none.result.current.briefing).toBeNull();
    expect(mockTravel).not.toHaveBeenCalled();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('shares one result between the Home card and the Action Centre instead of asking twice', async () => {
    await renderHook(() => useRoadBriefing(lessons, students, true));
    await waitFor(() => expect(mockTravel).toHaveBeenCalledTimes(1));
    await renderHook(() => useRoadBriefing(lessons, students, true));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockTravel).toHaveBeenCalledTimes(1);
  });
});

describe('the Home card', () => {
  it('shows the headline and the warning for a lesson you may be late for, with a caution to check again', async () => {
    await render(<RoadBriefingCard lessons={lessons} students={students} />);
    await waitFor(() => expect(screen.getByTestId('road-briefing-headline')).toHaveTextContent(/may be late/));
    expect(screen.getByTestId('road-item-traffic-l2')).toHaveTextContent(/Pat, 11:00: you may be late/);
    expect(screen.getByText(/Check again before you set off/)).toBeTruthy();
  });

  it('says all clear when everything checked is fine', async () => {
    mockTravel.mockResolvedValue({ status: 'ok', duration_minutes: 10, duration_in_traffic_minutes: 12, distance_km: 3, cached: false });
    await render(<RoadBriefingCard lessons={lessons} students={students} />);
    await waitFor(() => expect(screen.getByTestId('road-briefing-headline')).toHaveTextContent('Roads and weather look clear for today'));
  });

  it('is absent on a free plan and makes no calls', async () => {
    mockUser.tier = 'starter';
    await render(<RoadBriefingCard lessons={lessons} students={students} />);
    expect(screen.queryByTestId('home-road-briefing')).toBeNull();
    expect(mockTravel).not.toHaveBeenCalled();
  });
});
