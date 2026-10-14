import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'p@x.co', role: 'student' } }) }));
jest.mock('../useSupabaseData', () => ({
  useStudentByAuthId: () => ({ student: { id: 'stu1', name: 'Test Pupil' } }),
  useStudentByEmail: () => ({ student: undefined }),
}));
jest.mock('../supabaseDb', () => ({ awardMyTheoryBadge: jest.fn() }));

import * as db from '../supabaseDb';
import { THEORY_BANK } from '../mockDb';
import TheoryTestScreen from '../../app/theory-test-screen';

const award = db.awardMyTheoryBadge as jest.Mock;

/** Answers every question: all right, or all wrong. */
async function answerAll(allRight: boolean) {
  for (const q of THEORY_BANK) {
    const idx = allRight ? q.answer_index : (q.answer_index + 1) % q.options.length;
    await fireEvent.press(screen.getByTestId(`q-${q.id}-opt-${idx}`));
  }
  await fireEvent.press(screen.getByTestId('btn-submit-theory'));
}

beforeEach(() => award.mockReset());
jest.spyOn(console, 'warn').mockImplementation(() => {});

describe('theory practice test badge', () => {
  it('awards the badge through the function and only then says it is unlocked', async () => {
    award.mockResolvedValue(undefined);
    await render(<TheoryTestScreen />);
    await answerAll(true);
    expect(award).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('theory-badge-saved')).toHaveTextContent(/Badge unlocked: Theory Champion/);
    expect(screen.queryByTestId('theory-badge-failed')).toBeNull();
  });

  it('does not claim the badge when it could not be saved, and says so', async () => {
    award.mockRejectedValue(new Error('network down'));
    await render(<TheoryTestScreen />);
    await answerAll(true);
    expect(await screen.findByTestId('theory-badge-failed')).toHaveTextContent(/could not save your badge/);
    expect(screen.queryByTestId('theory-badge-saved')).toBeNull();
  });

  it('awards nothing for a failed test', async () => {
    await render(<TheoryTestScreen />);
    await answerAll(false);
    expect(award).not.toHaveBeenCalled();
    expect(screen.queryByTestId('theory-badge-saved')).toBeNull();
    expect(screen.queryByTestId('theory-badge-failed')).toBeNull();
  });
});
