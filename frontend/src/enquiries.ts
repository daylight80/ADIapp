// Enquiries: people who have asked about lessons and are not a pupil record yet. They move Waiting -> Contacted ->
// Booked (the same stages as the waiting list on a pupil), are contacted by call, text or email (each logged), and are
// converted into a pupil when they start. Pure logic, tested in __tests__/enquiries.test.ts. Backed by Migration 087.
import type { WaitlistStage } from './waitlistPipeline';
import type { AddStudentInput } from './supabaseDb';

export type EnquiryStage = WaitlistStage;
export type ContactKind = 'call' | 'text' | 'email' | 'note';

export type Enquiry = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  postcode: string | null;
  source: string | null;
  notes: string | null;
  stage: EnquiryStage;
  stage_at: string;
  last_contacted_at: string | null;
  converted_student_id: string | null;
  converted_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
};

export type EnquiryContact = { id: string; enquiry_id: string; kind: ContactKind; note: string | null; contacted_at: string };

export const ENQUIRY_SOURCES = ['Website', 'Phone call', 'Facebook', 'Word of mouth', 'Other'];

/** An enquiry still being worked: not started as a pupil and not closed. */
export function isOpen(e: Pick<Enquiry, 'converted_at' | 'closed_at'>): boolean {
  return !e.converted_at && !e.closed_at;
}

const DAY_MS = 86_400_000;

/** Whole days between an ISO time and now (never negative), or null when unreadable. */
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

const agoText = (d: number) => (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);

/** "Asked today", "Asked 4 days ago" */
export function askedLine(e: Pick<Enquiry, 'created_at'>, now: Date): string {
  const d = daysSince(e.created_at, now);
  return d === null ? '' : `Asked ${agoText(d)}`;
}

/** "Not contacted yet" or "Last contact: yesterday" */
export function contactLine(e: Pick<Enquiry, 'last_contacted_at'>, now: Date): string {
  const d = daysSince(e.last_contacted_at, now);
  return d === null ? 'Not contacted yet' : `Last contact: ${agoText(d)}`;
}

/** The enquiries to show at a stage, longest-waiting first. */
export function atStage(list: Enquiry[], stage: EnquiryStage): Enquiry[] {
  return list
    .filter((e) => isOpen(e) && e.stage === stage)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function stageTotals(list: Enquiry[]): Record<EnquiryStage, number> {
  const out: Record<EnquiryStage, number> = { Waiting: 0, Contacted: 0, Booked: 0 };
  for (const e of list) if (isOpen(e)) out[e.stage] += 1;
  return out;
}

/** A phone number reduced to digits and a leading +, or null when it is too short to ring. */
export function dialable(phone: string | null | undefined): string | null {
  const cleaned = (phone || '').trim().replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return cleaned.replace(/\D/g, '').length >= 7 ? cleaned : null;
}

export function telUrl(phone: string | null | undefined): string | null {
  const n = dialable(phone);
  return n ? `tel:${n}` : null;
}

export function smsUrl(phone: string | null | undefined): string | null {
  const n = dialable(phone);
  return n ? `sms:${n}` : null;
}

/** A problem with a new or edited enquiry, or null when it is fine. They need a name and some way to be reached. */
export function enquiryProblem(input: { name: string; phone?: string; email?: string }): string | null {
  if (!input.name.trim()) return 'Please enter their name.';
  const phone = (input.phone || '').trim();
  const email = (input.email || '').trim();
  if (!phone && !email) return 'Add a phone number or an email so you can reach them.';
  if (phone && !dialable(phone)) return 'That phone number looks too short.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'That email address does not look right.';
  return null;
}

/** What to create the pupil from when an enquiry starts. */
export function enquiryToPupilInput(e: Pick<Enquiry, 'name' | 'email' | 'phone' | 'postcode'>): AddStudentInput {
  return {
    name: e.name,
    email: e.email || '',
    phone: e.phone || undefined,
    postcode: e.postcode || undefined,
    provisional_licence: '',
  };
}

export const CONTACT_LABEL: Record<ContactKind, string> = { call: 'Called', text: 'Texted', email: 'Emailed', note: 'Note' };

/** Enquiries that need chasing: not contacted after 2 days, or contacted but gone a week with no booking. */
export const ENQUIRY_UNCONTACTED_DAYS = 2;
export const ENQUIRY_FOLLOW_UP_DAYS = 7;
