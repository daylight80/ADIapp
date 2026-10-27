import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';

/** SVG path of the dark squares of a QR code for `text` (one unit per square), and its side length. */
export function qrPath(text: string): { d: string; size: number } {
  const qr = qrcode(0, 'M'); // type 0 = pick the smallest version that fits
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  return { d, size };
}

/** Black on white with a 2-square quiet border, whatever the theme, so phone cameras can always read it. */
export function QrCode({ value, size = 200, testID }: { value: string; size?: number; testID?: string }) {
  const { d, size: n } = useMemo(() => qrPath(value), [value]);
  const quiet = 2;
  return (
    <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${n + 2 * quiet} ${n + 2 * quiet}`} testID={testID}>
      <Rect x={-quiet} y={-quiet} width={n + 2 * quiet} height={n + 2 * quiet} fill="#fff" />
      <Path d={d} fill="#000" />
    </Svg>
  );
}
