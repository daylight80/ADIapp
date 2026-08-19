import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Student, Lesson } from './mockDb';

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInvoiceHtml(opts: {
  invoiceNo: string;
  instructorName: string;
  instructorEmail: string;
  student: Student;
  lessons: Lesson[];
  issuedAt: Date;
  // Real school branding — all optional so this stays backwards compatible
  // for any call site that hasn't been updated. Falls back to the old
  // hardcoded "ADI Pro" branding when not provided.
  schoolName?: string | null;
  schoolLogoUrl?: string | null;
  schoolContactEmail?: string | null;
  schoolContactPhone?: string | null;
  schoolAddress?: string | null;
}): string {
  const {
    invoiceNo, instructorName, instructorEmail, student, lessons, issuedAt,
    schoolName, schoolLogoUrl, schoolContactEmail, schoolContactPhone, schoolAddress,
  } = opts;
  const subtotal = lessons.reduce((s, l) => s + (l.amount_paid || 0), 0);
  const vat = +(subtotal * 0.2).toFixed(2);
  const total = +(subtotal + vat).toFixed(2);
  const dateStr = issuedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const rows = lessons
    .map(
      (l) => `
    <tr>
      <td>${new Date(l.date).toLocaleDateString('en-GB')}</td>
      <td>${escape(l.topic)}</td>
      <td>${l.duration_hours.toFixed(1)}h</td>
      <td style="text-align:right">£${(l.amount_paid || 0).toFixed(2)}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Invoice ${escape(invoiceNo)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; color: #0F172A; padding: 32px; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #00539F; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 26px; font-weight: 800; color: #00539F; }
  .accent { color: #FF6B00; }
  h2 { font-size: 16px; margin: 0 0 8px; }
  .muted { color: #64748B; font-size: 13px; }
  .meta { display: flex; justify-content: space-between; margin: 20px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 10px 8px; border-bottom: 1px solid #E2E8F0; font-size: 14px; text-align: left; }
  th { background: #F8FAFC; font-weight: 600; }
  .totals { margin-top: 16px; width: 280px; margin-left: auto; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; }
  .totals .grand { font-size: 18px; font-weight: 800; color: #00539F; border-top: 2px solid #00539F; margin-top: 8px; padding-top: 8px; }
  .footer { margin-top: 36px; font-size: 12px; color: #64748B; }
</style></head><body>
<div class="header">
  <div>
    ${schoolLogoUrl
      ? `<img src="${escape(schoolLogoUrl)}" style="height:44px; max-width:180px; object-fit:contain; margin-bottom:6px;" />`
      : ''}
    <div class="brand">${schoolName ? escape(schoolName) : `ADI<span class="accent">Pro</span>`}</div>
    <div class="muted">Driving Instructor Invoice</div>
    ${schoolAddress ? `<div class="muted">${escape(schoolAddress)}</div>` : ''}
    ${schoolContactEmail || schoolContactPhone
      ? `<div class="muted">${[schoolContactEmail, schoolContactPhone].filter(Boolean).map(escape).join(' · ')}</div>`
      : ''}
  </div>
  <div style="text-align:right">
    <h2>Invoice ${escape(invoiceNo)}</h2>
    <div class="muted">Issued ${dateStr}</div>
  </div>
</div>

<div class="meta">
  <div>
    <h2>From</h2>
    <div>${escape(instructorName)}</div>
    <div class="muted">${escape(instructorEmail)}</div>
  </div>
  <div style="text-align:right">
    <h2>Billed to</h2>
    <div>${escape(student.name)}</div>
    <div class="muted">${escape(student.address || '')}, ${escape(student.postcode || '')}</div>
    <div class="muted">${escape(student.email)}</div>
  </div>
</div>

<table>
  <thead>
    <tr><th>Date</th><th>Description</th><th>Duration</th><th style="text-align:right">Amount</th></tr>
  </thead>
  <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#64748B">No lessons in this invoice.</td></tr>'}</tbody>
</table>

<div class="totals">
  <div class="row"><span class="muted">Subtotal</span><span>£${subtotal.toFixed(2)}</span></div>
  <div class="row"><span class="muted">VAT (20%)</span><span>£${vat.toFixed(2)}</span></div>
  <div class="row grand"><span>Total</span><span>£${total.toFixed(2)}</span></div>
</div>

<div class="footer">Thank you for your business. Payment terms: 14 days. ${schoolName ? escape(schoolName) : 'ADI Pro · adipro.app'}</div>
</body></html>`;
}

export async function generateAndShareInvoicePdf(html: string, filename: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (Platform.OS === 'web') {
      // Open print preview in new tab on web
      const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
      if (win) {
        win.document.write(html);
        win.document.close();
        setTimeout(() => win.print(), 500);
        return { ok: true };
      }
      return { ok: false, error: 'Browser blocked the invoice window' };
    }
    const { uri } = await Print.printToFileAsync({ html });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: filename, UTI: 'com.adobe.pdf' });
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to generate invoice' };
  }
}
