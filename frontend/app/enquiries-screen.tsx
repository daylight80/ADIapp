import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { BottomSheet } from '../src/BottomSheet';
import { useAuth } from '../src/AuthContext';
import { canAddStudent } from '../src/tiers';
import { useStudents } from '../src/useSupabaseData';
import { useEnquiries } from '../src/useEnquiries';
import { addEnquiry, updateEnquiry, listContacts, logContact, closeEnquiry, convertEnquiry } from '../src/enquiriesDb';
import {
  atStage, stageTotals, askedLine, contactLine, telUrl, smsUrl, enquiryProblem, daysSince, CONTACT_LABEL, ENQUIRY_SOURCES,
  type Enquiry, type EnquiryContact, type ContactKind,
} from '../src/enquiries';
import { WAITLIST_STAGES, nextStage, type WaitlistStage } from '../src/waitlistPipeline';

/**
 * Enquiries board: people who have asked about lessons and are not a pupil yet. Three columns as tabs (Waiting,
 * Contacted, Booked); each card has one-tap Call, Text and Email (every one is logged with the date), a contact
 * log with notes, and "Start as pupil" when they begin. Backed by Migration 087; logic in enquiries.ts.
 */

const C = {
  surface: '#F5F2EC', card: '#fff', border: '#E4DED2', text: '#0F172A', muted: '#6B6356', faint: '#A69C8B',
  primary: '#00539F', danger: '#B91C1C', warnBg: '#FFF7ED', ok: '#047857', okBg: '#D1FAE5',
};

type Form = { id: string | null; name: string; phone: string; email: string; postcode: string; source: string; notes: string };
const EMPTY: Form = { id: null, name: '', phone: '', email: '', postcode: '', source: '', notes: '' };

function whenText(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';
}

export default function EnquiriesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { students } = useStudents();
  const { enquiries, loading, error, refresh } = useEnquiries();

  const [stage, setStage] = useState<WaitlistStage>('Waiting');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Two-tap confirmation (Alert does nothing in a browser): which action on which enquiry is waiting for a second tap.
  const [confirm, setConfirm] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<Enquiry | null>(null);
  const [logKind, setLogKind] = useState<ContactKind>('note');
  const [logText, setLogText] = useState('');
  const [contacts, setContacts] = useState<EnquiryContact[]>([]);

  const now = new Date();
  const totals = useMemo(() => stageTotals(enquiries), [enquiries]);
  const shown = atStage(enquiries, stage);

  useEffect(() => {
    if (!openId) { setContacts([]); return; }
    let alive = true;
    listContacts(openId).then((c) => { if (alive) setContacts(c); }).catch(() => { if (alive) setContacts([]); });
    return () => { alive = false; };
  }, [openId, enquiries]);

  const flash = (text: string) => { setNote(text); setTimeout(() => setNote(null), 3500); };
  const run = async (fn: () => Promise<void>, okText?: string) => {
    setBusy(true);
    try { await fn(); if (okText) flash(okText); } catch (e: any) { flash(e?.message || 'Something went wrong. Please try again.'); } finally { setBusy(false); }
  };

  const openForm = (e?: Enquiry) => {
    setFormError(null);
    setForm(e ? { id: e.id, name: e.name, phone: e.phone || '', email: e.email || '', postcode: e.postcode || '', source: e.source || '', notes: e.notes || '' } : { ...EMPTY });
  };

  const saveForm = async () => {
    if (!form) return;
    const problem = enquiryProblem(form);
    if (problem) { setFormError(problem); return; }
    setBusy(true);
    try {
      if (form.id) await updateEnquiry(form.id, form);
      else await addEnquiry(form);
      setForm(null);
      flash(form.id ? 'Saved.' : 'Enquiry added.');
    } catch (e: any) {
      setFormError(e?.message || 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const reach = (e: Enquiry, kind: 'call' | 'text' | 'email') => {
    const url = kind === 'call' ? telUrl(e.phone) : kind === 'text' ? smsUrl(e.phone) : e.email ? `mailto:${e.email}` : null;
    if (!url) { flash(kind === 'email' ? 'No email address saved.' : 'No usable phone number saved.'); return; }
    Linking.openURL(url).catch(() => flash(Platform.OS === 'web' ? 'This device cannot place calls or texts from the browser.' : 'Could not open that.'));
    run(() => logContact(e.id, kind), `${CONTACT_LABEL[kind]} logged.`);
  };

  const start = (e: Enquiry) => {
    if (!canAddStudent(user?.tier, students.length)) {
      flash('Your plan is at its pupil limit. See Plans to add more.');
      return;
    }
    if (confirm !== `start-${e.id}`) { setConfirm(`start-${e.id}`); return; }
    setConfirm(null);
    run(async () => {
      const pupilId = await convertEnquiry(e);
      router.push({ pathname: '/student-lifecycle-screen', params: { id: pupilId } } as any);
    });
  };

  const close = (e: Enquiry) => {
    if (confirm !== `close-${e.id}`) { setConfirm(`close-${e.id}`); return; }
    setConfirm(null);
    run(() => closeEnquiry(e.id), 'Enquiry closed.');
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} testID="btn-back"><ArrowLeft size={20} color={C.text} /></TouchableOpacity>
        <Text style={s.title}>Enquiries</Text>
        <TouchableOpacity onPress={() => openForm()} style={s.addBtn} testID="enquiry-add"><Text style={s.addBtnText}>+ Add</Text></TouchableOpacity>
      </View>

      <View style={s.tabs} testID="enquiry-tabs">
        {WAITLIST_STAGES.map((st) => (
          <TouchableOpacity key={st} style={[s.tab, stage === st && s.tabOn]} onPress={() => { setStage(st); setOpenId(null); }} testID={`enquiry-tab-${st.toLowerCase()}`}>
            <Text style={[s.tabText, stage === st && s.tabTextOn]}>{st}</Text>
            <Text style={[s.tabCount, stage === st && s.tabTextOn]}>{totals[st]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!!note && <View style={s.note} testID="enquiry-note"><Text style={s.noteText}>{note}</Text></View>}

      <ScrollView contentContainerStyle={s.scroll}>
        {loading && enquiries.length === 0 && <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />}
        {!!error && <Text style={s.error} testID="enquiry-error">{error}</Text>}
        {!loading && !error && enquiries.length === 0 && (
          <View style={s.empty} testID="enquiry-empty">
            <Text style={s.emptyTitle}>No enquiries yet</Text>
            <Text style={s.emptySub}>Add someone who has asked about lessons. You can ring or text them from here and keep track of who you have spoken to.</Text>
          </View>
        )}
        {!loading && enquiries.length > 0 && shown.length === 0 && <Text style={s.emptySub} testID="enquiry-stage-empty">Nobody at {stage} right now.</Text>}

        {shown.map((e) => {
          const isOpenCard = openId === e.id;
          const waited = daysSince(e.stage_at, now);
          const next = nextStage(e.stage);
          const back = WAITLIST_STAGES[WAITLIST_STAGES.indexOf(e.stage) - 1];
          return (
            <View key={e.id} style={s.card} testID={`enquiry-${e.id}`}>
              <TouchableOpacity onPress={() => setOpenId(isOpenCard ? null : e.id)} testID={`enquiry-toggle-${e.id}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={s.name} numberOfLines={1}>{e.name}</Text>
                  {!!e.source && <Text style={s.source}>{e.source}</Text>}
                </View>
                <Text style={s.meta}>{askedLine(e, now)} · {contactLine(e, now)}{waited !== null && waited >= 1 ? ` · ${e.stage} ${waited} days` : ''}</Text>
                {!!e.phone && <Text style={s.meta}>{e.phone}</Text>}
              </TouchableOpacity>

              <View style={s.reachRow}>
                <TouchableOpacity style={[s.reachBtn, !telUrl(e.phone) && s.disabled]} onPress={() => reach(e, 'call')} disabled={busy} testID={`enquiry-call-${e.id}`}><Text style={s.reachText}>Call</Text></TouchableOpacity>
                <TouchableOpacity style={[s.reachBtn, !smsUrl(e.phone) && s.disabled]} onPress={() => reach(e, 'text')} disabled={busy} testID={`enquiry-text-${e.id}`}><Text style={s.reachText}>Text</Text></TouchableOpacity>
                <TouchableOpacity style={[s.reachBtn, !e.email && s.disabled]} onPress={() => reach(e, 'email')} disabled={busy} testID={`enquiry-email-${e.id}`}><Text style={s.reachText}>Email</Text></TouchableOpacity>
              </View>

              {isOpenCard && (
                <View style={{ gap: 10, marginTop: 10 }}>
                  {!!e.notes && <Text style={s.notes}>{e.notes}</Text>}
                  <View style={s.actionRow}>
                    {!!next && <TouchableOpacity style={s.smallBtn} onPress={() => run(() => updateEnquiry(e.id, { stage: next }), `Moved to ${next}.`)} disabled={busy} testID={`enquiry-next-${e.id}`}><Text style={s.smallText}>Move to {next}</Text></TouchableOpacity>}
                    {!!back && <TouchableOpacity style={s.smallBtn} onPress={() => run(() => updateEnquiry(e.id, { stage: back }), `Moved back to ${back}.`)} disabled={busy}><Text style={s.smallText}>Back to {back}</Text></TouchableOpacity>}
                    <TouchableOpacity style={s.smallBtn} onPress={() => { setLogFor(e); setLogKind('note'); setLogText(''); }} testID={`enquiry-log-${e.id}`}><Text style={s.smallText}>Log contact</Text></TouchableOpacity>
                    <TouchableOpacity style={s.smallBtn} onPress={() => openForm(e)} testID={`enquiry-edit-${e.id}`}><Text style={s.smallText}>Edit</Text></TouchableOpacity>
                  </View>
                  <View style={s.actionRow}>
                    <TouchableOpacity style={[s.smallBtn, s.startBtn]} onPress={() => start(e)} disabled={busy} testID={`enquiry-start-${e.id}`}>
                      <Text style={[s.smallText, { color: C.ok }]}>{confirm === `start-${e.id}` ? 'Tap again to create the pupil' : 'Start as pupil'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.smallBtn} onPress={() => close(e)} disabled={busy} testID={`enquiry-close-${e.id}`}>
                      <Text style={[s.smallText, { color: C.danger }]}>{confirm === `close-${e.id}` ? 'Tap again to close' : 'Not proceeding'}</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={s.logTitle}>Contact log</Text>
                  {contacts.length === 0 && <Text style={s.meta}>Nothing logged yet.</Text>}
                  {contacts.map((c) => (
                    <View key={c.id} style={s.logRow} testID={`contact-${c.id}`}>
                      <Text style={s.logKind}>{CONTACT_LABEL[c.kind]}</Text>
                      <Text style={s.logWhen}>{whenText(c.contacted_at)}</Text>
                      {!!c.note && <Text style={s.logNote}>{c.note}</Text>}
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <BottomSheet visible={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit enquiry' : 'Add enquiry'} testID="enquiry-form">
        {form && (
          <View>
            <Text style={s.label}>Name *</Text>
            <TextInput style={s.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="e.g. Charlotte Smith" placeholderTextColor={C.faint} testID="enquiry-input-name" />
            <Text style={s.label}>Phone</Text>
            <TextInput style={s.input} value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" placeholder="07700 900000" placeholderTextColor={C.faint} testID="enquiry-input-phone" />
            <Text style={s.label}>Email</Text>
            <TextInput style={s.input} value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} autoCapitalize="none" keyboardType="email-address" placeholder="name@example.co.uk" placeholderTextColor={C.faint} testID="enquiry-input-email" />
            <Text style={s.label}>Postcode</Text>
            <TextInput style={s.input} value={form.postcode} onChangeText={(v) => setForm({ ...form, postcode: v })} autoCapitalize="characters" placeholder="CR4 1AA" placeholderTextColor={C.faint} testID="enquiry-input-postcode" />
            <Text style={s.label}>How did they find you?</Text>
            <View style={s.chips}>
              {ENQUIRY_SOURCES.map((src) => (
                <TouchableOpacity key={src} style={[s.chip, form.source === src && s.chipOn]} onPress={() => setForm({ ...form, source: form.source === src ? '' : src })}>
                  <Text style={[s.chipText, form.source === src && { color: '#fff' }]}>{src}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.label}>Notes</Text>
            <TextInput style={[s.input, { height: 84, textAlignVertical: 'top', paddingTop: 10 }]} value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} multiline placeholder="Availability, test date, anything they said" placeholderTextColor={C.faint} testID="enquiry-input-notes" />
            {!!formError && <Text style={s.error} testID="enquiry-form-error">{formError}</Text>}
            <TouchableOpacity style={[s.submit, busy && { opacity: 0.6 }]} onPress={saveForm} disabled={busy} testID="enquiry-save">
              <Text style={s.submitText}>{form.id ? 'Save' : 'Add enquiry'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </BottomSheet>

      <BottomSheet visible={!!logFor} onClose={() => setLogFor(null)} title={logFor ? `Log contact: ${logFor.name}` : ''} testID="enquiry-log-sheet">
        <View style={s.chips}>
          {(['call', 'text', 'email', 'note'] as ContactKind[]).map((k) => (
            <TouchableOpacity key={k} style={[s.chip, logKind === k && s.chipOn]} onPress={() => setLogKind(k)} testID={`log-kind-${k}`}>
              <Text style={[s.chipText, logKind === k && { color: '#fff' }]}>{CONTACT_LABEL[k]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.label}>What was said</Text>
        <TextInput style={[s.input, { height: 84, textAlignVertical: 'top', paddingTop: 10 }]} value={logText} onChangeText={setLogText} multiline placeholder="e.g. Wants Saturday mornings, ring back Thursday" placeholderTextColor={C.faint} testID="log-text" />
        <TouchableOpacity
          style={[s.submit, busy && { opacity: 0.6 }]}
          disabled={busy}
          testID="log-save"
          onPress={() => {
            const target = logFor;
            if (!target) return;
            run(async () => { await logContact(target.id, logKind, logText); setLogFor(null); }, 'Logged.');
          }}
        >
          <Text style={s.submitText}>Save</Text>
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: C.text },
  addBtn: { minWidth: 56, height: 38, paddingHorizontal: 12, borderRadius: 11, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tab: { flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  tabOn: { backgroundColor: C.primary, borderColor: C.primary },
  tabText: { fontSize: 13.5, fontWeight: '700', color: C.text },
  tabCount: { fontSize: 13, fontWeight: '700', color: C.muted },
  tabTextOn: { color: '#fff' },
  note: { marginHorizontal: 16, marginBottom: 6, padding: 10, borderRadius: 11, backgroundColor: C.okBg },
  noteText: { color: C.ok, fontWeight: '600', fontSize: 13 },
  scroll: { paddingHorizontal: 16, paddingBottom: 60, gap: 10 },
  error: { color: C.danger, fontWeight: '600', fontSize: 13, marginTop: 10 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 36 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  emptySub: { fontSize: 13.5, lineHeight: 19, color: C.muted, textAlign: 'center' },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14 },
  name: { flex: 1, fontSize: 16, fontWeight: '800', color: C.text },
  source: { fontSize: 11.5, fontWeight: '700', color: C.muted },
  meta: { fontSize: 12.5, color: C.muted, marginTop: 3 },
  reachRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  reachBtn: { flex: 1, minHeight: 42, borderRadius: 11, borderWidth: 1.5, borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  reachText: { fontWeight: '700', color: C.primary, fontSize: 14 },
  disabled: { opacity: 0.35 },
  notes: { fontSize: 13.5, lineHeight: 19, color: C.text },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallBtn: { minHeight: 38, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  startBtn: { borderColor: '#10B981', backgroundColor: C.okBg },
  smallText: { fontSize: 13, fontWeight: '700', color: C.text },
  logTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: C.muted, marginTop: 4 },
  logRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#EDE8DE' },
  logKind: { fontSize: 13, fontWeight: '700', color: C.text },
  logWhen: { fontSize: 12, color: C.muted },
  logNote: { fontSize: 13, color: C.text, marginTop: 2 },
  label: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: C.faint, marginTop: 12, marginBottom: 5 },
  input: { minHeight: 46, paddingHorizontal: 13, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: '#fff', fontSize: 14, color: C.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: C.text },
  submit: { marginTop: 18, minHeight: 50, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
