// =============================================================================
// CSV export helper — Income / Expense report
// =============================================================================
// Generates a single combined CSV containing two sections (Income, Expenses)
// followed by a totals summary. Designed for direct import into Excel /
// Google Sheets / accountancy software (QuickBooks, Xero) so a UK ADI can
// hand it to their accountant at year-end without further massaging.
// =============================================================================

import { Platform } from 'react-native';

export type CsvRow = (string | number | null | undefined)[];

/** RFC-4180 cell escape — wrap in quotes if needed, double internal quotes. */
function escapeCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  const needsQuote = /[",\n\r]/.test(s);
  if (needsQuote) {
    s = s.replace(/"/g, '""');
    return `"${s}"`;
  }
  return s;
}

export function rowsToCsv(rows: CsvRow[]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

/** Format a number as a fixed-2 decimal string suitable for CSV (no £ sign). */
export function csvAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '0.00';
  return Number(n).toFixed(2);
}

/** Slug-safe ISO date for filenames. */
export function isoYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Trigger a download/share of `csv` content as `filename`.
 * - Web: spawns a hidden anchor with a Blob URL.
 * - Native: writes to the cache dir + opens the OS Share Sheet via expo-sharing.
 */
export async function downloadOrShareCsv(filename: string, csv: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      // eslint-disable-next-line no-undef
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      // eslint-disable-next-line no-undef
      const url = URL.createObjectURL(blob);
      // eslint-disable-next-line no-undef
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      // eslint-disable-next-line no-undef
      document.body.appendChild(a);
      a.click();
      // eslint-disable-next-line no-undef
      document.body.removeChild(a);
      setTimeout(() => {
        try { (globalThis as any).URL?.revokeObjectURL?.(url); } catch { /* ignore */ }
      }, 1000);
      return;
    } catch (e: any) {
      throw new Error(`Could not download CSV: ${e?.message || 'unknown error'}`);
    }
  }

  // Native (iOS/Android) — write file then share.
  try {
    const FS = await import('expo-file-system');
    const Sharing = await import('expo-sharing');
    const cache = (FS as any).cacheDirectory || (FS as any).documentDirectory || '';
    if (!cache) throw new Error('No writable cache directory');
    const path = `${cache}${filename}`;
    await (FS as any).writeAsStringAsync(path, csv, {
      encoding: (FS as any).EncodingType?.UTF8 || 'utf8',
    });
    if (await (Sharing as any).isAvailableAsync()) {
      await (Sharing as any).shareAsync(path, {
        mimeType: 'text/csv',
        dialogTitle: 'Income & Expense report',
        UTI: 'public.comma-separated-values-text',
      });
    }
  } catch (e: any) {
    throw new Error(`Could not share CSV: ${e?.message || 'unknown error'}`);
  }
}
