import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('expo-image-picker', () => ({}));
// Icons are plain components; the real package ships ES modules that Jest does not transform.
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../supabaseDb', () => ({
  getMySchoolProfile: jest.fn(),
  updateMySchoolProfile: jest.fn(),
  uploadSchoolLogo: jest.fn(),
  getMyRefundPolicy: jest.fn().mockResolvedValue('non_refundable'),
}));

import * as db from '../supabaseDb';
import SchoolProfileScreen from '../../app/school-profile-screen';
import { SLOW_LOAD_MESSAGE } from '../withTimeout';

const mocked = db as unknown as { getMySchoolProfile: jest.Mock };
const never = () => new Promise<never>(() => {});
const school = {
  id: 's1', business_name: "Grant's Driving School", logo_url: null, contact_email: null, contact_phone: null,
  address: null, default_hourly_rate: 36, google_review_url: null, tier: 'pro', pupil_agreement_text: null,
};

beforeEach(() => {
  jest.useFakeTimers();
  mocked.getMySchoolProfile.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('School Profile loading', () => {
  it('gives up on a stalled load and shows a message with Try again, instead of spinning forever', async () => {
    mocked.getMySchoolProfile.mockImplementation(never);
    await render(<SchoolProfileScreen />);
    expect(screen.queryByTestId('school-profile-load-error')).toBeNull();

    await act(async () => { jest.advanceTimersByTime(15001); });

    expect(screen.getByTestId('school-profile-load-error')).toBeTruthy();
    expect(screen.getByText(SLOW_LOAD_MESSAGE)).toBeTruthy();
    expect(screen.getByTestId('btn-retry-school-profile')).toBeTruthy();
  });

  it('shows a message when no school is found, on the page rather than in an Alert', async () => {
    mocked.getMySchoolProfile.mockResolvedValue(null);
    await render(<SchoolProfileScreen />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("We couldn't find a school profile for this account.")).toBeTruthy();
  });

  it('Try again loads the school profile', async () => {
    mocked.getMySchoolProfile.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(school);
    await render(<SchoolProfileScreen />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('school-profile-load-error')).toBeTruthy();

    await act(async () => { await fireEvent.press(screen.getByTestId('btn-retry-school-profile')); });
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByTestId('school-profile-load-error')).toBeNull();
    expect(screen.getByTestId('btn-save-school-profile')).toBeTruthy();
    expect(mocked.getMySchoolProfile).toHaveBeenCalledTimes(2);
  });
});
