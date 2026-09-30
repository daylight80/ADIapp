// Gift vouchers ("Drive Vouchers", Migration 049). Pure logic and the PDF's
// HTML — no I/O, so it is unit-tested (see __tests__/voucher.test.ts).
//
// A voucher is for a number of prepaid driving hours. It carries a code the
// database generates, an expiry date, and the instructor's or school's logo and
// name. Redeeming is manual: the instructor adds the hours to the student's
// wallet and marks the voucher redeemed.
import { escapeHtml } from './htmlEscape';

export const MAX_VOUCHER_HOURS = 100;
export const HOUR_CHOICES = [1, 2, 5, 10];

export const EXPIRY_CHOICES = [
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
  { months: 24, label: '2 years' },
];
export const DEFAULT_EXPIRY_MONTHS = 12;

export type VoucherStatus = 'active' | 'redeemed' | 'cancelled' | 'expired';

/**
 * Turns what was typed into hours, or null if it isn't valid: a positive
 * number in half-hour steps, up to MAX_VOUCHER_HOURS. Matches the database's
 * check (0 < hours <= 100), plus half-hour steps so a voucher reads sensibly.
 */
export function parseVoucherHours(input: string): number | null {
  const t = (input || '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!(n > 0) || n > MAX_VOUCHER_HOURS) return null;
  if (Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) return null;
  return n;
}

/** 1 -> "1 hour", 2 -> "2 hours", 1.5 -> "1.5 hours". */
export function formatHoursLabel(hours: number): string {
  const n = Math.round(hours * 100) / 100;
  return `${n} ${n === 1 ? 'hour' : 'hours'}`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's date as YYYY-MM-DD, in the device's local (UK) time. */
export function todayKey(now: Date = new Date()): string {
  return ymd(now);
}

/**
 * The date `months` after `from`, as YYYY-MM-DD. A day that doesn't exist in
 * the target month is pulled back to that month's last day (31 Jan + 1 month
 * = 28/29 Feb), so it never spills into the following month.
 */
export function addMonths(from: Date, months: number): string {
  const y = from.getFullYear();
  const m = from.getMonth() + months;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return ymd(new Date(y, m, Math.min(from.getDate(), lastDay)));
}

/**
 * What state a voucher is really in. "Expired" is never stored: an active
 * voucher whose expiry date has passed. The expiry day itself is still valid.
 */
export function voucherStatus(
  v: { status: string; expires_at: string },
  today: Date = new Date(),
): VoucherStatus {
  if (v.status === 'redeemed') return 'redeemed';
  if (v.status === 'cancelled') return 'cancelled';
  return v.expires_at < todayKey(today) ? 'expired' : 'active';
}

/** "2026-09-30" -> "30 September 2026". Returns the input unchanged if it isn't a date. */
export function formatVoucherDate(ymdStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdStr || '');
  if (!m) return ymdStr || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Only ordinary web addresses may be used as the logo, so nothing odd is injected into the PDF. */
export function isSafeImageUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(url.trim());
}

export type VoucherPdfInput = {
  code: string;
  hours: number;
  expiresAt: string;
  issuedAt: Date;
  recipientName?: string | null;
  message?: string | null;
  /** The school's or business's name; falls back to the instructor's. */
  businessName?: string | null;
  logoUrl?: string | null;
  instructorName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
};

/** The voucher as an A4 page. Every piece of text is escaped. */
export function buildVoucherHtml(v: VoucherPdfInput): string {
  const e = escapeHtml;
  const issuer = (v.businessName || '').trim() || v.instructorName;
  const hoursLabel = formatHoursLabel(v.hours);
  const contact = [v.contactPhone, v.contactEmail].filter((s): s is string => Boolean(s && s.trim())).map((s) => e(s.trim())).join(' &middot; ');
  const logo = isSafeImageUrl(v.logoUrl)
    ? `<img src="${e(v.logoUrl.trim())}" alt="" style="max-height:72px;max-width:240px;object-fit:contain;margin-bottom:10px;" />`
    : '';
  const recipient = (v.recipientName || '').trim();
  const message = (v.message || '').trim();

  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8" /><title>Gift voucher ${e(v.code)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, system-ui, 'Segoe UI', Arial, sans-serif; color: #0F172A; }
  .page { width: 210mm; height: 297mm; padding: 14mm; }
  .frame { height: 100%; border: 3px solid #00539F; border-radius: 18px; padding: 16mm 14mm; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .brand { font-size: 24px; font-weight: 800; color: #00539F; }
  .rule { width: 90px; height: 4px; background: #FF6B00; border-radius: 2px; margin: 22px 0; }
  .kicker { font-size: 14px; letter-spacing: 6px; text-transform: uppercase; color: #64748B; font-weight: 700; }
  h1 { font-size: 46px; margin: 8px 0 0; letter-spacing: -1px; }
  .hours { font-size: 84px; font-weight: 800; color: #00539F; line-height: 1; margin-top: 40px; letter-spacing: -2px; }
  .of { font-size: 22px; color: #334155; margin-top: 8px; }
  .for { font-size: 18px; margin-top: 34px; color: #64748B; }
  .for strong { color: #0F172A; font-size: 24px; display: block; margin-top: 4px; }
  .msg { font-size: 17px; font-style: italic; color: #334155; margin-top: 26px; max-width: 130mm; line-height: 1.5; }
  .code { margin-top: auto; border: 2px dashed #FF6B00; border-radius: 14px; padding: 16px 30px; background: #FFF7ED; }
  .code .l { font-size: 12px; letter-spacing: 3px; text-transform: uppercase; color: #C2410C; font-weight: 700; }
  .code .c { font-size: 34px; font-weight: 800; letter-spacing: 4px; font-family: 'Courier New', monospace; color: #0F172A; margin-top: 4px; }
  .valid { margin-top: 20px; font-size: 16px; color: #334155; }
  .terms { margin-top: 24px; font-size: 11.5px; color: #64748B; max-width: 140mm; line-height: 1.5; }
</style></head><body><div class="page"><div class="frame">
  ${logo}
  <div class="brand">${e(issuer)}</div>
  <div class="rule"></div>
  <div class="kicker">Gift voucher</div>
  <h1>Driving lessons</h1>
  <div class="hours">${e(hoursLabel)}</div>
  <div class="of">of driving lessons</div>
  ${recipient ? `<div class="for">This voucher is for<strong>${e(recipient)}</strong></div>` : ''}
  ${message ? `<div class="msg">&ldquo;${e(message)}&rdquo;</div>` : ''}
  <div class="code"><div class="l">Voucher code</div><div class="c">${e(v.code)}</div></div>
  <div class="valid">Valid until <strong>${e(formatVoucherDate(v.expiresAt))}</strong></div>
  <div class="terms">
    Redeem by contacting ${e(v.instructorName)}${contact ? ` on ${contact}` : ''} and quoting the code above.
    Lessons are booked subject to availability. This voucher cannot be exchanged for cash and cannot be used after the date shown.
    ${v.address && v.address.trim() ? `<br />${e(v.address.trim())}` : ''}
  </div>
</div></div></body></html>`;
}
