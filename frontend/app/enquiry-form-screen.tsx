import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { API_BASE } from '../src/api';
import { theme } from '../src/theme';
import { enquiryBody, enquiryProblem, type EnquiryFields } from '../src/enquiryForm';

/**
 * The enquiry form DualControl hosts for a school: open to anyone, no login. The school's key is in the address
 * (?k=...). A wrong, switched-off or Starter key shows the same "not available" note, so keys cannot be tested for.
 * It posts to the same public address an Elementor form's Webhook would.
 */
const THEORY = ['Not yet', 'Booked', 'Passed'];
const GEARS = ['Manual', 'Automatic'];
const EMPTY: EnquiryFields = {
  name: '', phone: '', email: '', postcode: '', availability: '', theory: '', transmission: '', message: '',
  consent: false, company_website: '',
};

// Outside the screen on purpose: made inside it, they would be new components on every keystroke and lose focus.
function Chips({ options, value, onPick, id }: { options: string[]; value: string; onPick: (v: string) => void; id: string }) {
  return (
    <View style={s.chipRow}>
      {options.map((o) => (
        <TouchableOpacity key={o} style={[s.chip, value === o && s.chipOn]} onPress={() => onPick(value === o ? '' : o)} testID={`${id}-${o}`}>
          <Text style={[s.chipText, value === o && s.chipTextOn]}>{o}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Field(p: { label: string; value: string; onChange: (v: string) => void; id: string; multiline?: boolean; keyboard?: any; auto?: any }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{p.label}</Text>
      <TextInput
        style={[s.input, p.multiline && { minHeight: 96, textAlignVertical: 'top' }]}
        value={p.value}
        onChangeText={p.onChange}
        multiline={p.multiline}
        keyboardType={p.keyboard}
        autoComplete={p.auto}
        testID={p.id}
      />
    </View>
  );
}

export default function EnquiryFormScreen() {
  const params = useLocalSearchParams();
  const key = String(params.k || '');
  const [school, setSchool] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'sent'>('loading');
  const [f, setF] = useState<EnquiryFields>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EnquiryFields>) => setF((v) => ({ ...v, ...patch }));

  useEffect(() => {
    let alive = true;
    if (!key) { setState('unavailable'); return; }
    fetch(`${API_BASE}/public/enquiries/${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) { setSchool(j?.school_name || ''); setState(j?.available ? 'ready' : 'unavailable'); } })
      .catch(() => { if (alive) setState('unavailable'); });
    return () => { alive = false; };
  }, [key]);

  const submit = async () => {
    const problem = enquiryProblem(f);
    if (problem) { setError(problem); return; }
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/public/enquiries/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enquiryBody(f)),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) { setError(typeof j?.detail === 'string' ? j.detail : 'Sorry, that did not send. Please try again.'); return; }
      setState('sent');
    } catch {
      setError('Sorry, that did not send. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {state === 'loading' && <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 60 }} testID="enquiry-loading" />}

          {state === 'unavailable' && (
            <View style={s.box} testID="enquiry-unavailable">
              <Text style={s.heading}>This form is not available</Text>
              <Text style={s.body}>Please contact the driving school directly.</Text>
            </View>
          )}

          {state === 'sent' && (
            <View style={s.box} testID="enquiry-sent">
              <Text style={s.heading}>Thank you</Text>
              <Text style={s.body}>Your enquiry has been sent{school ? ` to ${school}` : ''}. They will be in touch soon.</Text>
            </View>
          )}

          {state === 'ready' && (
            <View style={{ gap: 16 }}>
              <Text style={s.heading}>{school ? `Enquire with ${school}` : 'Driving lesson enquiry'}</Text>
              <Text style={s.body}>Tell us a little about you and we will get back to you.</Text>

              <Field label="Your name *" value={f.name} onChange={(v) => set({ name: v })} id="enq-name" auto="name" />
              <Field label="Mobile number" value={f.phone} onChange={(v) => set({ phone: v })} id="enq-phone" keyboard="phone-pad" auto="tel" />
              <Field label="Email" value={f.email} onChange={(v) => set({ email: v })} id="enq-email" keyboard="email-address" auto="email" />
              <Field label="Postcode" value={f.postcode} onChange={(v) => set({ postcode: v })} id="enq-postcode" auto="postal-code" />
              <Field label="When are you free for lessons?" value={f.availability} onChange={(v) => set({ availability: v })} id="enq-availability" />

              <View style={{ gap: 6 }}>
                <Text style={s.label}>Theory test</Text>
                <Chips options={THEORY} value={f.theory} onPick={(v) => set({ theory: v })} id="enq-theory" />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={s.label}>Gearbox</Text>
                <Chips options={GEARS} value={f.transmission} onPick={(v) => set({ transmission: v })} id="enq-gear" />
              </View>

              <Field label="Anything else we should know?" value={f.message} onChange={(v) => set({ message: v })} id="enq-message" multiline />

              {/* A trap for bots: invisible and out of reach for people, so only a bot ever fills it in. */}
              <View style={s.trap} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <TextInput value={f.company_website} onChangeText={(v) => set({ company_website: v })} tabIndex={-1} autoComplete="off" testID="enq-company-website" />
              </View>

              <TouchableOpacity
                style={s.consentRow}
                onPress={() => set({ consent: !f.consent })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: f.consent }}
                testID="enq-consent"
              >
                <View style={[s.box2, f.consent && s.box2On]}>{f.consent && <Text style={s.tick}>✓</Text>}</View>
                <Text style={s.consentText}>I am happy for {school || 'the driving school'} to contact me about driving lessons. *</Text>
              </TouchableOpacity>

              {!!error && <Text style={s.error} testID="enq-error">{error}</Text>}

              <TouchableOpacity style={[s.cta, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} testID="enq-submit">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.ctaText}>Send enquiry</Text>}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: 20, paddingBottom: 48, maxWidth: 560, width: '100%', alignSelf: 'center' },
  heading: { fontSize: 24, fontWeight: '800', color: theme.colors.text },
  body: { fontSize: 15, lineHeight: 22, color: theme.colors.textMuted },
  box: { gap: 10, paddingTop: 40 },
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
  input: { minHeight: 46, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, backgroundColor: theme.colors.surface, color: theme.colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, justifyContent: 'center' },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 14, color: theme.colors.text },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  trap: { position: 'absolute', left: -5000, width: 1, height: 1, opacity: 0 },
  consentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  box2: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  box2On: { backgroundColor: theme.colors.primary },
  tick: { color: '#fff', fontWeight: '800', fontSize: 14 },
  consentText: { flex: 1, fontSize: 14, lineHeight: 20, color: theme.colors.text },
  error: { color: theme.colors.danger, fontSize: 14, fontWeight: '600' },
  cta: { minHeight: 50, borderRadius: 14, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
