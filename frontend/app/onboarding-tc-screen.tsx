import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, ShieldCheck } from 'lucide-react-native';
import { theme } from '../src/theme';
import { instructorProfile } from '../src/mockDb';
import { useAuth } from '../src/AuthContext';
import { Card } from '../src/ui';

export default function OnboardingTcScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState(user?.name || '');
  const [saved, setSaved] = useState(!!instructorProfile.tc_signed_at);

  const save = () => {
    if (!accepted) {
      Alert.alert('Please accept the T&Cs to continue');
      return;
    }
    if (signature.trim().length < 3) {
      Alert.alert('Type your full name as a signature');
      return;
    }
    instructorProfile.tc_signed_at = new Date().toISOString();
    instructorProfile.tc_signature_name = signature.trim();
    setSaved(true);
    setTimeout(() => router.back(), 400);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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
          style={[styles.submitBtn, (!accepted || signature.length < 3) && styles.submitDisabled]}
          onPress={save}
          disabled={!accepted || signature.length < 3}
          testID="btn-sign-tc"
        >
          <Text style={styles.submitText}>{saved ? '✓ Signed' : 'Sign & Accept'}</Text>
        </TouchableOpacity>

        {saved && (
          <Text style={styles.savedNote} testID="tc-saved-note">
            Signed by {instructorProfile.tc_signature_name} on{' '}
            {instructorProfile.tc_signed_at ? new Date(instructorProfile.tc_signed_at).toLocaleString('en-GB') : ''}
          </Text>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
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
  sigPreview: { marginTop: 8, padding: 14, borderWidth: 1, borderColor: theme.colors.accent, borderRadius: 10, backgroundColor: '#FFF7ED' },
  sigPreviewText: { fontFamily: 'serif', fontSize: 22, fontStyle: 'italic', color: theme.colors.primary },
  sigPreviewDate: { fontSize: 11, color: theme.colors.textMuted, marginTop: 4 },
  submitBtn: { backgroundColor: theme.colors.primary, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  savedNote: { textAlign: 'center', color: theme.colors.success, fontWeight: '600' },
});
