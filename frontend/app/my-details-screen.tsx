import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, IdCard, Phone, Mail, MapPin, Car, Fingerprint } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { getInstructorProfile, updateMyInstructorProfile } from '../src/supabaseDb';
import { bump } from '../src/useSupabaseData';
import { isBiometricAvailable, isBiometricEnabled, setBiometricEnabled } from '../src/biometrics';

/**
 * "My Details" — a self-editable instructor profile (11 Sept 2026), per
 * Grant directly, scoped to solo tiers (Starter/Growth/Pro) only. A solo
 * instructor is always their own school owner, so the existing
 * ins_owner_all RLS policy already lets them update their own row — no new
 * policy needed for this case. Per Grant's explicit instruction, Franchise
 * stays exactly as it is: this screen is deliberately separate from, and
 * doesn't replace, the existing view-only instructor-profile-screen.tsx,
 * which non-owner Franchise instructors keep using unchanged.
 *
 * The vehicle fields (make/model/registration/colour) reuse the
 * instructors table's own car_make/car_model/number_plate columns rather
 * than the separate, school-wide vehicles fleet table — those columns
 * already existed, captured once at invite time via inviteInstructor(),
 * but were never actually shown or editable anywhere in the app until
 * this screen. car_colour is the one genuinely new column, added
 * alongside this feature.
 */
export default function MyDetailsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [adiNumber, setAdiNumber] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [carMake, setCarMake] = useState('');
  const [carModel, setCarModel] = useState('');
  const [numberPlate, setNumberPlate] = useState('');
  const [carColour, setCarColour] = useState('');

  // Biometric login toggle (11 Sept 2026), per Grant directly — added to
  // this screen too, alongside the existing one on profile-screen.tsx.
  // Deliberately the exact same isBiometricAvailable/isBiometricEnabled/
  // setBiometricEnabled logic, not a second, parallel implementation —
  // both toggles read and write the same underlying setting, so either
  // one always reflects the other's changes correctly.
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);
  useEffect(() => {
    (async () => {
      const available = await isBiometricAvailable();
      setBiometricAvailable(available);
      if (available) setBiometricOn(await isBiometricEnabled());
    })();
  }, []);
  const handleToggleBiometric = async (next: boolean) => {
    setBiometricOn(next); // optimistic — this is a fast, local-only write
    try {
      await setBiometricEnabled(next);
    } catch (e: any) {
      setBiometricOn(!next); // revert on a genuine write failure
      Alert.alert('Could not save', e?.message || 'Please try again.');
    }
  };

  useEffect(() => {
    let active = true;
    getInstructorProfile().then((profile) => {
      if (!active || !profile) return;
      setFullName(profile.full_name || '');
      setAdiNumber(profile.adi_number || '');
      setMobile(profile.mobile_number || '');
      setEmail(profile.email || '');
      setAddress(profile.address || '');
      setCarMake(profile.car_make || '');
      setCarModel(profile.car_model || '');
      setNumberPlate(profile.number_plate || '');
      setCarColour(profile.car_colour || '');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const initials = (fullName || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const handleSave = async () => {
    if (!fullName.trim()) { Alert.alert('Name required', 'Please enter your name.'); return; }
    if (!adiNumber.trim()) { Alert.alert('ADI/PDI number required', 'Please enter your ADI or PDI number.'); return; }
    setSaving(true);
    try {
      await updateMyInstructorProfile({
        full_name: fullName,
        adi_number: adiNumber,
        mobile_number: mobile,
        email,
        address,
        car_make: carMake,
        car_model: carModel,
        number_plate: numberPlate,
        car_colour: carColour,
      });
      // updateMyInstructorProfile() here is the raw supabaseDb write, not
      // a useSupabaseData wrapper, so it never calls bump() itself — every
      // screen reading this profile via useInstructorProfile() (e.g. the
      // lesson detail sheet's vehicle badge) would otherwise keep showing
      // stale data until an unrelated mutation elsewhere happened to bump
      // the shared version, or the app restarted.
      bump();
      Alert.alert('Saved', 'Your details have been updated.');
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>My Details</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {loading ? (
            <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <>
              <Card style={{ gap: 4 }}>
                <View style={styles.avatarRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Name</Text>
                    <TextInput
                      style={styles.nameInput}
                      value={fullName}
                      onChangeText={setFullName}
                      placeholder="Your name"
                      testID="input-full-name"
                    />
                  </View>
                </View>
              </Card>

              <Card style={{ gap: 14 }}>
                <Text style={styles.cardTitle}>Contact details</Text>
                <Field icon={<IdCard size={16} color={theme.colors.textMuted} />} label="ADI/PDI number" value={adiNumber} onChangeText={setAdiNumber} testID="input-adi" />
                <Field icon={<Phone size={16} color={theme.colors.textMuted} />} label="Mobile number" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" testID="input-mobile" />
                <Field icon={<Mail size={16} color={theme.colors.textMuted} />} label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" testID="input-email" />
                <Field icon={<MapPin size={16} color={theme.colors.textMuted} />} label="Address" value={address} onChangeText={setAddress} testID="input-address" />
              </Card>

              <Card style={{ gap: 14 }}>
                <Text style={styles.cardTitle}>My vehicle</Text>
                <Field icon={<Car size={16} color={theme.colors.textMuted} />} label="Make" value={carMake} onChangeText={setCarMake} testID="input-car-make" />
                <Field icon={<Car size={16} color={theme.colors.textMuted} />} label="Model" value={carModel} onChangeText={setCarModel} testID="input-car-model" />
                <Field icon={<Car size={16} color={theme.colors.textMuted} />} label="Registration number" value={numberPlate} onChangeText={setNumberPlate} autoCapitalize="characters" testID="input-number-plate" />
                <Field icon={<Car size={16} color={theme.colors.textMuted} />} label="Colour" value={carColour} onChangeText={setCarColour} testID="input-car-colour" />
              </Card>

              {biometricAvailable && (
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Fingerprint size={20} color={theme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Use fingerprint to unlock</Text>
                    <Text style={styles.fieldLabel}>Skip re-entering your password each time you open the app.</Text>
                  </View>
                  <Switch value={biometricOn} onValueChange={handleToggleBiometric} testID="switch-biometric-my-details" />
                </Card>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
                testID="btn-save-my-details"
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save changes</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  icon, label, value, onChangeText, testID, keyboardType, autoCapitalize,
}: {
  icon: React.ReactNode; label: string; value: string; onChangeText: (v: string) => void; testID: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address'; autoCapitalize?: 'none' | 'sentences' | 'characters';
}) {
  return (
    <View style={styles.fieldRow}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          testID={testID}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },

  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  nameInput: { fontSize: 17, fontWeight: '700', color: theme.colors.text, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border },

  fieldRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  fieldLabel: { fontSize: 12, color: theme.colors.textMuted, marginBottom: 2 },
  fieldInput: { fontSize: 15, color: theme.colors.text, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border },

  saveBtn: { height: 50, borderRadius: 13, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
