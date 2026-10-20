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
