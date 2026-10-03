import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { IdCard, Phone, Mail, MapPin, Star, Building2, ChevronRight } from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { getInstructorProfile, updateMyInstructorProfile } from './supabaseDb';
import { bump } from './useSupabaseData';
import { isFranchiseTier } from './tiers';
import { validateInstructorDetails } from './instructorDetails';

/**
 * The instructor's own details, on the Profile screen. This replaces the separate
 * "My Details" (editable, solo tiers) and "Instructor profile" (view-only,
 * Franchise) screens, which showed nearly the same thing.
 *
 * Solo instructors (Starter/Growth/Pro) are their own school owner, so the
 * existing ins_owner_all RLS policy lets them edit their own row. Franchise
 * instructors only see what their school owner has set. The Google review link
 * is a solo-tier setting (Franchise sets it in School Profile), and the business
 * name and logo link is ADI Pro only, as before.
 */
export function InstructorDetailsSection({ tier }: { tier: string | null | undefined }) {
  const router = useRouter();
  const editable = !isFranchiseTier(tier);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [fullName, setFullName] = useState('');
  const [adiNumber, setAdiNumber] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [googleReviewUrl, setGoogleReviewUrl] = useState('');

  useEffect(() => {
    let active = true;
    getInstructorProfile().then((p) => {
      if (!active || !p) return;
      setFullName(p.full_name || '');
      setAdiNumber(p.adi_number || '');
      setMobile(p.mobile_number || '');
      setEmail(p.email || '');
      setAddress(p.address || '');
      setGoogleReviewUrl(p.google_review_url || '');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const save = async () => {
    const problem = validateInstructorDetails({ fullName, adiNumber, googleReviewUrl });
    if (problem) { setMessage({ ok: false, text: problem }); return; }
    setSaving(true);
    setMessage(null);
    try {
      await updateMyInstructorProfile({
        full_name: fullName,
        adi_number: adiNumber,
        mobile_number: mobile,
        email,
        address,
        google_review_url: googleReviewUrl.trim(),
      });
      // updateMyInstructorProfile is the raw write and never bumps the shared
      // version itself, so other screens would keep showing stale details.
      bump();
      setMessage({ ok: true, text: 'Your details have been saved.' });
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Could not save. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 16 }} />;

  return (
    <>
      <Card style={{ gap: 14 }} testID="details-card">
        <Text style={styles.cardTitle}>My details</Text>
        <Field icon={<IdCard size={16} color={theme.colors.textMuted} />} label="Name" value={fullName} onChangeText={setFullName} editable={editable} testID="input-full-name" />
        <Field icon={<IdCard size={16} color={theme.colors.textMuted} />} label="ADI/PDI number" value={adiNumber} onChangeText={setAdiNumber} editable={editable} testID="input-adi" />
        <Field icon={<Phone size={16} color={theme.colors.textMuted} />} label="Mobile number" value={mobile} onChangeText={setMobile} editable={editable} keyboardType="phone-pad" testID="input-mobile" />
        <Field icon={<Mail size={16} color={theme.colors.textMuted} />} label="Email" value={email} onChangeText={setEmail} editable={editable} keyboardType="email-address" testID="input-email" />
        <Field icon={<MapPin size={16} color={theme.colors.textMuted} />} label="Address" value={address} onChangeText={setAddress} editable={editable} testID="input-address" />
        {!editable && (
          <Text style={styles.hint}>These details are set by your school owner. To update anything here, ask them to make the change.</Text>
        )}
      </Card>

      {editable && (
        <Card style={{ gap: 14 }}>
          <Text style={styles.cardTitle}>Google reviews</Text>
          <Field icon={<Star size={16} color={theme.colors.textMuted} />} label="Google review link" value={googleReviewUrl} onChangeText={setGoogleReviewUrl} editable keyboardType="url" autoCapitalize="none" testID="input-google-review-url" />
          <Text style={styles.fieldLabel}>
            Your Google Business Profile&apos;s &quot;write a review&quot; link, shown to students who pass in the review-request text.
          </Text>
        </Card>
      )}

      {editable && (
        <>
          {message && (
            <Text style={[styles.message, { color: message.ok ? theme.colors.success : theme.colors.danger }]} testID="details-message">
              {message.text}
            </Text>
          )}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
            testID="btn-save-my-details"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save details</Text>}
          </TouchableOpacity>
        </>
      )}

      {tier === 'pro' && (
        <Card>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
            onPress={() => router.push('/school-profile-screen' as any)}
            testID="link-school-profile"
          >
            <Building2 size={18} color={theme.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Business name & logo</Text>
              <Text style={styles.fieldLabel}>Shown on your invoices: edit your business name, logo and contact details.</Text>
            </View>
            <ChevronRight size={18} color={theme.colors.textMuted} />
          </TouchableOpacity>
        </Card>
      )}
    </>
  );
}

function Field({
  icon, label, value, onChangeText, testID, keyboardType, autoCapitalize, editable,
}: {
  icon: React.ReactNode; label: string; value: string; onChangeText: (v: string) => void; testID: string; editable: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'url'; autoCapitalize?: 'none' | 'sentences' | 'characters';
}) {
  return (
    <View style={styles.fieldRow}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          style={[styles.fieldInput, !editable && styles.fieldReadonly]}
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          placeholder={editable ? undefined : 'Not set'}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          testID={testID}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  fieldRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  fieldLabel: { fontSize: 12, color: theme.colors.textMuted, marginBottom: 2 },
  fieldInput: { fontSize: 15, color: theme.colors.text, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  fieldReadonly: { borderBottomWidth: 0 },
  hint: { fontSize: 12.5, color: theme.colors.textMuted, lineHeight: 18 },
  message: { fontSize: 13.5, fontWeight: '600', textAlign: 'center' },
  saveBtn: { height: 50, borderRadius: 13, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
