import React from 'react';
import { render } from '@testing-library/react-native';
import { QrCode, qrPath } from '../QrCode';

// A real invite link is about 300 characters (the payload is base64 JSON).
const LINK = 'https://webapp.drivingschoolsolutions.co.uk/?invite=' + 'eyJlbWFpbCI6ImFAYi5jb20iLCJuYW1lIjoiQWxleCJ9'.repeat(6);

describe('qrPath', () => {
  it('makes a square code with the three corner markers', () => {
    const { d, size } = qrPath(LINK);
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0); // valid QR sizes are 21, 25, 29, ...
    const dark = new Set([...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${m[1]},${m[2]}`));
    // The outer ring of each 7x7 finder marker is solid: top-left, top-right, bottom-left.
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let i = 0; i < 7; i++) {
        for (const [x, y] of [[ox + i, oy], [ox + i, oy + 6], [ox, oy + i], [ox + 6, oy + i]]) expect(dark.has(`${x},${y}`)).toBe(true);
      }
    }
  });

  it('gives different codes for different links', () => {
    expect(qrPath(LINK).d).not.toBe(qrPath(LINK + 'x').d);
  });
});

describe('QrCode', () => {
  it('renders', async () => {
    const { getByTestId } = await render(<QrCode value={LINK} testID="qr" />);
    expect(getByTestId('qr')).toBeTruthy();
  });
});
