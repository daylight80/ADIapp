import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../src/AuthContext';

/**
 * Sign In — redesigned visual direction from the Claude Design handoff
 * (23 Aug 2026), promoted to live on 24 Aug 2026 after review as
 * sign-in-v2-screen. This is now the real, live sign-in screen.
 *
 * Every real auth behaviour from the original screen was preserved
 * exactly during the trial and carried over here: the invite-token
 * base64 decode + locked name/email fields, the Sign In / Register
 * segmented tabs, password reveal, the same validation ORDER
 * (name -> password >= 6 -> ADI >= 4), the students-cannot-self-register
 * note, forgotten-password link, and the tablet max-width layout.
 *
 * Deliberately NOT carried over: the `demoLogin` helper from the source
 * file — it's defined there but never actually called by any button, so
 * it's dead code rather than a feature worth reproducing.
 *
 * The design replaces the source file's local AUTH_BG (#F3F4F6) /
 * PLACEHOLDER_COLOUR (#6B7280) palette — which was deliberately "lighter
 * and crisper than the in-app screens" — with the warm-paper system used
 * across the rest of this redesign. Worth a look at whether losing that
 * intentional contrast matters to you.
 */

const C = {
  pageBg: '#DCD6CA',
  surface: '#F5F2EC',
  card: '#FFFFFF',
  border: '#E4DED2',
  locked: '#EFEBE2',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  primary: '#00539F',
  tabTrack: '#EAE5DA',
  inviteBg: '#D1FAE5',
  inviteBorder: '#10B981',
  inviteText: '#047857',
  errorBg: '#FEE2E2',
  errorBorder: '#FECACA',
  errorText: '#B91C1C',
};

type Tab = 'signin' | 'signup';

// IMPORTANT: this must live at module scope, not inside the screen
// component. Defining it inline there was the root cause of a real bug —
// every keystroke changes state (email/password/etc), which re-renders
// the parent, which would redefine Field as a brand-new function/component
// reference each time. React then treats the TextInput as an entirely
// different component on every render, unmounting and remounting it —
// which loses focus and closes the keyboard after every single character.
// Moving it out here makes it a stable reference across renders, so React
// just re-renders the same TextInput in place instead.
//
// Re-applied 25 Aug 2026 — this exact fix was made once already, but was
// lost during a messy branch/merge-conflict episode (the fix only ever
// lived in a file that later got resolved as "stays deleted" during a
// conflict, while this actual live file was never touched). Not a case
// of the original fix being wrong — just history divergence eating it.
function Field({
  label, value, onChangeText, placeholder, locked, secure, toggle, helper, keyboardType, autoCapitalize, testID,
  showPassword, onToggleShowPassword,
}: {
  label: string; value: string; onChangeText?: (v: string) => void; placeholder?: string;
  locked?: boolean; secure?: boolean; toggle?: boolean; helper?: string;
  keyboardType?: any; autoCapitalize?: any; testID?: string;
  showPassword?: boolean; onToggleShowPassword?: () => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.fieldWrap, locked && { backgroundColor: C.locked }]}>
        <TextInput
          style={[s.fieldInput, locked && { color: C.textMuted2 }]}
          value={value}
          onChangeText={locked ? undefined : onChangeText}
          editable={!locked}
          placeholder={placeholder}
          placeholderTextColor={C.textMuted}
          secureTextEntry={secure && !showPassword}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          testID={testID}
        />
        {toggle && (
          <TouchableOpacity style={s.revealBtn} onPress={onToggleShowPassword} testID="v2-toggle-password">
            <Text style={s.revealBtnText}>{showPassword ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        )}
        {locked && <Text style={s.lockNote}>Locked</Text>}
      </View>
      {!!helper && <Text style={s.fieldHelper}>{helper}</Text>}
    </View>
  );
}

type InvitePreview = {
  email: string;
  name: string;
  instructor_name: string;
  instructor_adi: string;
  expires_at: string;
};

export default function SignInV2Screen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const inviteToken = (params.invite as string) || '';

  const [tab, setTab] = useState<Tab>(inviteToken ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [adi, setAdi] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const { signIn, signUp, acceptInvite } = useAuth();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  useEffect(() => {
    if (!inviteToken) return;
    setInviteLoading(true);
    try {
      const decoded = JSON.parse(atob(String(inviteToken)));
      if (!decoded?.email) throw new Error('missing email');
      setInvitePreview(decoded);
      setEmail(decoded.email);
      setName(decoded.name || '');
      setTab('signup');
    } catch {
      setError('Invite link invalid or expired');
    } finally {
      setInviteLoading(false);
    }
  }, [inviteToken]);

  const handleSignIn = async () => {
    setError(null);
    setBusy(true);
    const r = await signIn(email.trim(), password);
    setBusy(false);
    if (!r.ok) setError(r.error || 'Login failed');
  };

  const handleSignUp = async () => {
    setError(null);
    if (!name.trim()) { setError('Please enter your full name'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setBusy(true);
    let r;
    if (invitePreview) {
      r = await acceptInvite(inviteToken, password);
    } else {
      if (!adi.trim() || adi.trim().length < 4) {
        setBusy(false);
        setError('Please enter your DVSA ADI number');
        return;
      }
      r = await signUp(email.trim(), password, name.trim(), adi.trim());
    }
    setBusy(false);
    if (!r.ok) setError(r.error || 'Registration failed');
  };

  const isInvite = !!invitePreview;
  const isSignIn = !isInvite && tab === 'signin';
  const isRegister = !isInvite && tab === 'signup';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[s.scroll, isTablet && { maxWidth: 520, alignSelf: 'center', width: '100%' }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.brand}>
            <View style={s.logoRing}>
              <Image
                source={require('../assets/images/adi-pro-logo.png')}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
              />
            </View>
            <Text style={s.brandTitle}>ADI Pro</Text>
            <Text style={s.brandSub}>Instructor &amp; student portal</Text>
          </View>

          {inviteLoading && (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <ActivityIndicator color={C.primary} />
            </View>
          )}

          {isInvite && (
            <View style={s.inviteCard} testID="v2-invite-banner">
              <Text style={s.inviteLabel}>You&apos;ve been invited</Text>
              <Text style={s.inviteLine}>
                {invitePreview?.instructor_name || 'Your instructor'}
                {invitePreview?.instructor_adi ? ` (ADI ${invitePreview.instructor_adi})` : ''} has invited you to join
                ADI Pro as a student. Choose a password to finish setting up your account.
              </Text>
            </View>
          )}

          {!isInvite && (
            <View style={s.tabTrack}>
              <TouchableOpacity
                style={[s.tab, tab === 'signin' && s.tabActive]}
                onPress={() => { setTab('signin'); setError(null); }}
                testID="v2-tab-signin"
              >
                <Text style={[s.tabText, tab === 'signin' && s.tabTextActive]}>Sign in</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.tab, tab === 'signup' && s.tabActive]}
                onPress={() => { setTab('signup'); setError(null); }}
                testID="v2-tab-register"
              >
                <Text style={[s.tabText, tab === 'signup' && s.tabTextActive]}>Register</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ gap: 14 }}>
            {isInvite ? (
              <>
                <Field label="Full name" value={name} locked testID="v2-input-name" />
                <Field label="Email address" value={email} locked testID="v2-input-email" />
                <Field
                  label="Choose a password" value={password} onChangeText={setPassword}
                  placeholder="At least 6 characters" secure toggle testID="v2-input-password"
                  showPassword={showPassword} onToggleShowPassword={() => setShowPassword((v) => !v)}
                />
              </>
            ) : isSignIn ? (
              <>
                <Field
                  label="Email address" value={email} onChangeText={setEmail}
                  placeholder="you@example.co.uk" keyboardType="email-address" autoCapitalize="none"
                  testID="v2-input-email"
                />
                <Field
                  label="Password" value={password} onChangeText={setPassword}
                  placeholder="Your password" secure toggle testID="v2-input-password"
                  showPassword={showPassword} onToggleShowPassword={() => setShowPassword((v) => !v)}
                />
              </>
            ) : (
              <>
                <Field label="Full name" value={name} onChangeText={setName} placeholder="Dave Fletcher" testID="v2-input-name" />
                <Field
                  label="Email address" value={email} onChangeText={setEmail}
                  placeholder="you@example.co.uk" keyboardType="email-address" autoCapitalize="none"
                  testID="v2-input-email"
                />
                <Field
                  label="Password" value={password} onChangeText={setPassword}
                  placeholder="At least 6 characters" secure toggle testID="v2-input-password"
                  showPassword={showPassword} onToggleShowPassword={() => setShowPassword((v) => !v)}
                />
                <Field
                  label="DVSA ADI number" value={adi} onChangeText={setAdi}
                  placeholder="e.g. 123456" keyboardType="number-pad"
                  helper="Your ADI number is the unique reference that secures your account and all your students."
                  testID="v2-input-adi"
                />
              </>
            )}
          </View>

          {!!error && (
            <View style={s.errorCard} testID="v2-auth-error">
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[s.cta, busy && { opacity: 0.6 }]}
            onPress={isSignIn ? handleSignIn : handleSignUp}
            disabled={busy}
            testID="v2-btn-submit"
          >
            {busy
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.ctaText}>{isInvite ? 'Accept invite & create account' : isSignIn ? 'Sign in' : 'Register'}</Text>}
          </TouchableOpacity>

          {isSignIn && (
            <TouchableOpacity
              style={{ alignItems: 'center', paddingTop: 14 }}
              onPress={() => router.push('/forgot-password-screen')}
              testID="v2-link-forgot-password"
            >
              <Text style={s.forgotLink}>Forgotten your password?</Text>
            </TouchableOpacity>
          )}

          {isRegister && (
            <Text style={s.registerNote}>
              Students cannot self-register. Ask your instructor for an invite link.
            </Text>
          )}

          <Text style={s.legal}>
            By continuing you agree to our Terms of Service and Privacy Policy.
          </Text>

          <View style={{ height: 34 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },

  brand: { alignItems: 'center', gap: 9, paddingVertical: 26 },
  logoRing: {
    width: 78, height: 78, borderRadius: 999, backgroundColor: '#fff',
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  brandTitle: { fontFamily: 'Archivo_800ExtraBold', fontSize: 34, letterSpacing: -1, color: C.text },
  brandSub: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, letterSpacing: 1.7, textTransform: 'uppercase', color: C.textMuted, marginTop: 2 },

  inviteCard: { backgroundColor: C.inviteBg, borderWidth: 1, borderColor: C.inviteBorder, borderRadius: 16, padding: 14, marginBottom: 16 },
  inviteLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.inviteText },
  inviteLine: { fontFamily: 'Barlow_400Regular', fontSize: 13.5, lineHeight: 19.5, color: C.text, marginTop: 8 },

  tabTrack: { flexDirection: 'row', padding: 4, backgroundColor: C.tabTrack, borderRadius: 13, marginBottom: 20 },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: '#fff' },
  tabText: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: C.textMuted },
  tabTextActive: { color: C.text },

  fieldLabel: { fontFamily: 'Barlow_700Bold', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.textMuted },
  fieldWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 54,
    paddingLeft: 14, paddingRight: 8, borderWidth: 1, borderColor: C.border,
    borderRadius: 13, backgroundColor: '#fff',
  },
  fieldInput: { flex: 1, minWidth: 0, fontFamily: 'Barlow_500Medium', fontSize: 15, color: C.text },
  revealBtn: {
    minWidth: 56, height: 36, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border, borderRadius: 9, backgroundColor: '#fff',
  },
  revealBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 11.5, color: C.primary },
  lockNote: { fontFamily: 'Barlow_700Bold', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#A69C8B' },
  fieldHelper: { fontFamily: 'Barlow_400Regular', fontSize: 12, lineHeight: 16.8, color: C.textMuted2, marginTop: 1 },

  errorCard: { marginTop: 14, backgroundColor: C.errorBg, borderWidth: 1, borderColor: C.errorBorder, borderRadius: 12, padding: 11 },
  errorText: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, lineHeight: 18.2, color: C.errorText },

  cta: {
    minHeight: 56, marginTop: 22, borderRadius: 14, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.45, shadowRadius: 22, elevation: 6,
  },
  ctaText: { fontFamily: 'Barlow_700Bold', fontSize: 16.5, color: '#fff' },

  forgotLink: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: C.primary },
  registerNote: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 18, color: C.textMuted2, textAlign: 'center', fontStyle: 'italic', marginTop: 16 },
  legal: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 18.75, color: C.textMuted2, textAlign: 'center', marginTop: 24 },
});
