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
import { useLocalSearchParams } from 'expo-router';
import { Mail, Lock, User as UserIcon, IdCard, MailCheck, Briefcase, GraduationCap } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { api } from '../src/api';

type Tab = 'signin' | 'signup';

type InvitePreview = {
  email: string;
  name: string;
  instructor_name: string;
  instructor_adi: string;
  expires_at: string;
};

export default function SignUpLoginScreen() {
  const params = useLocalSearchParams();
  const inviteToken = (params.invite as string) || '';

  const [tab, setTab] = useState<Tab>(inviteToken ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [adi, setAdi] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                  <Text style={styles.inviteTitle}>You've been invited!</Text>
                  <Text style={styles.inviteSub}>
                    {invitePreview!.instructor_name} (ADI {invitePreview!.instructor_adi}) has invited you to join ADI Pro as a student.
                  </Text>
                </View>
              </View>
            )}

            {!isInvite && (
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
                  <Text style={[styles.tabText, tab === 'signup' && styles.tabTextActive]}>Create Instructor Account</Text>
                </TouchableOpacity>
              </View>
            )}

            {tab === 'signup' && (
              <View style={styles.field}>
                <UserIcon size={18} color={theme.colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Full name"
                  placeholderTextColor={theme.colors.textMuted}
                  value={name}
                  onChangeText={setName}
                  editable={!isInvite}
                  testID="input-name"
                />
              </View>
            )}

            <View style={styles.field}>
              <Mail size={18} color={theme.colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                editable={!isInvite || tab === 'signin'}
                testID="input-email"
              />
            </View>

            <View style={styles.field}>
              <Lock size={18} color={theme.colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={theme.colors.textMuted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                testID="input-password"
              />
            </View>

            {tab === 'signup' && !isInvite && (
              <>
                <View style={styles.field}>
                  <IdCard size={18} color={theme.colors.textMuted} />
                  <TextInput
                    style={styles.input}
                    placeholder="DVSA ADI number (e.g. 123456)"
                    placeholderTextColor={theme.colors.textMuted}
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
                  {tab === 'signin' ? 'Sign In' : isInvite ? 'Accept invite & create account' : 'Create Instructor Account'}
                </Text>
              )}
            </TouchableOpacity>

            {!isInvite && (
              <>
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Try the demo</Text>
                  <View style={styles.dividerLine} />
                </View>

                <View style={styles.demoPanel} testID="demo-panel">
                  <TouchableOpacity
                    style={[styles.demoBtn, styles.demoBtnInstructor]}
                    onPress={() => demoLogin('instructor')}
                    disabled={busy}
                    testID="demo-instructor"
                  >
                    <Briefcase size={16} color="#fff" />
                    <Text style={styles.demoBtnText}>Demo Instructor</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.demoBtn, styles.demoBtnStudent]}
                    onPress={() => demoLogin('student')}
                    disabled={busy}
                    testID="demo-student"
                  >
                    <GraduationCap size={16} color="#fff" />
                    <Text style={styles.demoBtnText}>Demo Student</Text>
                  </TouchableOpacity>
                </View>

                {tab === 'signup' && (
                  <Text style={styles.studentNote}>
                    Students cannot self-register. Ask your instructor for an invite link.
                  </Text>
                )}
              </>
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
  safe: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: 16, flexGrow: 1, justifyContent: 'center' },
  scrollTablet: { alignItems: 'center', padding: 32 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 24, borderWidth: 1, borderColor: theme.colors.border },
  cardTablet: { width: 480, maxWidth: '100%' },
  brand: { alignItems: 'center', marginBottom: 24 },
  brandIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  brandLogo: { width: 96, height: 96, marginBottom: 12 },
  brandTitle: { ...theme.font.h1 },
  brandSub: { ...theme.font.caption, marginTop: 4 },
  tabs: { flexDirection: 'row', backgroundColor: theme.colors.background, borderRadius: theme.radius.md, padding: 4, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: theme.colors.surface, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  tabText: { ...theme.font.body, color: theme.colors.textMuted, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: theme.colors.primary },
  inviteBanner: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 12, backgroundColor: '#D1FAE5', borderWidth: 1, borderColor: theme.colors.success, marginBottom: 16 },
  inviteTitle: { fontWeight: '700', color: theme.colors.success, fontSize: 15 },
  inviteSub: { color: theme.colors.text, fontSize: 13, marginTop: 4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background, borderRadius: theme.radius.md, paddingHorizontal: 14, height: 52, marginBottom: 12 },
  input: { flex: 1, ...theme.font.body, paddingVertical: 0 },
  helper: { fontSize: 12, color: theme.colors.textMuted, marginBottom: 12, marginTop: -4 },
  error: { color: theme.colors.danger, marginBottom: 8, fontSize: 14 },
  primaryBtn: { height: 52, borderRadius: theme.radius.md, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { ...theme.font.button },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { ...theme.font.caption },
  demoPanel: { gap: 10 },
  demoBtn: { height: 48, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  demoBtnInstructor: { backgroundColor: theme.colors.accent },
  demoBtnStudent: { backgroundColor: theme.colors.primary },
  demoBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  studentNote: { textAlign: 'center', color: theme.colors.textMuted, fontSize: 12, marginTop: 12, fontStyle: 'italic' },
  legal: { marginTop: 20 },
  legalText: { ...theme.font.caption, textAlign: 'center' },
  legalLink: { color: theme.colors.primary, fontWeight: '600' },
});
