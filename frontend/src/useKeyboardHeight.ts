import { useEffect, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';

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

/**
 * For a hand-built bottom-sheet Modal: how far to lift the sheet above the keyboard, and the tallest its scrolling
 * body may be then (never over `baseMax`). Without this the keyboard sits on top of the fields being filled in.
 */
export function useSheetKeyboard(baseMax: number): { lift: { marginBottom: number } | undefined; bodyMax: number } {
  const keyboardHeight = useKeyboardHeight();
  const { height } = useWindowDimensions();
  return {
    lift: keyboardHeight > 0 ? { marginBottom: keyboardHeight } : undefined,
    bodyMax: Math.min(baseMax, sheetBodyMaxHeight(height, keyboardHeight)),
  };
}
