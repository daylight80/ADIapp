import { supabase } from './supabaseClient';
import { addStudent, ownContext } from './supabaseDb';
import { bump } from './useSupabaseData';
import { enquiryToPupilInput, type Enquiry, type EnquiryContact, type EnquiryStage, type ContactKind } from './enquiries';

/** Open enquiries (not started, not closed), oldest first. */
export async function listOpenEnquiries(): Promise<Enquiry[]> {
  const { data, error } = await supabase
    .from('enquiries')
    .select('*')
    .is('converted_at', null)
    .is('closed_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as Enquiry[];
}

export type EnquiryInput = { name: string; phone?: string; email?: string; postcode?: string; source?: string; notes?: string };

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export async function addEnquiry(input: EnquiryInput): Promise<Enquiry> {
  const { schoolId, instructorId } = await ownContext();
  const { data, error } = await supabase
    .from('enquiries')
    .insert({
      instructor_id: instructorId,
      school_id: schoolId,
      name: input.name.trim(),
      phone: clean(input.phone),
      email: clean(input.email)?.toLowerCase() ?? null,
      postcode: clean(input.postcode)?.toUpperCase() ?? null,
      source: clean(input.source),
      notes: clean(input.notes),
    })
    .select('*')
    .single();
  if (error) throw error;
  bump();
  return data as Enquiry;
}

export async function updateEnquiry(id: string, patch: Partial<EnquiryInput> & { stage?: EnquiryStage }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.phone !== undefined) row.phone = clean(patch.phone);
  if (patch.email !== undefined) row.email = clean(patch.email)?.toLowerCase() ?? null;
  if (patch.postcode !== undefined) row.postcode = clean(patch.postcode)?.toUpperCase() ?? null;
  if (patch.source !== undefined) row.source = clean(patch.source);
  if (patch.notes !== undefined) row.notes = clean(patch.notes);
  if (patch.stage !== undefined) row.stage = patch.stage;
  const { error } = await supabase.from('enquiries').update(row).eq('id', id);
  if (error) throw error;
  bump();
}

export async function listContacts(enquiryId: string): Promise<EnquiryContact[]> {
  const { data, error } = await supabase
    .from('enquiry_contacts')
    .select('*')
    .eq('enquiry_id', enquiryId)
    .order('contacted_at', { ascending: false });
  if (error) throw error;
  return (data || []) as EnquiryContact[];
}

/** Log a call, text, email or note. Logging a call, text or email on a Waiting enquiry moves it to Contacted (database trigger). */
export async function logContact(enquiryId: string, kind: ContactKind, note?: string): Promise<void> {
  const { instructorId } = await ownContext();
  const { error } = await supabase
    .from('enquiry_contacts')
    .insert({ enquiry_id: enquiryId, instructor_id: instructorId, kind, note: clean(note) });
  if (error) throw error;
  bump();
}

export async function closeEnquiry(id: string, reason?: string): Promise<void> {
  const { error } = await supabase
    .from('enquiries')
    .update({ closed_at: new Date().toISOString(), closed_reason: clean(reason) })
    .eq('id', id);
  if (error) throw error;
  bump();
}

/** They are starting: create the pupil from the enquiry and mark the enquiry converted. Returns the new pupil's id. */
export async function convertEnquiry(enquiry: Enquiry): Promise<string> {
  const pupil = await addStudent(enquiryToPupilInput(enquiry));
  const { error } = await supabase
    .from('enquiries')
    .update({ converted_student_id: pupil.id, converted_at: new Date().toISOString() })
    .eq('id', enquiry.id);
  if (error) throw error;
  bump();
  return pupil.id;
}
