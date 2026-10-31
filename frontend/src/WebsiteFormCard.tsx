import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { Globe, Copy, CircleCheck, RefreshCcw, Power } from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { copyToClipboard } from './tools';
import { callBackend } from './backendCall';
import { API_BASE } from './api';
import { formPageUrl, webhookUrl, iframeSnippet, privacyWording } from './enquiryForm';

type FormStatus = { available: boolean; enabled: boolean; key: string | null; form_path: string | null };

/**
 * Profile > Website form (school owner, DC Pro and Franchise). Shows where a school's website form sends its
 * enquiries: the hosted page to link or embed, and the address an Elementor Form's Webhook action posts to.
 * The key in them is what says which school an enquiry is for, so "Make a new key" stops the old addresses at once.
 */
export function WebsiteFormCard() {
  const [status, setStatus] = useState<FormStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setStatus(await callBackend<FormStatus>('/v2/enquiry-form', 'GET')); }
    catch (e: any) { setError(e?.message || 'Could not load the website form.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (path: string, body?: unknown) => {
    setBusy(true); setError(null);
    try { setStatus(await callBackend<FormStatus>(path, 'POST', body)); }
    catch (e: any) { setError(e?.message || 'That did not work.'); }
    finally { setBusy(false); }
  };

  const newKey = async () => {
    const title = 'Make a new key?';
    const body = 'The addresses you have already pasted into your website will stop working straight away, and you will need to paste the new ones.';
    const yes = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`${title}\n\n${body}`)
      : await new Promise<boolean>((resolve) => Alert.alert(title, body, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Make a new key', style: 'destructive', onPress: () => resolve(true) },
      ]));
    if (yes) run('/v2/enquiry-form/regenerate');
  };

  const copy = (id: string, text: string) => {
    if (copyToClipboard(text)) { setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 2400); }
    else Alert.alert('Copy this', text);
  };

  const Header = (
    <View style={s.head}>
      <Globe size={18} color={theme.colors.primary} />
      <Text style={s.title}>Website form</Text>
    </View>
  );

  if (!status) {
    return (
      <Card style={{ gap: 10 }} testID="card-website-form">
        {Header}
        {error ? <Text style={s.error} testID="website-form-error">{error}</Text> : <ActivityIndicator color={theme.colors.primary} />}
      </Card>
    );
  }

  if (!status.available) {
    return (
      <Card style={{ gap: 10 }} testID="card-website-form">
        {Header}
        <Text style={s.hint} testID="website-form-upgrade">
          A form for your own website, with enquiries arriving straight in DualControl, is part of DC Pro and Franchise.
        </Text>
      </Card>
    );
  }

  const webOrigin = Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.EXPO_PUBLIC_APP_URL || 'https://webapp.drivingschoolsolutions.co.uk');
  const key = status.key || '';
  const page = key ? formPageUrl(webOrigin, key) : '';
  const hook = key ? webhookUrl(API_BASE, key) : '';

  const Row = ({ id, label, value }: { id: string; label: string; value: string }) => (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.urlRow}>
        <Text style={s.url} numberOfLines={2} selectable testID={`website-form-${id}`}>{value}</Text>
        <TouchableOpacity style={[s.iconBtn, copied === id && s.iconBtnOk]} onPress={() => copy(id, value)} testID={`website-form-copy-${id}`} accessibilityLabel={`Copy ${label}`}>
          {copied === id ? <CircleCheck size={16} color="#fff" /> : <Copy size={16} color="#fff" />}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Card style={{ gap: 12 }} testID="card-website-form">
      {Header}
      <Text style={s.hint}>
        Visitors to your website can send you an enquiry. It lands in Enquiries to contact and you get a notification.
        Treat the addresses below like a password: anyone who has one can send enquiries to you.
      </Text>

      <View style={s.statusRow}>
        <Text style={[s.status, status.enabled ? s.on : s.off]} testID="website-form-status">{status.enabled ? 'On' : 'Off'}</Text>
        <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={() => run('/v2/enquiry-form/enabled', { enabled: !status.enabled })} disabled={busy} testID="website-form-toggle">
          <Power size={14} color={theme.colors.primary} />
          <Text style={s.btnText}>{status.enabled ? 'Switch off' : 'Switch on'}</Text>
        </TouchableOpacity>
      </View>
      {!status.enabled && <Text style={s.hint}>While it is off, enquiries sent to your form are quietly ignored.</Text>}

      {!!key && (
        <>
          <Row id="page" label="Form page (link to it, or embed it)" value={page} />
          <Row id="iframe" label="Embed on any website (HTML)" value={iframeSnippet(page)} />
          <Row id="webhook" label="Elementor: Actions after submit, Webhook" value={hook} />

          <View style={s.how}>
            <Text style={s.label}>Using your own Elementor form</Text>
            <Text style={s.hintSmall}>1. Edit the form, then Actions After Submit, then add Webhook.</Text>
            <Text style={s.hintSmall}>2. Paste the Elementor address above into Webhook URL, and leave Advanced Data off.</Text>
            <Text style={s.hintSmall}>3. Keep a field for the name, and a mobile number or email. Questions you add are kept in the notes.</Text>
          </View>

          <View style={s.how}>
            <Text style={s.label}>Wording for your form (privacy)</Text>
            <Text style={s.hintSmall} selectable>{privacyWording('')}</Text>
            <TouchableOpacity style={s.btn} onPress={() => copy('privacy', privacyWording(''))} testID="website-form-copy-privacy">
              <Copy size={14} color={theme.colors.primary} />
              <Text style={s.btnText}>{copied === 'privacy' ? 'Copied' : 'Copy wording'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={newKey} disabled={busy} testID="website-form-new-key">
            <RefreshCcw size={14} color={theme.colors.primary} />
            <Text style={s.btnText}>Make a new key</Text>
          </TouchableOpacity>
        </>
      )}
      {error ? <Text style={s.error} testID="website-form-error">{error}</Text> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '800', color: theme.colors.text },
  hint: { fontSize: 13, lineHeight: 19, color: theme.colors.textMuted },
  hintSmall: { fontSize: 12.5, lineHeight: 18, color: theme.colors.textMuted },
  label: { fontSize: 12.5, fontWeight: '700', color: theme.colors.text },
  how: { gap: 4, padding: 10, borderRadius: 10, backgroundColor: theme.colors.primaryLight },
  urlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  url: { flex: 1, minWidth: 0, fontSize: 12, color: theme.colors.text, padding: 8, borderRadius: 8, backgroundColor: theme.colors.background },
  iconBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  iconBtnOk: { backgroundColor: theme.colors.success },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status: { fontSize: 14, fontWeight: '800' },
  on: { color: theme.colors.success },
  off: { color: theme.colors.danger },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 38, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.primary },
  btnText: { fontSize: 13, fontWeight: '700', color: theme.colors.primary },
  error: { fontSize: 13, color: theme.colors.danger },
});
