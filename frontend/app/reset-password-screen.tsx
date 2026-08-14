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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Lock, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { supabase } from '../src/supabaseClient';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { updatePassword } = useAuth();

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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {stage === 'detecting' && (
            <View style={{ alignItems: 'center', paddingVertical: 80 }}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={[styles.body, { marginTop: 16 }]}>Verifying your reset link…</Text>
            </View>
          )}

          {stage === 'ready' && (
            <>
              <View style={styles.heroIcon}>
                <ShieldCheck size={32} color={theme.colors.primary} />
              </View>
              <Text style={styles.heading}>Choose a new password</Text>
              <Text style={styles.body}>
                Pick something memorable but hard to guess. Minimum 8 characters.
              </Text>

              <View style={styles.field}>
                <Lock size={18} color={theme.colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="New password"
                  placeholderTextColor={theme.colors.textMuted}
                  secureTextEntry
                  autoComplete="password-new"
                  value={pw1}
                  onChangeText={setPw1}
                  testID="input-new-password"
                />
              </View>

              <View style={styles.field}>
                <Lock size={18} color={theme.colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm new password"
                  placeholderTextColor={theme.colors.textMuted}
                  secureTextEntry
                  autoComplete="password-new"
                  value={pw2}
                  onChangeText={setPw2}
                  testID="input-confirm-password"
                />
              </View>

              <View style={styles.hintRow}>
                <Text style={[styles.hint, strongEnough ? styles.hintOk : null]}>
                  {strongEnough ? '✓' : '○'} At least 8 characters
                </Text>
                <Text style={[styles.hint, pw2.length > 0 && matches ? styles.hintOk : null]}>
                  {pw2.length > 0 && matches ? '✓' : '○'} Passwords match
                </Text>
              </View>

              {error && <Text style={styles.error} testID="reset-error">{error}</Text>}

              <TouchableOpacity
                style={[styles.primaryBtn, !canSubmit && styles.btnDisabled]}
                onPress={handleSave}
                disabled={!canSubmit}
                testID="btn-save-password"
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.primaryBtnText}>Update password</Text>}
              </TouchableOpacity>
            </>
          )}

          {stage === 'invalid' && (
            <>
              <View style={styles.errorIcon}>
                <AlertTriangle size={36} color={theme.colors.danger} />
              </View>
              <Text style={styles.heading}>Link expired or invalid</Text>
              <Text style={styles.body}>
                The reset link may have already been used, or it's older than an hour. Request a fresh one to continue.
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => router.replace('/forgot-password-screen')}
                testID="btn-request-new"
              >
                <Text style={styles.primaryBtnText}>Request a new link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => router.replace('/sign-up-login-screen')}
                testID="link-signin"
              >
                <Text style={styles.linkText}>Back to sign in</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'success' && (
            <>
              <View style={styles.successIcon}>
                <CheckCircle2 size={40} color={theme.colors.success} />
              </View>
              <Text style={styles.heading}>Password updated</Text>
              <Text style={styles.body}>
                You'll be redirected to sign in with your new password in a moment.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: 24, paddingBottom: 48, paddingTop: 32 },
  heroIcon: { alignSelf: 'center', width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  successIcon: { alignSelf: 'center', width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.successLight, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  errorIcon: { alignSelf: 'center', width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.dangerLight, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  heading: { fontSize: 22, fontWeight: '700', color: theme.colors.text, textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, color: theme.colors.textMuted, textAlign: 'center' },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, height: 52, marginTop: 14, gap: 10, backgroundColor: theme.colors.surface },
  input: { flex: 1, fontSize: 16, color: theme.colors.text },
  hintRow: { marginTop: 14, gap: 6 },
  hint: { fontSize: 12, color: theme.colors.textMuted },
  hintOk: { color: theme.colors.success, fontWeight: '600' },
  error: { color: theme.colors.danger, fontSize: 13, marginTop: 10, textAlign: 'center' },
  primaryBtn: { backgroundColor: theme.colors.primary, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  linkBtn: { alignItems: 'center', padding: 14, marginTop: 4 },
  linkText: { color: theme.colors.primary, fontWeight: '600', fontSize: 14 },
});
