import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { MapPin, Plus, Trash2 } from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { AddressSearch } from './AddressSearch';
import { saveStudentPlace, deleteStudentPlace } from './supabaseDb';
import { useStudentPlaces, bump } from './useSupabaseData';
import { combineAddress } from './addressLookup';
import { formatPostcode, looksLikePostcode } from './postcodeLookup';

/**
 * Other places a pupil gets picked up from (college, work, a relative's house). The main pickup address is
 * kept with the pupil's details; these are the extras, chosen per lesson when it is booked.
 * Used by the pupil on their own profile (no studentId) and by the instructor on a pupil's profile.
 */
export function PickupPlacesCard({ studentId }: { studentId?: string }) {
  const places = useStudentPlaces(studentId);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = () => { setAdding(false); setLabel(''); setAddress(''); setPostcode(''); };

  const save = async () => {
    if (!label.trim()) { setMessage({ ok: false, text: 'Give the place a short name, e.g. College.' }); return; }
    if (!address.trim()) { setMessage({ ok: false, text: 'Enter the address, or search for it above.' }); return; }
    if (postcode.trim() && !looksLikePostcode(postcode)) { setMessage({ ok: false, text: 'That does not look like a UK postcode.' }); return; }
    setBusy(true); setMessage(null);
    try {
      await saveStudentPlace({ label, address, postcode: postcode.trim() ? formatPostcode(postcode) : null, studentId });
      bump();
      reset();
      setMessage({ ok: true, text: 'Place saved.' });
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Could not save. Please try again.' });
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setMessage(null);
    try { await deleteStudentPlace(id); bump(); }
    catch (e: any) { setMessage({ ok: false, text: e?.message || 'Could not remove it. Please try again.' }); }
    finally { setBusy(false); }
  };

  return (
    <Card style={{ gap: 10 }} testID="pickup-places-card">
      <Text style={styles.title}>Other pickup places</Text>
      <Text style={styles.hint}>The main pickup address is in the details. Add others, like college or work, and choose one when a lesson is booked.</Text>
      {places.map((p) => (
        <View key={p.id} style={styles.row} testID={`place-${p.id}`}>
          <MapPin size={16} color={theme.colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{p.label}</Text>
            <Text style={styles.addr} numberOfLines={2}>{combineAddress(p.address, p.postcode)}</Text>
          </View>
          <TouchableOpacity onPress={() => remove(p.id)} disabled={busy} accessibilityLabel={`Remove ${p.label}`} testID={`btn-remove-place-${p.id}`} style={{ padding: 6 }}>
            <Trash2 size={18} color={theme.colors.danger} />
          </TouchableOpacity>
        </View>
      ))}
      {adding ? (
        <View style={{ gap: 8 }}>
          <AddressSearch onPick={(a) => { setAddress(a.address); setPostcode(a.postcode); setMessage(null); }} testID="place-search" />
          <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="Name, e.g. College" placeholderTextColor={theme.colors.textMuted} maxLength={40} testID="input-place-label" />
          <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Address" placeholderTextColor={theme.colors.textMuted} maxLength={200} testID="input-place-address" />
          <TextInput style={styles.input} value={postcode} onChangeText={setPostcode} placeholder="Postcode" placeholderTextColor={theme.colors.textMuted} autoCapitalize="characters" maxLength={10} testID="input-place-postcode" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[styles.saveBtn, busy && { opacity: 0.6 }]} onPress={save} disabled={busy} testID="btn-save-place">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save place</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { reset(); setMessage(null); }} testID="btn-cancel-place">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addBtn} onPress={() => { setAdding(true); setMessage(null); }} testID="btn-add-place">
          <Plus size={16} color={theme.colors.primary} />
          <Text style={styles.addText}>Add a pickup place</Text>
        </TouchableOpacity>
      )}
      {!!message && <Text style={[styles.message, { color: message.ok ? theme.colors.success : theme.colors.danger }]} testID="places-message">{message.text}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 12.5, color: theme.colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  addr: { fontSize: 12.5, color: theme.colors.textMuted },
  input: { height: 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, color: theme.colors.text, backgroundColor: theme.colors.background },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addText: { color: theme.colors.primary, fontWeight: '700', fontSize: 14 },
  saveBtn: { flex: 1, backgroundColor: theme.colors.primary, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { paddingHorizontal: 16, height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: theme.colors.textMuted, fontWeight: '600' },
  message: { fontSize: 13, fontWeight: '600' },
});
