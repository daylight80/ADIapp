import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }), useFocusEffect: () => {} }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

const mockHook = { items: [] as any[], loading: false };
jest.mock('../useActionCentre', () => ({ useActionCentre: () => mockHook }));

import ActionCentreScreen from '../../app/action-centre-screen';
import { ActionCentreCard } from '../ActionCentreCard';
import { routeForTarget } from '../actionCentreNav';

const item = (key: string, group: string, title: string, target: any, urgent = false) => ({ key, group, title, detail: 'detail', urgent, target });

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  mockHook.items = [];
  mockHook.loading = false;
});

describe('routeForTarget', () => {
  it('opens the pupil, the diary or deadlines', () => {
    expect(routeForTarget({ screen: 'student', studentId: 's1' })).toEqual({ pathname: '/student-lifecycle-screen', params: { id: 's1' } });
    expect(routeForTarget({ screen: 'diary', date: '2026-10-22' })).toEqual({ pathname: '/lesson-diary-screen' });
    expect(routeForTarget({ screen: 'deadlines' })).toEqual({ pathname: '/deadlines-screen' });
  });
});

describe('Action Centre screen', () => {
  it('says so when nothing needs doing', async () => {
    await render(<ActionCentreScreen />);
    expect(screen.getByTestId('action-centre-screen-summary')).toHaveTextContent("You're all caught up");
    expect(screen.getByTestId('action-centre-clear')).toBeTruthy();
  });

  it('lists items under their group headings and opens the right screen on a tap', async () => {
    mockHook.items = [
      item('test-a', 'tests', 'Sam: practical test in 2 days', { screen: 'student', studentId: 'a' }, true),
      item('deadline-mot', 'deadlines', 'MOT', { screen: 'deadlines' }),
    ];
    await render(<ActionCentreScreen />);
    expect(screen.getByTestId('action-centre-screen-summary')).toHaveTextContent('2 things need you');
    expect(screen.getByTestId('group-tests')).toHaveTextContent(/Upcoming tests \(1\)/);
    expect(screen.getByTestId('group-deadlines')).toHaveTextContent(/Your deadlines \(1\)/);
    expect(screen.queryByTestId('action-centre-clear')).toBeNull();

    await fireEvent.press(screen.getByTestId('action-test-a'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/student-lifecycle-screen', params: { id: 'a' } });
    await fireEvent.press(screen.getByTestId('action-deadline-mot'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/deadlines-screen' });
  });
});

describe('Home card', () => {
  it('shows all caught up when empty and still opens the Action Centre', async () => {
    await render(<ActionCentreCard />);
    expect(screen.getByTestId('action-centre-summary')).toHaveTextContent("You're all caught up");
    await fireEvent.press(screen.getByTestId('action-centre-open'));
    expect(mockPush).toHaveBeenCalledWith('/action-centre-screen');
  });

  it('shows the count and the top three, with how many more', async () => {
    mockHook.items = ['a', 'b', 'c', 'd', 'e'].map((k) => item(`k-${k}`, 'inactive', `Pupil ${k}`, { screen: 'student', studentId: k }));
    await render(<ActionCentreCard />);
    expect(screen.getByTestId('action-centre-summary')).toHaveTextContent('5 things need you');
    expect(screen.getByTestId('action-top-k-a')).toBeTruthy();
    expect(screen.getByTestId('action-top-k-c')).toBeTruthy();
    expect(screen.queryByTestId('action-top-k-d')).toBeNull();
    expect(screen.getByText('+ 2 more')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('action-top-k-b'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/student-lifecycle-screen', params: { id: 'b' } });
  });
});
