import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'stu1', key: 'controls' }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../mockDb', () => ({ mockDb: { getCompetency: jest.fn(), listLessonsForStudent: jest.fn(() => []) } }));
jest.mock('../useSupabaseData', () => ({
  useCompetencies: () => ({
    competencies: [{ key: 'controls', name: 'Controls', level: 1, progress: 0, lastAssessed: '2026-10-13', skills: [], notes: '' }],
    loading: false,
  }),
  updateCompetency: jest.fn(),
}));
const mockUseAuth = jest.fn();
jest.mock('../AuthContext', () => ({ useAuth: () => mockUseAuth() }));

import { canEditCompetency } from '../competencyAccess';
import CompetencyDetailScreen from '../../app/competency-detail-screen';

describe('canEditCompetency', () => {
  it('is for instructors, on a live competency only', () => {
    expect(canEditCompetency('instructor', true)).toBe(true);
    expect(canEditCompetency('instructor', false)).toBe(false);
    expect(canEditCompetency('student', true)).toBe(false);
    expect(canEditCompetency(undefined, true)).toBe(false);
    expect(canEditCompetency(null, true)).toBe(false);
  });
});

describe('competency screen', () => {
  it('shows the edit pencil to an instructor', async () => {
    mockUseAuth.mockReturnValue({ user: { role: 'instructor', tier: 'pro' } });
    await render(<CompetencyDetailScreen />);
    expect(screen.getByTestId('btn-edit-competency')).toBeTruthy();
  });

  it('does not show it to a pupil, who cannot save a change', async () => {
    mockUseAuth.mockReturnValue({ user: { role: 'student', tier: 'pro' } });
    await render(<CompetencyDetailScreen />);
    expect(screen.queryByTestId('btn-edit-competency')).toBeNull();
    expect(screen.getByText('Controls')).toBeTruthy();
  });
});
