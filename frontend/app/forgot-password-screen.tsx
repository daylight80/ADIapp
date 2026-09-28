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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Mail, CheckCircle2, KeyRound } from 'lucide-react-native';
import { useAuth } from '../src/AuthContext';

/**
 * Restyled (28 Sept 2026) to match the sign-in screen it's reached from.
 * This screen previously used the older shared `theme` (cool grey/white),
 * which looked like a different app next to sign-in's warm-paper design —
 * so the palette, fonts, field, button and error styles below are the
 * sign-in screen's own, copied rather than imported because every screen in
 * this redesign keeps its own local palette. No behaviour changed: same
 * validation, same forgotPassword() call, same test IDs.
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

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { forgotPassword } = useAuth();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
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
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={[s.header, isTablet && { maxWidth: 520, alignSelf: 'center', width: '100%' }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="btn-back">
            <ArrowLeft size={20} color={C.text} />
          </TouchableOpacity>
          <Text style={s.title}>Reset password</Text>
          <View style={s.backBtn} />
        </View>

        <ScrollView
          contentContainerStyle={[s.scroll, isTablet && { maxWidth: 520, alignSelf: 'center', width: '100%' }]}
          keyboardShouldPersistTaps="handled"
        >
          {!sent ? (
            <>
              <View style={s.heroIcon}>
                <KeyRound size={30} color={C.primary} />
              </View>
              <Text style={s.heading}>Forgotten your password?</Text>
              <Text style={s.body}>
                No worries — pop in the email address you signed up with and we'll send you a secure link to set a new one.
              </Text>

              <View style={{ gap: 6, marginTop: 26 }}>
                <Text style={s.fieldLabel}>Email address</Text>
                <View style={s.fieldWrap}>
                  <Mail size={18} color={C.textMuted} />
                  <TextInput
                    style={s.fieldInput}
                    placeholder="you@example.co.uk"
                    placeholderTextColor={C.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    value={email}
                    onChangeText={setEmail}
                    testID="input-email"
                  />
                </View>
              </View>

              {!!error && (
                <View style={s.errorCard}>
                  <Text style={s.errorText} testID="reset-error">{error}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[s.cta, (busy || !validEmail) && { opacity: 0.5 }]}
                onPress={handleSubmit}
                disabled={busy || !validEmail}
                testID="btn-send-reset"
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.ctaText}>Send reset link</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => router.back()} style={s.linkBtn} testID="link-back-to-signin">
                <Text style={s.linkText}>Back to sign in</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.successIcon}>
                <CheckCircle2 size={38} color={C.successText} />
              </View>
              <Text style={s.heading}>Check your inbox</Text>
              <Text style={s.body}>
                We've sent a reset link to <Text style={{ fontFamily: 'Barlow_700Bold', color: C.text }}>{email.trim()}</Text>.
                Open it on this device to choose a new password. The link will expire in 1 hour.
              </Text>
              <Text style={[s.body, { marginTop: 12 }]}>
                Can't find it? Have a peek in your spam folder, or double-check the address.
              </Text>

              <TouchableOpacity
                style={s.cta}
                onPress={() => router.replace('/sign-up-login-screen')}
                testID="btn-done"
              >
                <Text style={s.ctaText}>Back to sign in</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.linkBtn}
                onPress={() => { setSent(false); setError(null); }}
                testID="link-resend"
              >
                <Text style={s.linkText}>Send to a different email</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: 'Barlow_700Bold', fontSize: 16, color: C.text },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },

  heroIcon: {
    alignSelf: 'center', width: 78, height: 78, borderRadius: 999, backgroundColor: '#fff',
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
    marginTop: 14, marginBottom: 22,
  },
  successIcon: {
    alignSelf: 'center', width: 78, height: 78, borderRadius: 999, backgroundColor: C.successBg,
    borderWidth: 1, borderColor: C.successBorder, alignItems: 'center', justifyContent: 'center',
    marginTop: 14, marginBottom: 22,
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
