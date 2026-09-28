import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Lock, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react-native';
import { useAuth } from '../src/AuthContext';
import { supabase } from '../src/supabaseClient';

/**
 * Restyled (28 Sept 2026) to match the sign-in and forgot-password screens,
 * which this is the last step of (forgot -> emailed link -> here). It used the
 * older shared `theme` (cool grey). Palette, fonts, field, button and message
 * styles are the sign-in screen's own. No behaviour changed: the recovery
 * token detection, 5 s timeout, validation, redirects and test IDs are as before.
 */
const C = {
  surface: '#F5F2EC',
  border: '#E4DED2',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  primary: '#00539F',
  successBg: '#D1FAE5',
  successBorder: '#10B981',
  successText: '#047857',
  errorBg: '#FEE2E2',
  errorBorder: '#FECACA',
  errorText: '#B91C1C',
};

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { updatePassword } = useAuth();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  // Stage tracks whether Supabase has accepted the recovery token.
  // 'detecting' — waiting for supabase-js to consume the URL hash
  // 'ready'     — recovery session active, show the new-password form
  // 'invalid'   — no session detected, show an error / "request a new link"
  // 'success'   — password updated, redirect to sign-in
  const [stage, setStage] = useState<'detecting' | 'ready' | 'invalid' | 'success'>('detecting');

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Supabase-JS auto-parses the URL hash (#access_token=...&type=recovery)
  // on init when detectSessionInUrl is enabled (the default). We just listen
  // for the PASSWORD_RECOVERY event or check if a session is already active.
  useEffect(() => {
    let cancelled = false;
    let timer: any = null;

    const detect = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) setStage('ready');
    };

    // First-pass check (the hash may have already been consumed).
    detect();

    // Listen for the recovery event in case it arrives slightly later.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setStage('ready');
      }
    });

    // After 5 seconds with no session, give up and show the "invalid link" UI.
    timer = setTimeout(async () => {
      if (cancelled) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) setStage('invalid');
    }, 5000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const strongEnough = pw1.length >= 8;
  const matches = pw1.length > 0 && pw1 === pw2;
  const canSubmit = strongEnough && matches && !busy;

  const handleSave = async () => {
    setError(null);
    if (!strongEnough) {
      setError('Use at least 8 characters.');
      return;
    }
    if (!matches) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const r = await updatePassword(pw1);
    setBusy(false);
    if (!r.ok) {
      setError(r.error || 'Could not update password.');
      return;
    }
    // Sign out the recovery session so the user has to sign in fresh with
    // the new password (matches Supabase recommended UX).
    await supabase.auth.signOut();
    setStage('success');
    setTimeout(() => router.replace('/sign-up-login-screen'), 1800);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[s.scroll, isTablet && { maxWidth: 520, alignSelf: 'center', width: '100%' }]}
          keyboardShouldPersistTaps="handled"
        >
          {stage === 'detecting' && (
            <View style={{ alignItems: 'center', paddingVertical: 80 }}>
              <ActivityIndicator size="large" color={C.primary} />
              <Text style={[s.body, { marginTop: 16 }]}>Verifying your reset link…</Text>
            </View>
          )}

          {stage === 'ready' && (
            <>
              <View style={s.heroIcon}>
                <ShieldCheck size={30} color={C.primary} />
              </View>
              <Text style={s.heading}>Choose a new password</Text>
              <Text style={s.body}>
                Pick something memorable but hard to guess. Minimum 8 characters.
              </Text>

              <View style={{ gap: 6, marginTop: 26 }}>
                <Text style={s.fieldLabel}>New password</Text>
                <View style={s.fieldWrap}>
                  <Lock size={18} color={C.textMuted} />
                  <TextInput
                    style={s.fieldInput}
                    placeholder="New password"
                    placeholderTextColor={C.textMuted}
                    secureTextEntry
                    autoComplete="password-new"
                    value={pw1}
                    onChangeText={setPw1}
                    testID="input-new-password"
                  />
                </View>
              </View>

              <View style={{ gap: 6, marginTop: 14 }}>
                <Text style={s.fieldLabel}>Confirm new password</Text>
                <View style={s.fieldWrap}>
                  <Lock size={18} color={C.textMuted} />
                  <TextInput
                    style={s.fieldInput}
                    placeholder="Confirm new password"
                    placeholderTextColor={C.textMuted}
                    secureTextEntry
                    autoComplete="password-new"
                    value={pw2}
                    onChangeText={setPw2}
                    testID="input-confirm-password"
                  />
                </View>
              </View>

              <View style={s.hintRow}>
                <Text style={[s.hint, strongEnough ? s.hintOk : null]}>
                  {strongEnough ? '✓' : '○'} At least 8 characters
                </Text>
                <Text style={[s.hint, pw2.length > 0 && matches ? s.hintOk : null]}>
                  {pw2.length > 0 && matches ? '✓' : '○'} Passwords match
                </Text>
              </View>

              {!!error && (
                <View style={s.errorCard}>
                  <Text style={s.errorText} testID="reset-error">{error}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[s.cta, !canSubmit && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={!canSubmit}
                testID="btn-save-password"
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.ctaText}>Update password</Text>}
              </TouchableOpacity>
            </>
          )}

          {stage === 'invalid' && (
            <>
              <View style={s.errorIcon}>
                <AlertTriangle size={34} color={C.errorText} />
              </View>
              <Text style={s.heading}>Link expired or invalid</Text>
              <Text style={s.body}>
                The reset link may have already been used, or it's older than an hour. Request a fresh one to continue.
              </Text>
              <TouchableOpacity
                style={s.cta}
                onPress={() => router.replace('/forgot-password-screen')}
                testID="btn-request-new"
              >
                <Text style={s.ctaText}>Request a new link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.linkBtn}
                onPress={() => router.replace('/sign-up-login-screen')}
                testID="link-signin"
              >
                <Text style={s.linkText}>Back to sign in</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'success' && (
            <>
              <View style={s.successIcon}>
                <CheckCircle2 size={38} color={C.successText} />
              </View>
              <Text style={s.heading}>Password updated</Text>
              <Text style={s.body}>
                You'll be redirected to sign in with your new password in a moment.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 48 },

  heroIcon: {
    alignSelf: 'center', width: 78, height: 78, borderRadius: 999, backgroundColor: '#fff',
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  successIcon: {
    alignSelf: 'center', width: 78, height: 78, borderRadius: 999, backgroundColor: C.successBg,
    borderWidth: 1, borderColor: C.successBorder, alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  errorIcon: {
    alignSelf: 'center', width: 78, height: 78, borderRadius: 999, backgroundColor: C.errorBg,
    borderWidth: 1, borderColor: C.errorBorder, alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  heading: { fontFamily: 'Archivo_800ExtraBold', fontSize: 26, letterSpacing: -0.6, color: C.text, textAlign: 'center', marginBottom: 10 },
  body: { fontFamily: 'Barlow_400Regular', fontSize: 15, lineHeight: 22, color: C.textMuted2, textAlign: 'center' },

  fieldLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.textMuted },
  fieldWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54,
    paddingHorizontal: 14, borderWidth: 1, borderColor: C.border,
    borderRadius: 13, backgroundColor: '#fff',
  },
  fieldInput: { flex: 1, minWidth: 0, fontFamily: 'Barlow_500Medium', fontSize: 15, color: C.text },

  hintRow: { marginTop: 16, gap: 6 },
  hint: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.textMuted2 },
  hintOk: { fontFamily: 'Barlow_700Bold', color: C.successText },

  errorCard: { marginTop: 14, backgroundColor: C.errorBg, borderWidth: 1, borderColor: C.errorBorder, borderRadius: 12, padding: 11 },
  errorText: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, lineHeight: 18.2, color: C.errorText },

  cta: {
    minHeight: 56, marginTop: 22, borderRadius: 14, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.45, shadowRadius: 22, elevation: 6,
  },
  ctaText: { fontFamily: 'Barlow_700Bold', fontSize: 16.5, color: '#fff' },

  linkBtn: { alignItems: 'center', paddingTop: 16, paddingBottom: 4 },
  linkText: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.primary },
});
