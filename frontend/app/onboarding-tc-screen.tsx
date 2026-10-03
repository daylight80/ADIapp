import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, ShieldCheck } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { Card } from '../src/ui';
import { getMyPupilAgreementText, signPupilAgreementAsStudent } from '../src/supabaseDb';
import { useStudentByAuthId, bump } from '../src/useSupabaseData';
import { agreementStatus } from '../src/pupilAgreement';

/**
 * Pupil Agreement — signed by the student from their own dashboard (before
 * Migration 051 it recorded the signature on the instructor's row, which made
 * the instructor sign an agreement meant for their pupils). The instructor sees
 * the result on the student's profile.
 */
export default function OnboardingTcScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { student, loading: loadingProfile } = useStudentByAuthId(user?.id);
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [justSigned, setJustSigned] = useState<{ at: string; name: string } | null>(null);

  // The school's own wording, if its owner wrote any; otherwise the standard
  // terms below. A failed lookup just means the standard terms are shown.
  const [customAgreementText, setCustomAgreementText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMyPupilAgreementText()
      .then((t) => { if (!cancelled) setCustomAgreementText(t); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const recorded = agreementStatus(student);
  const saved = recorded.signed || !!justSigned;
  const signedAt = justSigned?.at ?? recorded.signedAt;
  const signedName = justSigned?.name ?? recorded.signedBy ?? '';

  const save = async () => {
    if (!accepted) {
      Alert.alert('Please accept the T&Cs to continue');
      return;
    }
    if (signature.trim().length < 3) {
      Alert.alert('Type your full name as a signature');
      return;
    }
    setSaving(true);
    try {
      const result = await signPupilAgreementAsStudent(signature);
      setJustSigned({ at: result.tc_signed_at, name: result.tc_signature_name });
      bump();
      setTimeout(() => router.back(), 1800);
    } catch (e: any) {
      Alert.alert('Could not save your signature', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Terms & Conditions</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.heroCard}>
          <ShieldCheck size={32} color={theme.colors.primary} />
          <Text style={styles.heroTitle}>Pupil Agreement</Text>
          <Text style={styles.heroSub}>
            Please review and digitally sign the agreement below. A timestamped record is kept for compliance.
          </Text>
        </Card>

        {customAgreementText ? (
          <Card>
            <Text style={styles.tcHeading}>Your school's terms</Text>
            <Text style={styles.tcText}>{customAgreementText}</Text>
          </Card>
        ) : (
        <Card>
          <Text style={styles.tcHeading}>1. Lessons & cancellations</Text>
          <Text style={styles.tcText}>
            Lessons run for the agreed duration. Cancellations made less than 24 hours before the lesson are
            charged at the full rate, unless the instructor agrees otherwise.
          </Text>
          <Text style={styles.tcHeading}>2. Eyesight & fitness to drive</Text>
          <Text style={styles.tcText}>
            You confirm that you meet the DVSA eyesight standard (number plate readable at 20 metres), hold a
            valid provisional or full licence, and are fit to drive on the day of each lesson.
          </Text>
          <Text style={styles.tcHeading}>3. Insurance & liability</Text>
          <Text style={styles.tcText}>
            The vehicle is fully insured for tuition. You agree to follow the instructor's directions at all
            times. Reckless or wilful misuse may incur charges.
          </Text>
          <Text style={styles.tcHeading}>4. Data protection (UK GDPR)</Text>
          <Text style={styles.tcText}>
            Your contact details, lesson notes and progress data are stored securely and used only to deliver
            tuition. You may request your data or its deletion at any time.
          </Text>
          <Text style={styles.tcHeading}>5. Payments & VAT</Text>
          <Text style={styles.tcText}>
            All fees are payable on or before the lesson. Block bookings are non-refundable but transferable.
            VAT receipts are available on request.
          </Text>
        </Card>
        )}

        <TouchableOpacity
          style={styles.checkbox}
          onPress={() => setAccepted((a) => !a)}
          testID="checkbox-accept"
          activeOpacity={0.7}
        >
          <View style={[styles.checkboxBox, accepted && styles.checkboxBoxActive]}>
            {accepted && <Check size={14} color="#fff" />}
          </View>
          <Text style={styles.checkboxLabel}>I have read and accept the Pupil Agreement above.</Text>
        </TouchableOpacity>

        <View>
          <Text style={styles.label}>Type your full name as a signature</Text>
          <TextInput
            style={styles.input}
            value={signature}
            onChangeText={setSignature}
            placeholder="e.g. Charlotte Smith"
            placeholderTextColor={theme.colors.textMuted}
            testID="input-signature"
          />
          {signature.length >= 3 && (
            <View style={styles.sigPreview} testID="signature-preview">
              <Text style={styles.sigPreviewText}>{signature}</Text>
              <Text style={styles.sigPreviewDate}>{new Date().toLocaleString('en-GB')}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, (!accepted || signature.length < 3 || saving || loadingProfile) && styles.submitDisabled]}
          onPress={save}
          disabled={!accepted || signature.length < 3 || saving || loadingProfile || saved}
          testID="btn-sign-tc"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>{saved ? '✓ Signed' : 'Sign & Accept'}</Text>
          )}
        </TouchableOpacity>

        {saved && (
          <Text style={styles.savedNote} testID="tc-saved-note">
            Signed by {signedName} on {signedAt ? new Date(signedAt).toLocaleString('en-GB') : ''}
          </Text>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  scroll: { padding: 16, gap: 14, paddingBottom: 32 },
  heroCard: { alignItems: 'center', gap: 6 },
  heroTitle: { ...theme.font.h2 },
  heroSub: { color: theme.colors.textMuted, textAlign: 'center', fontSize: 13 },
  tcHeading: { fontSize: 14, fontWeight: '700', color: theme.colors.text, marginTop: 12 },
  tcText: { fontSize: 13, color: theme.colors.text, lineHeight: 19, marginTop: 4 },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  checkboxBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxBoxActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  checkboxLabel: { fontSize: 14, color: theme.colors.text, flex: 1 },
  label: { ...theme.font.caption, fontWeight: '600', marginBottom: 6, color: theme.colors.text },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    backgroundColor: theme.colors.background,
    fontSize: 15,
  },
  sigPreview: { marginTop: 8, padding: 14, borderWidth: 1, borderColor: theme.colors.accent, borderRadius: 10, backgroundColor: theme.colors.lockedBg },
  sigPreviewText: { fontFamily: 'serif', fontSize: 22, fontStyle: 'italic', color: theme.colors.primary },
  sigPreviewDate: { fontSize: 11, color: theme.colors.textMuted, marginTop: 4 },
  submitBtn: { backgroundColor: theme.colors.primary, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  savedNote: { textAlign: 'center', color: theme.colors.success, fontWeight: '600' },
});
