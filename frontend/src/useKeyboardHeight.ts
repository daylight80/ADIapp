import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Height of the on-screen keyboard (0 when hidden). Android only: with edge-to-edge on, a Modal is not
 * resized for the keyboard, so a bottom sheet has to lift itself. iOS is handled by KeyboardAvoidingView.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

/** Tallest the sheet's scrolling body may be: never over 560, and always leaves room for the title and the space above the keyboard. */
export function sheetBodyMaxHeight(windowHeight: number, keyboardHeight: number): number {
  const room = windowHeight - keyboardHeight - 140; // title bar, handle, padding and a little gap at the top
  return Math.max(160, Math.min(560, room));
}
