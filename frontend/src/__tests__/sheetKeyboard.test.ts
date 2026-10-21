import { sheetBodyMaxHeight } from '../useKeyboardHeight';

describe('sheetBodyMaxHeight', () => {
  it('keeps the usual 560 cap when there is no keyboard on a tall screen', () => {
    expect(sheetBodyMaxHeight(900, 0)).toBe(560);
  });
  it('shortens the sheet body to fit above the keyboard', () => {
    // 900px screen, 450px keyboard: 900 - 450 - 140 = 310
    expect(sheetBodyMaxHeight(900, 450)).toBe(310);
  });
  it('never gets too small to use', () => {
    expect(sheetBodyMaxHeight(500, 400)).toBe(160);
  });
});

import { renderHook, act } from '@testing-library/react-native';
import { Keyboard, Platform } from 'react-native';
import { useSheetKeyboard } from '../useKeyboardHeight';

describe('useSheetKeyboard (hand-built sheets such as Complete lesson)', () => {
  const handlers: Record<string, (e?: any) => void> = {};
  const originalOS = Platform.OS;
  beforeEach(() => {
    (Platform as any).OS = 'android';
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, fn: any) => {
      handlers[name] = fn;
      return { remove: jest.fn() };
    }) as any);
  });
  afterEach(() => { (Platform as any).OS = originalOS; jest.restoreAllMocks(); });

  it('does nothing while the keyboard is hidden', async () => {
    const { result } = await renderHook(() => useSheetKeyboard(480));
    expect(result.current.lift).toBeUndefined();
    expect(result.current.bodyMax).toBeLessThanOrEqual(480);
  });

  it('lifts the sheet above the keyboard and shortens its body, then puts it back', async () => {
    const { result } = await renderHook(() => useSheetKeyboard(480));
    await act(async () => { handlers.keyboardDidShow({ endCoordinates: { height: 900 } }); });
    expect(result.current.lift).toEqual({ marginBottom: 900 });
    expect(result.current.bodyMax).toBeLessThan(480);
    await act(async () => { handlers.keyboardDidHide(); });
    expect(result.current.lift).toBeUndefined();
  });
});
