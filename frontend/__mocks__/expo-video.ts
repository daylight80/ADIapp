import React from 'react';
import { View } from 'react-native';

type Fn = (...a: any[]) => void;

/** A stand-in video player for tests: records its listeners and lets a test fire an event. */
export const mockPlayer = {
  loop: true,
  play: jest.fn(),
  listeners: {} as Record<string, Fn[]>,
  addListener(event: string, fn: Fn) {
    (this.listeners[event] = this.listeners[event] || []).push(fn);
    return { remove: () => { this.listeners[event] = (this.listeners[event] || []).filter((f) => f !== fn); } };
  },
  emit(event: string, ...args: any[]) { (this.listeners[event] || []).forEach((f) => f(...args)); },
  reset() { this.loop = true; this.play.mockClear(); this.listeners = {}; },
};

export const useVideoPlayer = (_source: unknown, setup?: (p: typeof mockPlayer) => void) => {
  if (setup) setup(mockPlayer);
  return mockPlayer;
};

export const VideoView = (props: any) => React.createElement(View, { testID: 'video-view', ...props });
