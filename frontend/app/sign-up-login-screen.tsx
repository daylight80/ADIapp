import React, { useState } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Car, Mail, Lock, User as UserIcon, GraduationCap, Briefcase } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';

type Tab = 'signin' | 'signup';

export default function SignUpLoginScreen() {
  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'instructor' | 'student'>('student');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signIn, signUp } = useAuth();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

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
    const r = await signUp(email.trim(), password, name.trim(), role);
    setBusy(false);
    if (!r.ok) setError(r.error || 'Registration failed');
  };

  const demoLogin = async (which: 'instructor' | 'student') => {
    setError(null);
    setBusy(true);
    const creds =
      which === 'instructor'
        ? { email: 'instructor@demo.uk', password: 'password123' }
        : { email: 'student@demo.uk', password: 'password123' };
    setEmail(creds.email);
    setPassword(creds.password);
    const r = await signIn(creds.email, creds.password);
    setBusy(false);
    if (!r.ok) setError(r.error || 'Demo login failed');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, isTablet && styles.scrollTablet]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.card, isTablet && styles.cardTablet]} testID="auth-card">
            <View style={styles.brand}>
              <View style={styles.brandIcon}>
                <Car size={28} color="#fff" />
              </View>
              <Text style={styles.brandTitle}>DriveHub UK</Text>
              <Text style={styles.brandSub}>Instructor & Student Portal</Text>
            </View>

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
                <Text style={[styles.tabText, tab === 'signup' && styles.tabTextActive]}>Create Account</Text>
              </TouchableOpacity>
            </View>

            {tab === 'signup' && (
              <View style={styles.field}>
                <UserIcon size={18} color={theme.colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Full name"
                  placeholderTextColor={theme.colors.textMuted}
                  value={name}
                  onChangeText={setName}
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

            {tab === 'signup' && (
              <View style={styles.roleRow}>
                <TouchableOpacity
                  style={[styles.roleBtn, role === 'student' && styles.roleBtnActive]}
                  onPress={() => setRole('student')}
                  testID="role-student"
                >
                  <GraduationCap
                    size={18}
                    color={role === 'student' ? theme.colors.primary : theme.colors.textMuted}
                  />
                  <Text
                    style={[styles.roleText, role === 'student' && styles.roleTextActive]}
                  >
                    Student
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleBtn, role === 'instructor' && styles.roleBtnActive]}
                  onPress={() => setRole('instructor')}
                  testID="role-instructor"
                >
                  <Briefcase
                    size={18}
                    color={role === 'instructor' ? theme.colors.primary : theme.colors.textMuted}
                  />
                  <Text
                    style={[styles.roleText, role === 'instructor' && styles.roleTextActive]}
                  >
                    Instructor
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {error && (
              <Text style={styles.error} testID="auth-error">
                {error}
              </Text>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              onPress={tab === 'signin' ? handleSignIn : handleSignUp}
              disabled={busy}
              testID={tab === 'signin' ? 'btn-signin' : 'btn-signup'}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {tab === 'signin' ? 'Sign In' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>

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

            <View style={styles.legal}>
              <Text style={styles.legalText}>
                By continuing you agree to our{' '}
                <Text style={styles.legalLink} testID="link-tos">
                  Terms of Service
                </Text>{' '}
                and{' '}
                <Text style={styles.legalLink} testID="link-privacy">
                  Privacy Policy
                </Text>
                .
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
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardTablet: { width: 480, maxWidth: '100%' },
  brand: { alignItems: 'center', marginBottom: 24 },
  brandIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  brandTitle: { ...theme.font.h1 },
  brandSub: { ...theme.font.caption, marginTop: 4 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    padding: 4,
    marginBottom: 20,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: theme.colors.surface, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  tabText: { ...theme.font.body, color: theme.colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: theme.colors.primary },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 12,
  },
  input: { flex: 1, ...theme.font.body, paddingVertical: 0 },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  roleBtnActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight },
  roleText: { ...theme.font.body, fontWeight: '600', color: theme.colors.textMuted },
  roleTextActive: { color: theme.colors.primary },
  error: { color: theme.colors.danger, marginBottom: 8, fontSize: 14 },
  primaryBtn: {
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { ...theme.font.button },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { ...theme.font.caption },
  demoPanel: { gap: 10 },
  demoBtn: {
    height: 48,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  demoBtnInstructor: { backgroundColor: theme.colors.accent },
  demoBtnStudent: { backgroundColor: theme.colors.primary },
  demoBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  legal: { marginTop: 20 },
  legalText: { ...theme.font.caption, textAlign: 'center' },
  legalLink: { color: theme.colors.primary, fontWeight: '600' },
});
