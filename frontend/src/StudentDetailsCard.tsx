import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { Phone, MapPin, IdCard, Mail } from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { updateMyStudentDetails } from './supabaseDb';
import { bump } from './useSupabaseData';
import { validatePupilDetails } from './pupilDetails';
import { formatPostcode, lookupPostcode, looksLikePostcode } from './postcodeLookup';
import { AddressSearch } from './AddressSearch';

type Student = {
  email?: string | null; phone?: string | null; address?: string | null;
  postcode?: string | null; provisional_licence?: string | null;
};

/**
 * A pupil's own details: mobile number, pickup address and provisional licence number are
 * editable; email is shown but stays with the instructor, because it is how the pupil's
 * login is linked to their record.
 */
export function StudentDetailsCard({ student }: { student: Student }) {
  const [phone, setPhone] = useState(student.phone || '');
  const [address, setAddress] = useState(student.address || '');
  const [postcode, setPostcode] = useState(student.postcode || '');
  const [licence, setLicence] = useState(student.provisional_licence || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [postcodeNote, setPostcodeNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Checks the postcode when the pupil leaves the field: tidies it ("sm14ls" -> "SM1 4LS") and
  // shows the area it belongs to, or says it was not found. If the service cannot be reached
  // the pupil is not blocked.
  const checkPostcode = async (value: string): Promise<boolean> => {
    if (!value.trim()) { setPostcodeNote(null); return true; }
    if (!looksLikePostcode(value)) {
      setPostcodeNote({ ok: false, text: 'That does not look like a UK postcode.' });
      return false;
    }
    const tidy = formatPostcode(value);
    setPostcode(tidy);
    const r = await lookupPostcode(tidy);
    if (r.status === 'not_found') {
      setPostcodeNote({ ok: false, text: 'We could not find that postcode. Please check it.' });
      return false;
    }
    setPostcodeNote(r.status === 'found' && r.area ? { ok: true, text: `${r.postcode}: ${r.area}` } : null);
    return true;
  };

  // The record can arrive after the first render; fill the fields once it does.
  useEffect(() => {
    setPhone(student.phone || '');
    setAddress(student.address || '');
    setPostcode(student.postcode || '');
    setLicence(student.provisional_licence || '');
  }, [student.phone, student.address, student.postcode, student.provisional_licence]);

  const save = async () => {
    const checked = validatePupilDetails({ phone, address, postcode, licence });
    if (!checked.ok) { setMessage({ ok: false, text: checked.error }); return; }
    setSaving(true);
    setMessage(null);
    try {
      if (!(await checkPostcode(postcode))) {
        setMessage({ ok: false, text: 'Please check your postcode before saving.' });
        return;
      }
      const saved = await updateMyStudentDetails({ ...checked.values, postcode: formatPostcode(checked.values.postcode) });
      setPhone(saved.phone); setAddress(saved.address); setPostcode(saved.postcode); setLicence(saved.provisional_licence);
      bump();
      // On the card, not an Alert: Alert.alert does nothing in a browser.
      setMessage({ ok: true, text: 'Your details have been saved.' });
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Could not save. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 14 }} testID="student-details-card">
      <Text style={styles.title}>My details</Text>
      <Field icon={<Phone size={16} color={theme.colors.textMuted} />} label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="input-pupil-phone" />
      <AddressSearch onPick={(a) => { setAddress(a.address); setPostcode(a.postcode); setPostcodeNote(null); }} testID="pupil-address-search" />
      <Field icon={<MapPin size={16} color={theme.colors.textMuted} />} label="Pickup address" value={address} onChangeText={setAddress} testID="input-pupil-address" />
      <Field
        icon={<MapPin size={16} color={theme.colors.textMuted} />} label="Postcode" value={postcode}
        onChangeText={(v) => { setPostcode(v); setPostcodeNote(null); }}
        onBlur={() => { checkPostcode(postcode); }}
        autoCapitalize="characters" testID="input-pupil-postcode"
        note={postcodeNote}
      />
      <Field icon={<IdCard size={16} color={theme.colors.textMuted} />} label="Provisional licence number" value={licence} onChangeText={setLicence} autoCapitalize="characters" testID="input-pupil-licence" />
      <View style={styles.row}>
        <Mail size={16} color={theme.colors.textMuted} />
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.readonly} testID="pupil-email">{student.email || 'Not set'}</Text>
          <Text style={styles.hint}>To change your email, ask your instructor.</Text>
        </View>
      </View>
      {message && (
        <Text style={[styles.message, { color: message.ok ? theme.colors.success : theme.colors.danger }]} testID="pupil-details-message">
          {message.text}
        </Text>
      )}
      <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="btn-save-pupil-details">
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save details</Text>}
      </TouchableOpacity>
    </Card>
  );
}

function Field({ icon, label, value, onChangeText, onBlur, note, testID, keyboardType, autoCapitalize }: {
  icon: React.ReactNode; label: string; value: string; onChangeText: (v: string) => void; testID: string;
  onBlur?: () => void; note?: { ok: boolean; text: string } | null;
  keyboardType?: 'default' | 'phone-pad'; autoCapitalize?: 'none' | 'sentences' | 'characters';
}) {
  return (
    <View style={styles.row}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <TextInput style={styles.input} value={value} onChangeText={onChangeText} onBlur={onBlur} keyboardType={keyboardType} autoCapitalize={autoCapitalize} testID={testID} />
        {!!note && (
          <Text style={[styles.hint, { color: note.ok ? theme.colors.success : theme.colors.danger }]} testID={`${testID}-note`}>{note.text}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  label: { fontSize: 12, color: theme.colors.textMuted, marginBottom: 2 },
  input: { fontSize: 15, color: theme.colors.text, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  readonly: { fontSize: 15, color: theme.colors.text, paddingVertical: 4 },
  hint: { fontSize: 12.5, color: theme.colors.textMuted },
  message: { fontSize: 13, fontWeight: '600' },
  saveBtn: { backgroundColor: theme.colors.primary, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
