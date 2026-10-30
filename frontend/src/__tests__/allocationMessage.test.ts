import { allocationMessage } from '../allocationMessage';
import { whatsAppUrl } from '../tools';

describe('allocationMessage', () => {
  it('names one pupil and signs with the owner first name', () => {
    expect(allocationMessage('Anil Mruthinjayan', ['Dayana Arachchige'], 'Jon Duncombe')).toBe(
      "Hi Anil, I've allocated Dayana Arachchige to you. Please contact them to arrange the first lesson. Their details are on their profile in the DualControl app. Thanks, Jon",
    );
  });

  it('counts and names several pupils', () => {
    expect(allocationMessage('Anil', ['A One', 'B Two'], null)).toContain("I've allocated 2 pupils (A One, B Two) to you.");
  });

  it('does not end with a dangling thanks when the owner has no name', () => {
    expect(allocationMessage('Anil', ['A One'], '  ')).not.toContain('Thanks');
  });
});

describe('whatsAppUrl', () => {
  it.each([
    ['07496 496582', '447496496582'],
    ['+44 7496 496582', '447496496582'],
    ['0044 7496 496582', '447496496582'],
    ['447496496582', '447496496582'],
  ])('turns %s into %s', (input, digits) => {
    expect(whatsAppUrl(input, 'hi')).toBe(`https://wa.me/${digits}?text=hi`);
  });

  it('encodes the message', () => {
    expect(whatsAppUrl('07496496582', "I've a & b")).toBe("https://wa.me/447496496582?text=I've%20a%20%26%20b");
  });
});
