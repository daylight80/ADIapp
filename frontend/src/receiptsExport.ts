import JSZip from 'jszip';
import { Platform, Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabaseClient';
import type { ExpenseReceipt } from './supabaseDb';
import { RECEIPT_CATEGORIES } from './supabaseDb';

/**
 * Build a portable archive of expense receipts (images + CSV summary) and
 * trigger a download (web) or share-sheet (native).
 *
 * Layout inside the ZIP:
 *   /receipts-YYYY-MM-DD.zip
 *      ├── receipts.csv                  (full table — easy to import into Sage / Excel)
 *      ├── README.txt                    (notes on file naming + counts)
 *      └── images/
 *          ├── 2026-05-12_TESCO_3.45.jpg
 *          ├── 2026-05-14_BP_42.00.jpg
 *          └── ... one file per receipt with a stored image
 *
 * Images are fetched from the Supabase `receipts` bucket using short-lived
 * signed URLs (10 min) so no public access is required.
 */
export type ZipProgress = {
  phase: 'preparing' | 'downloading' | 'zipping' | 'sharing' | 'done';
  current?: number;
  total?: number;
};

export async function exportReceiptsZip(
  items: ExpenseReceipt[],
  onProgress?: (p: ZipProgress) => void,
): Promise<{ ok: boolean; fileName: string; bytes?: number; warnings?: string[] }> {
  const warnings: string[] = [];
  if (!items || items.length === 0) {
    throw new Error('No receipts to export.');
  }

  onProgress?.({ phase: 'preparing' });
  const zip = new JSZip();
  const imagesFolder = zip.folder('images');
  if (!imagesFolder) throw new Error('Could not create images/ folder in archive.');

  // ---- 1) Generate signed URLs for every receipt that has a storage_path
  const withPath = items.filter((r) => !!r.storage_path);
  const paths = withPath.map((r) => r.storage_path as string);
  let signed: Record<string, string> = {};
  if (paths.length > 0) {
    try {
      // Supabase has a bulk createSignedUrls helper — much faster than one-at-a-time.
      const { data, error } = await supabase
        .storage
        .from('receipts')
        .createSignedUrls(paths, 600);
      if (error) throw error;
      for (const row of data || []) {
        if (row.path && row.signedUrl) signed[row.path] = row.signedUrl;
      }
    } catch (e: any) {
      warnings.push(`Could not generate some signed URLs: ${e?.message || e}`);
    }
  }

  // ---- 2) Build CSV table
  const header = ['date', 'category', 'vendor', 'amount_gbp', 'vat_gbp', 'notes', 'image_file'].join(',');
  const csvLines: string[] = [header];
  const csvEscape = (v: string | null | undefined) =>
    (v ?? '').toString().replace(/"/g, '""').replace(/\n|\r/g, ' ').trim();

  const filenameSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40);

  // ---- 3) Download each image and add to ZIP
  onProgress?.({ phase: 'downloading', current: 0, total: withPath.length });
  let downloaded = 0;
  const seenNames = new Set<string>();
  const fileNameForReceipt = (r: ExpenseReceipt): string => {
    const ext = (r.storage_path || '').toLowerCase().endsWith('.png')
      ? 'png'
      : (r.storage_path || '').toLowerCase().endsWith('.webp') ? 'webp' : 'jpg';
    const base = `${r.occurred_at}_${filenameSafe(r.vendor || 'receipt')}_${r.amount_total.toFixed(2)}`;
    let name = `${base}.${ext}`;
    let i = 2;
    while (seenNames.has(name)) {
      name = `${base}-${i}.${ext}`;
      i += 1;
    }
    seenNames.add(name);
    return name;
  };

  // For each receipt: download image if available, also append a CSV row.
  for (const r of items) {
    let imageFile = '';
    if (r.storage_path && signed[r.storage_path]) {
      try {
        const resp = await fetch(signed[r.storage_path]);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        imageFile = fileNameForReceipt(r);
        imagesFolder.file(imageFile, buf, { binary: true });
      } catch (e: any) {
        warnings.push(`Could not download image for ${r.vendor || r.id}: ${e?.message || e}`);
      }
      downloaded += 1;
      onProgress?.({ phase: 'downloading', current: downloaded, total: withPath.length });
    }

    csvLines.push([
      r.occurred_at,
      r.category,
      `"${csvEscape(r.vendor)}"`,
      r.amount_total.toFixed(2),
      r.vat_amount != null ? r.vat_amount.toFixed(2) : '',
      `"${csvEscape(r.notes)}"`,
      imageFile,
    ].join(','));
  }
  zip.file('receipts.csv', csvLines.join('\n'));

  // ---- 4) README for accountants / future-you
  const totalAmount = items.reduce((s, r) => s + (r.amount_total || 0), 0);
  const totalVat = items.reduce((s, r) => s + (r.vat_amount || 0), 0);
  const catCounts = items.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {});
  const catLines = Object.entries(catCounts).map(([k, n]) => {
    const meta = RECEIPT_CATEGORIES.find((c) => c.key === (k as any));
    return `  - ${meta?.emoji || ''} ${meta?.label || k}: ${n}`;
  });
  const readme = [
    'ADI Pro — Expense Receipts Archive',
    '===================================',
    '',
    `Exported on: ${new Date().toISOString()}`,
    `Receipts included: ${items.length}`,
    `Receipts with image attached: ${downloaded}`,
    `Total amount: £${totalAmount.toFixed(2)}`,
    `Total VAT:    £${totalVat.toFixed(2)}`,
    '',
    'Breakdown by category:',
    ...catLines,
    '',
    'Files in this archive:',
    '  • receipts.csv  — full table (date, category, vendor, amount, VAT, notes, image_file)',
    '  • images/       — one image per receipt that had a scan attached',
    '',
    'Image filenames follow: YYYY-MM-DD_VENDOR_AMOUNT.<ext>',
    '',
    'Cross-reference: open receipts.csv in Excel / Numbers, then click any',
    'image_file value to open the matching photo in the images/ folder.',
    '',
    'Compatible with HMRC self-assessment record-keeping requirements.',
    'Keep a copy on cloud storage for the full statutory retention period.',
  ].join('\n');
  zip.file('README.txt', readme);

  // ---- 5) Generate the binary
  onProgress?.({ phase: 'zipping' });
  const fileName = `adi-pro-receipts-${new Date().toISOString().slice(0, 10)}.zip`;

  if (Platform.OS === 'web') {
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    if (typeof window === 'undefined') throw new Error('Web export needs a browser context.');
    onProgress?.({ phase: 'sharing' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onProgress?.({ phase: 'done' });
    return { ok: true, fileName, bytes: blob.size, warnings: warnings.length ? warnings : undefined };
  }

  // Native: write to cache + share
  const base64 = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const path = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  onProgress?.({ phase: 'sharing' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'application/zip', dialogTitle: 'Export receipts archive' });
  } else {
    Alert.alert('Archive saved', `ZIP saved to ${path}`);
  }
  onProgress?.({ phase: 'done' });
  return { ok: true, fileName, warnings: warnings.length ? warnings : undefined };
}
