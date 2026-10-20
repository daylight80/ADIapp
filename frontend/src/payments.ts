// Payment tracking: money received from a pupil (migration 072). Pure logic, no I/O, so it is
// unit-tested (see __tests__/payments.test.ts). A pupil's balance is what they have been charged for
// completed lessons (and cancellation charges), minus what they have paid and any wallet top-ups.
// Positive means they owe it; negative means they are in credit.
import { escapeHtml } from './htmlEscape';

export type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'voucher' | 'other';

export const PAYMENT_METHOD_CHOICES: { key: PaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'card', label: 'Card' },
  { key: 'voucher', label: 'Voucher' },
  { key: 'other', label: 'Other' },
];

export const MAX_PAYMENT_GBP = 10000;

export function methodLabel(m: string | null | undefined): string {
  return PAYMENT_METHOD_CHOICES.find((c) => c.key === m)?.label ?? 'Payment';
}

/** What was typed, as pounds: "36", "£36.50" and "1,200" work; zero, negatives, three decimals and over the maximum do not. */
export function parseAmount(input: string | null | undefined): number | null {
  const t = (input || '').replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  if (!(n > 0) || n > MAX_PAYMENT_GBP) return null;
  return Math.round(n * 100) / 100;
}

/** 1234.5 -> "£1,234.50". */
export function formatGbp(n: number): string {
  const v = Math.round(Math.abs(Number(n) || 0) * 100) / 100;
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type BalanceKind = 'owes' | 'credit' | 'clear';
export type BalanceView = { kind: BalanceKind; amount: number; label: string };

/** The instructor's view of a pupil's balance. Under a penny either way counts as settled. */
export function describeBalance(outstanding: number | null | undefined): BalanceView {
  const v = Math.round(Number(outstanding || 0) * 100) / 100;
  if (v > 0) return { kind: 'owes', amount: v, label: `Owes ${formatGbp(v)}` };
  if (v < 0) return { kind: 'credit', amount: -v, label: `${formatGbp(v)} in credit` };
  return { kind: 'clear', amount: 0, label: 'Up to date' };
}

/** The pupil's own view, spoken to them. */
export function pupilBalanceLine(outstanding: number | null | undefined, instructorFirstName?: string | null): string {
  const b = describeBalance(outstanding);
  const to = instructorFirstName ? ` to ${instructorFirstName}` : '';
  if (b.kind === 'owes') return `You owe ${formatGbp(b.amount)}${to}.`;
  if (b.kind === 'credit') return `You have ${formatGbp(b.amount)} in credit.`;
  return 'You are all paid up.';
}

export type PaymentRow = {
  id: string;
  amount: number;
  method: PaymentMethod | string;
  paid_at: string;
  reference?: string | null;
  note?: string | null;
  source?: 'manual' | 'lesson' | 'migrated' | string;
  voided_at?: string | null;
  void_reason?: string | null;
  /** Set when the instructor changed the date by hand. */
  date_changed_at?: string | null;
  /** The date as first recorded, kept the first time it is changed. */
  original_paid_at?: string | null;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of a payment, as YYYY-MM-DD, for a date picker. */
export function paymentDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A picked day as the time to store: midday that day, so a timezone shift cannot move it to another day. Null if not a date. */
export function paidAtForDay(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const d = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Whether a picked day is later than today (a payment can't be dated in the future). */
export function isFutureDay(dateKey: string, todayKey: string): boolean {
  return dateKey > todayKey;
}

export function paymentDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Cash · 14 Oct 2026 · ref ABC" */
export function paymentSubline(p: PaymentRow): string {
  return [methodLabel(p.method), paymentDate(p.paid_at), p.reference ? `ref ${p.reference}` : ''].filter(Boolean).join(' · ');
}

/** Counted payments only, newest first. */
export function activePayments(rows: PaymentRow[]): PaymentRow[] {
  return rows.filter((p) => !p.voided_at).sort((a, b) => b.paid_at.localeCompare(a.paid_at));
}

/** What went wrong when recording or voiding, in words the instructor can act on. */
export function paymentErrorMessage(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === '22023' || err?.code === '42501' || err?.code === 'P0002') return err.message || 'That could not be saved.';
  if (err?.code === '28000') return 'Please sign in again, then try once more.';
  return "Couldn't save that. Check your connection and try again.";
}

export type HistoryEntry = { id: string; kind: 'payment' | 'topup'; title: string; sub: string; amount: number; at: string };

/** A pupil's payments and wallet top-ups as one list, newest first. */
export function pupilHistory(summary: {
  payments: { id: string; amount: number; method: string; paid_at: string; reference?: string | null }[];
  topups: { id: string; amount: number; hours: number; at: string; method?: string | null }[];
}): HistoryEntry[] {
  const payments: HistoryEntry[] = summary.payments.map((p) => ({
    id: `p-${p.id}`, kind: 'payment', title: 'Payment', amount: p.amount, at: p.paid_at,
    sub: paymentSubline({ id: p.id, amount: p.amount, method: p.method, paid_at: p.paid_at, reference: p.reference }),
  }));
  const topups: HistoryEntry[] = summary.topups.map((k) => ({
    id: `t-${k.id}`, kind: 'topup', title: `Prepaid ${k.hours} ${k.hours === 1 ? 'hour' : 'hours'}`, amount: k.amount, at: k.at,
    sub: [k.method ? methodLabel(k.method) : '', paymentDate(k.at)].filter(Boolean).join(' · '),
  }));
  return [...payments, ...topups].sort((a, b) => b.at.localeCompare(a.at));
}

export type ReceiptInput = {
  receiptNo: string;
  amount: number;
  method: string;
  paidAt: string;
  reference?: string | null;
  note?: string | null;
  studentName: string;
  instructorName: string;
  instructorEmail?: string | null;
  issuedAt: Date;
  schoolName?: string | null;
  schoolLogoUrl?: string | null;
  schoolContactEmail?: string | null;
  schoolContactPhone?: string | null;
  schoolAddress?: string | null;
};

/** A one-payment receipt. No VAT is shown. Every piece of text is escaped. */
export function buildReceiptHtml(r: ReceiptInput): string {
  const e = escapeHtml;
  const issuer = (r.schoolName || '').trim() || r.instructorName;
  const contact = [r.schoolContactPhone, r.schoolContactEmail].filter((s): s is string => Boolean(s && s.trim())).map((s) => e(s.trim())).join(' &middot; ');
  const logo = r.schoolLogoUrl && /^https?:\/\/[^\s"'<>]+$/i.test(r.schoolLogoUrl.trim())
    ? `<img src="${e(r.schoolLogoUrl.trim())}" alt="" style="max-height:56px;max-width:200px;object-fit:contain;margin-bottom:8px;" />`
    : '';
  const rows = [
    ['Received from', e(r.studentName)],
    ['Date paid', e(paymentDate(r.paidAt))],
    ['Method', e(methodLabel(r.method))],
    r.reference ? ['Reference', e(r.reference)] : null,
    r.note ? ['Note', e(r.note)] : null,
  ].filter((x): x is string[] => !!x)
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8" /><title>Receipt ${e(r.receiptNo)}</title>
<style>
  body { font-family: -apple-system, system-ui, 'Segoe UI', Arial, sans-serif; color: #0F172A; padding: 36px; max-width: 640px; margin: 0 auto; }
  .head { border-bottom: 2px solid #00539F; padding-bottom: 14px; margin-bottom: 22px; display: flex; justify-content: space-between; gap: 16px; }
  .brand { font-size: 22px; font-weight: 800; color: #00539F; }
  .muted { color: #64748B; font-size: 13px; }
  h1 { font-size: 20px; margin: 0; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; width: 38%; color: #64748B; font-weight: 600; font-size: 13px; padding: 9px 0; border-bottom: 1px solid #E2E8F0; }
  td { padding: 9px 0; border-bottom: 1px solid #E2E8F0; font-size: 15px; }
  .total { margin-top: 22px; display: flex; justify-content: space-between; align-items: baseline; border-top: 2px solid #00539F; padding-top: 12px; }
  .total .amt { font-size: 28px; font-weight: 800; color: #00539F; }
  .foot { margin-top: 30px; font-size: 12px; color: #64748B; }
</style></head><body>
<div class="head">
  <div>${logo}<div class="brand">${e(issuer)}</div>
    ${r.schoolAddress ? `<div class="muted">${e(r.schoolAddress)}</div>` : ''}${contact ? `<div class="muted">${contact}</div>` : ''}</div>
  <div><h1>Payment receipt</h1><div class="muted" style="text-align:right">No. ${e(r.receiptNo)}<br />Issued ${e(paymentDate(r.issuedAt.toISOString()))}</div></div>
</div>
<table>${rows}</table>
<div class="total"><span class="muted">Amount received</span><span class="amt">${e(formatGbp(r.amount))}</span></div>
<div class="foot">Received by ${e(r.instructorName)}${r.instructorEmail ? ` (${e(r.instructorEmail)})` : ''}. Thank you.</div>
</body></html>`;
}
