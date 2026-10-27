import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import { shouldShowIntro, INTRO_INTERVAL_MS, INTRO_STORAGE_KEY, markIntroShown, readIntroLastShown } from '../introSchedule';
import { IntroVideoGate } from '../IntroVideo';
const { mockPlayer } = require('../../__mocks__/expo-video');

const NOW = 1_800_000_000_000;

describe('shouldShowIntro', () => {
  it('shows on the first open and once 24 hours have passed, not before', () => {
    expect(shouldShowIntro(null, NOW)).toBe(true);
    expect(shouldShowIntro(NOW - INTRO_INTERVAL_MS, NOW)).toBe(true);
    expect(shouldShowIntro(NOW - INTRO_INTERVAL_MS + 1, NOW)).toBe(false);
    expect(shouldShowIntro(NOW - 60_000, NOW)).toBe(false);
  });

  it('treats a time in the future (clock set back) or junk as due, never as stuck off', () => {
    expect(shouldShowIntro(NOW + 5 * INTRO_INTERVAL_MS, NOW)).toBe(true);
    expect(shouldShowIntro(NaN, NOW)).toBe(true);
  });
});

describe('storage', () => {
  beforeEach(() => AsyncStorage.clear());

  it('remembers when it was last shown, and reads junk as never', async () => {
    expect(await readIntroLastShown()).toBeNull();
    await markIntroShown(NOW);
    expect(await readIntroLastShown()).toBe(NOW);
    await AsyncStorage.setItem(INTRO_STORAGE_KEY, 'garbage');
    expect(await readIntroLastShown()).toBeNull();
  });
});

describe('IntroVideoGate', () => {
  beforeEach(async () => { await AsyncStorage.clear(); mockPlayer.reset(); });

  it('plays the clip on the first open, once, with sound, and records that it was shown', async () => {
    await render(<IntroVideoGate />);
    expect(await screen.findByTestId('intro-video')).toBeTruthy();
    expect(mockPlayer.play).toHaveBeenCalled();
    expect(mockPlayer.loop).toBe(false);
    expect(await readIntroLastShown()).not.toBeNull();
  });

  it('goes away when the clip ends', async () => {
    await render(<IntroVideoGate />);
    await screen.findByTestId('intro-video');
    await act(async () => { mockPlayer.emit('playToEnd'); });
    expect(screen.queryByTestId('intro-video')).toBeNull();
  });

  it('goes away when the player reports an error, so the app is never stuck behind it', async () => {
    await render(<IntroVideoGate />);
    await screen.findByTestId('intro-video');
    await act(async () => { mockPlayer.emit('statusChange', { status: 'error' }); });
    expect(screen.queryByTestId('intro-video')).toBeNull();
  });

  it('Skip leaves early', async () => {
    await render(<IntroVideoGate />);
    await fireEvent.press(await screen.findByTestId('btn-skip-intro'));
    expect(screen.queryByTestId('intro-video')).toBeNull();
  });

  it('does not play again within 24 hours, and shows nothing at all', async () => {
    await markIntroShown(Date.now() - 60 * 60 * 1000);
    await render(<IntroVideoGate />);
    await waitFor(() => expect(screen.queryByTestId('intro-checking')).toBeNull());
    expect(screen.queryByTestId('intro-video')).toBeNull();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });
});
