import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Mail, Lock, User as UserIcon, IdCard, MailCheck, Briefcase, GraduationCap, Eye, EyeOff } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { api } from '../src/api';

type Tab = 'signin' | 'signup';

/**
 * Premium auth-screen colour tokens. We hold these locally (rather than in
 * the global theme) because the task spec asks for a specific palette here
 * that's intentionally a touch lighter and crisper than the in-app screens:
 *   • #F3F4F6 — neutral light-grey backdrop
 *   • #FFFFFF — pure white card surfaces
 *   • #6B7280 — accessible placeholder-text colour (WCAG AA on white)
 *
 * British English note: variable named `PLACEHOLDER_COLOUR` deliberately.
 */
const AUTH_BG = '#F3F4F6';
const PLACEHOLDER_COLOUR = '#6B7280';

type InvitePreview = {
  email: string;
  name: string;
  instructor_name: string;
  instructor_adi: string;
  expires_at: string;
};

export default function SignUpLoginScreen() {
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
  // Whether the password field is currently revealed. Toggled by the eye icon.
  const [showPassword, setShowPassword] = useState(false);

  // Invite state
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const { signIn, signUp, acceptInvite } = useAuth();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  // Fetch invite preview if invite token provided.
  // The token is a base64-encoded JSON payload: { email, name, instructor_name, instructor_adi, school_id }.
  // (FastAPI invite endpoint is being decommissioned in favour of Supabase Auth.)
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
    if (!name.trim()) {
      setError('Please enter your full name');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setBusy(true);
    let r;
    if (invitePreview) {
      // Student accepts an invite
      r = await acceptInvite(inviteToken, password);
    } else {
      // Instructor self-registers
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

  const demoLogin = async (which: 'instructor' | 'student') => {
    setError(null);
    setBusy(true);
    const creds =
      which === 'instructor'
        ? { email: 'instructor@demo.uk', password: 'password123', name: 'Demo Instructor', adi: '123456' }
        : { email: 'student@demo.uk', password: 'password123', name: 'Demo Student', adi: '' };
    setEmail(creds.email);
    setPassword(creds.password);

    // 1) try sign-in
    let r = await signIn(creds.email, creds.password);

    // 2) if email confirmation is still on, surface the clear instruction
    if (!r.ok && /email\s*not\s*confirmed|confirm/i.test(r.error || '')) {
      setError('Email confirmation is enabled in Supabase. Disable it under Authentication → Providers → Email, then try again. (If you can\u2019t disable it, manually confirm `' + creds.email + '` in the Supabase Authentication → Users panel.)');
      setBusy(false);
      return;
    }

    // 3) if account does not exist, auto-create then retry
    if (!r.ok && /invalid|credentials|user|not.*found/i.test(r.error || '')) {
      const up = await signUp(creds.email, creds.password, creds.name, creds.adi || '000000');
      if (up.needs_confirmation) {
        setError('Email confirmation is enabled in Supabase. Disable it under Authentication → Providers → Email, then try again.');
        setBusy(false);
        return;
      }
      if (up.ok) r = await signIn(creds.email, creds.password);
      else r = up;
    }
    setBusy(false);
    if (!r.ok) setError(r.error || 'Demo login failed');
  };

  const isInvite = !!invitePreview;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scroll, isTablet && styles.scrollTablet]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.card, isTablet && styles.cardTablet]} testID="auth-card">
            <View style={styles.brand}>
              <Image
                source={require('../assets/images/adi-pro-logo.png')}
                style={styles.brandLogo}
                resizeMode="contain"
              />
              <Text style={styles.brandTitle}>ADI Pro</Text>
              <Text style={styles.brandSub}>Instructor & Student Portal</Text>
            </View>

            {isInvite && (
              <View style={styles.inviteBanner} testID="invite-banner">
                <MailCheck size={20} color={theme.colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.inviteTitle}>You&apos;ve been invited!</Text>
                  <Text style={styles.inviteSub}>
                    {invitePreview!.instructor_name} (ADI {invitePreview!.instructor_adi}) has invited you to join ADI Pro as a student.
                  </Text>
                </View>
              </View>
            )}

            {!isInvite && (
              <View style={styles.formPanel}>
                <View style={styles.tabs}>
                  <TouchableOpacity
                    style={[styles.tab, tab === 'signin' && styles.tabActive]}
                    onPress={() => setTab('signin')}
                    testID="tab-signin"
                  >
                    <Text style={[styles.tabText, tab === 'signin' && styles.tabTextActive]}>Sign In</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.tab, tab === 'signup' && styles.tabActive]}
                    onPress={() => setTab('signup')}
                    testID="tab-signup"
                  >
                    {/* Shortened from "Create Instructor Account" to "Register"
                        so the label fits a single line at narrow phone widths. */}
                    <Text style={[styles.tabText, tab === 'signup' && styles.tabTextActive]}>Register</Text>
                  </TouchableOpacity>
                </View>

                {tab === 'signup' && (
                  <View style={styles.field}>
                    <UserIcon size={18} color={PLACEHOLDER_COLOUR} />
                    <TextInput
                      style={styles.input}
                      placeholder="Full name"
                      placeholderTextColor={PLACEHOLDER_COLOUR}
                      value={name}
                      onChangeText={setName}
                      editable={!isInvite}
                      testID="input-name"
                    />
                  </View>
                )}

                <View style={styles.field}>
                  <Mail size={18} color={PLACEHOLDER_COLOUR} />
                  <TextInput
                    style={styles.input}
                    placeholder="Email address"
                    placeholderTextColor={PLACEHOLDER_COLOUR}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                    editable={!isInvite || tab === 'signin'}
                    testID="input-email"
                  />
                </View>

                <View style={[styles.field, styles.fieldTight]}>
                  <Lock size={18} color={PLACEHOLDER_COLOUR} />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor={PLACEHOLDER_COLOUR}
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    testID="input-password"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    testID="btn-toggle-password"
                  >
                    {showPassword
                      ? <EyeOff size={18} color={PLACEHOLDER_COLOUR} />
                      : <Eye   size={18} color={PLACEHOLDER_COLOUR} />}
                  </TouchableOpacity>
                </View>

                {tab === 'signup' && !isInvite && (
                  <>
                    <View style={styles.field}>
                      <IdCard size={18} color={PLACEHOLDER_COLOUR} />
                      <TextInput
                        style={styles.input}
                        placeholder="DVSA ADI number (e.g. 123456)"
                        placeholderTextColor={PLACEHOLDER_COLOUR}
                        keyboardType="numeric"
                        value={adi}
                        onChangeText={setAdi}
                        testID="input-adi"
                      />
                    </View>
                    <Text style={styles.helper}>
                      Your ADI number is the unique reference that secures your account and all your students.
                    </Text>
                  </>
                )}

                {error && (
                  <Text style={styles.error} testID="auth-error">{error}</Text>
                )}

                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                  onPress={tab === 'signin' ? handleSignIn : handleSignUp}
                  disabled={busy || inviteLoading}
                  testID={tab === 'signin' ? 'btn-signin' : 'btn-signup'}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>
                      {tab === 'signin' ? 'Sign In' : 'Register'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* ------------------------------------------------------------
                Invite flow — unchanged layout, just uses the new colours.
                ------------------------------------------------------------ */}
            {isInvite && (
              <>
                <View style={styles.field}>
                  <UserIcon size={18} color={PLACEHOLDER_COLOUR} />
                  <TextInput
                    style={styles.input}
                    placeholder="Full name"
                    placeholderTextColor={PLACEHOLDER_COLOUR}
                    value={name}
                    onChangeText={setName}
                    editable={!isInvite}
                    testID="input-name"
                  />
                </View>

                <View style={styles.field}>
                  <Mail size={18} color={PLACEHOLDER_COLOUR} />
                  <TextInput
                    style={styles.input}
                    placeholder="Email address"
                    placeholderTextColor={PLACEHOLDER_COLOUR}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                    editable={false}
                    testID="input-email"
                  />
                </View>

                <View style={[styles.field, styles.fieldTight]}>
                  <Lock size={18} color={PLACEHOLDER_COLOUR} />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor={PLACEHOLDER_COLOUR}
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    testID="input-password"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    testID="btn-toggle-password"
                  >
                    {showPassword
                      ? <EyeOff size={18} color={PLACEHOLDER_COLOUR} />
                      : <Eye   size={18} color={PLACEHOLDER_COLOUR} />}
                  </TouchableOpacity>
                </View>

                {error && (
                  <Text style={styles.error} testID="auth-error">{error}</Text>
                )}

                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                  onPress={handleSignUp}
                  disabled={busy || inviteLoading}
                  testID="btn-signup"
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Accept invite &amp; create account</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {tab === 'signin' && !isInvite && (
              <TouchableOpacity
                style={styles.forgotLink}
                onPress={() => router.push('/forgot-password-screen')}
                testID="link-forgot-password"
              >
                <Text style={styles.forgotLinkText}>Forgotten your password?</Text>
              </TouchableOpacity>
            )}

            {!isInvite && tab === 'signup' && (
              <Text style={styles.studentNote}>
                Students cannot self-register. Ask your instructor for an invite link.
              </Text>
            )}

            <View style={styles.legal}>
              <Text style={styles.legalText}>
                By continuing you agree to our{' '}
                <Text style={styles.legalLink} testID="link-tos">Terms of Service</Text>
                {' '}and{' '}
                <Text style={styles.legalLink} testID="link-privacy">Privacy Policy</Text>.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ----- Backdrop --------------------------------------------------------
  safe: { flex: 1, backgroundColor: AUTH_BG },
  scroll: { padding: 24, flexGrow: 1, justifyContent: 'center' },
  scrollTablet: { alignItems: 'center', padding: 32 },

  // ----- Outer card (logo + brand + form panel) --------------------------
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 24,
    // Soft, diffused drop shadow for elevation. iOS uses shadow*; Android
    // honours `elevation`; web honours boxShadow (set by Expo runtime).
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cardTablet: { width: 480, maxWidth: '100%' },

  brand: { alignItems: 'center', marginBottom: 24 },
  brandLogo: { width: 96, height: 96, marginBottom: 8 },
  brandTitle: { ...theme.font.h1 },
  // Softer grey so the main "ADI Pro" header dominates the visual hierarchy.
  brandSub: { ...theme.font.caption, marginTop: 4, color: '#9CA3AF' },

  // ----- Inner form panel ------------------------------------------------
  // Holds tabs, fields, and the primary button. Visually identical to the
  // outer card here (white surface) but kept as a structural wrapper so we
  // can later swap in a subtle inner-shadow / border without touching the
  // outer layout.
  formPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
  },

  // ----- Segmented control ----------------------------------------------
  tabs: {
    flexDirection: 'row',
    backgroundColor: AUTH_BG,
    borderRadius: 8,
    padding: 4,
    marginBottom: 24,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  // Crisp white background + subtle shadow on the active tab.
  tabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  tabText: { ...theme.font.body, color: PLACEHOLDER_COLOUR, fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: theme.colors.text },

  // ----- Invite banner --------------------------------------------------
  inviteBanner: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 12, backgroundColor: '#D1FAE5', borderWidth: 1, borderColor: theme.colors.success, marginBottom: 16 },
  inviteTitle: { fontWeight: '700', color: theme.colors.success, fontSize: 15 },
  inviteSub: { color: theme.colors.text, fontSize: 13, marginTop: 4 },

  // ----- Inputs ---------------------------------------------------------
  // 8pt grid: 56 px tall pills, 16 px gap between fields. The password field
  // uses `fieldTight` (8 px gap above the primary button) so email + password
  // sit close together while the CTA has clear breathing room above it.
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 16,
  },
  fieldTight: { marginBottom: 8 },
  input: { flex: 1, fontSize: 15, color: theme.colors.text, paddingVertical: 0 },
  helper: { fontSize: 12, color: PLACEHOLDER_COLOUR, marginBottom: 16, marginTop: -8 },
  error: { color: theme.colors.danger, marginBottom: 8, fontSize: 14 },

  // ----- Primary CTA ----------------------------------------------------
  // 24 px breathing room above to separate it from the input cluster.
  primaryBtn: {
    height: 56,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 24,
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { ...theme.font.button },

  // ----- Misc -----------------------------------------------------------
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { ...theme.font.caption },
  demoPanel: { gap: 10 },
  demoBtn: { height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  demoBtnInstructor: { backgroundColor: theme.colors.accent },
  demoBtnStudent: { backgroundColor: theme.colors.primary },
  demoBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  studentNote: { textAlign: 'center', color: PLACEHOLDER_COLOUR, fontSize: 12, marginTop: 16, fontStyle: 'italic' },
  forgotLink: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16, marginTop: 8 },
  forgotLinkText: { color: theme.colors.primary, fontSize: 14, fontWeight: '600' },
  legal: { marginTop: 24 },
  legalText: { ...theme.font.caption, textAlign: 'center', color: PLACEHOLDER_COLOUR },
  legalLink: { color: theme.colors.primary, fontWeight: '600' },
});
