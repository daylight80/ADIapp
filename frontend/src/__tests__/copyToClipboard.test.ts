const mockSet = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a: any[]) => mockSet(...a) }));

import { copyToClipboard } from '../tools';

describe('copyToClipboard', () => {
  beforeEach(() => mockSet.mockReset());

  it('puts the text on the clipboard through expo-clipboard (the phone app has no web clipboard)', () => {
    mockSet.mockResolvedValue(true);
    expect(copyToClipboard('https://x.test/?invite=1')).toBe(true);
    expect(mockSet).toHaveBeenCalledWith('https://x.test/?invite=1');
  });

  it('does not crash when the clipboard refuses', async () => {
    mockSet.mockRejectedValue(new Error('denied'));
    expect(copyToClipboard('x')).toBe(true);
    await Promise.resolve();
  });

  it('says it failed when the clipboard cannot even be called', () => {
    mockSet.mockImplementation(() => { throw new Error('no native module'); });
    expect(copyToClipboard('x')).toBe(false);
  });
});
