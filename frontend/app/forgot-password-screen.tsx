import React, { useState } from 'react';
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
import { ArrowLeft, Mail, CheckCircle2, KeyRound } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = async () => {
    setError(null);
    if (!validEmail) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    const r = await forgotPassword(email);
    setBusy(false);
    if (!r.ok) {
      setError(r.error || 'Could not send reset email.');
      return;
    }
    setSent(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
            <ArrowLeft size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Reset password</Text>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.heroIcon}>
            <KeyRound size={32} color={theme.colors.primary} />
          </View>

          {!sent ? (
            <>
              <Text style={styles.heading}>Forgotten your password?</Text>
              <Text style={styles.body}>
                No worries — pop in the email address you signed up with and we'll send you a secure link to set a new one.
              </Text>

              <View style={styles.field}>
                <Mail size={18} color={theme.colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="you@example.co.uk"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  value={email}
                  onChangeText={setEmail}
                  testID="input-email"
                />
              </View>

              {error && <Text style={styles.error} testID="reset-error">{error}</Text>}

              <TouchableOpacity
                style={[styles.primaryBtn, (busy || !validEmail) && styles.btnDisabled]}
                onPress={handleSubmit}
                disabled={busy || !validEmail}
                testID="btn-send-reset"
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.primaryBtnText}>Send reset link</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => router.back()} style={styles.linkBtn} testID="link-back-to-signin">
                <Text style={styles.linkText}>Back to sign in</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.successIcon}>
                <CheckCircle2 size={40} color={theme.colors.success} />
              </View>
              <Text style={styles.heading}>Check your inbox</Text>
              <Text style={styles.body}>
                We've sent a reset link to <Text style={{ fontWeight: '700', color: theme.colors.text }}>{email.trim()}</Text>.
                Open it on this device to choose a new password. The link will expire in 1 hour.
              </Text>
              <Text style={[styles.body, { marginTop: 12 }]}>
                Can't find it? Have a peek in your spam folder, or double-check the address.
              </Text>

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => router.replace('/sign-up-login-screen')}
                testID="btn-done"
              >
                <Text style={styles.primaryBtnText}>Back to sign in</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => { setSent(false); setError(null); }}
                testID="link-resend"
              >
                <Text style={styles.linkText}>Send to a different email</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  scroll: { padding: 24, paddingBottom: 48 },
  heroIcon: { alignSelf: 'center', width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 24, marginTop: 12 },
  successIcon: { alignSelf: 'center', width: 76, height: 76, borderRadius: 38, backgroundColor: '#D1FAE5', alignItems: 'center', justifyContent: 'center', marginBottom: 24, marginTop: 4 },
  heading: { fontSize: 22, fontWeight: '700', color: theme.colors.text, textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, color: theme.colors.textMuted, textAlign: 'center' },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, height: 52, marginTop: 24, gap: 10, backgroundColor: theme.colors.surface },
  input: { flex: 1, fontSize: 16, color: theme.colors.text },
  error: { color: theme.colors.danger, fontSize: 13, marginTop: 10, textAlign: 'center' },
  primaryBtn: { backgroundColor: theme.colors.primary, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  linkBtn: { alignItems: 'center', padding: 14, marginTop: 4 },
  linkText: { color: theme.colors.primary, fontWeight: '600', fontSize: 14 },
});
