import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Car,
  Plus,
  Pencil,
  Trash2,
  Star,
  StarOff,
  CheckCircle2,
} from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import {
  useVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  setDefaultVehicle,
} from '../src/useSupabaseData';
import type { Vehicle } from '../src/supabaseDb';

type Transmission = 'Manual' | 'Automatic' | 'Electric';
const TRANSMISSIONS: Transmission[] = ['Manual', 'Automatic', 'Electric'];

// Simple UK plate sanity check — accepts both new-style and dateless formats.
// Not exhaustive, intentionally lenient (some private-import plates differ).
const UK_PLATE_RX = /^[A-Z0-9 ]{2,8}$/i;

export default function VehiclesScreen() {
  const router = useRouter();
  const { vehicles, loading, error, refresh } = useVehicles();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [makeModel, setMakeModel] = useState('');
  const [plate, setPlate] = useState('');
  const [transmission, setTransmission] = useState<Transmission>('Manual');
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setMakeModel('');
    setPlate('');
    setTransmission('Manual');
    // First-ever vehicle should default to default.
    setSetAsDefault(vehicles.length === 0);
    setSheetOpen(true);
  };

  const openEdit = (v: Vehicle) => {
    setEditing(v);
    setMakeModel(v.make_and_model);
    setPlate(v.registration_plate);
    setTransmission(v.transmission);
    setSetAsDefault(v.is_default);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!makeModel.trim()) { Alert.alert('Missing detail', 'Make & model is required.'); return; }
    if (!UK_PLATE_RX.test(plate.trim())) {
      Alert.alert('Invalid plate', 'Please enter a valid UK registration plate (letters/numbers/spaces).');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateVehicle(editing.id, {
          make_and_model: makeModel,
          registration_plate: plate,
          transmission,
          is_default: setAsDefault,
        });
      } else {
        await createVehicle({
          make_and_model: makeModel,
          registration_plate: plate,
          transmission,
          is_default: setAsDefault,
        });
      }
      setSheetOpen(false);
      refresh();
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('vehicles_plate_unique')) {
        Alert.alert('Plate already used', 'Another vehicle at your school uses this registration plate.');
      } else if (msg.includes('is_default')) {
        Alert.alert(
          'Migration needed',
          'Please apply Migration 005 in the Supabase SQL editor (vehicles is_default column). The vehicle was saved but cannot be set as default yet.',
        );
      } else {
        Alert.alert('Save failed', e?.message || 'Could not save the vehicle.');
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (v: Vehicle) => {
    const proceed = async () => {
      try {
        await deleteVehicle(v.id);
        refresh();
      } catch (e: any) {
        const msg = (e?.message || '').toLowerCase();
        if (msg.includes('foreign key') || msg.includes('violates') || msg.includes('restrict')) {
          Alert.alert(
            'Vehicle in use',
            'This vehicle is linked to existing lessons. Remove or reassign those lessons first.',
          );
        } else {
          Alert.alert('Delete failed', e?.message || 'Could not delete vehicle.');
        }
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Delete ${v.make_and_model} (${v.registration_plate})?`)) proceed();
      return;
    }
    Alert.alert(
      `Delete ${v.make_and_model}?`,
      `Plate: ${v.registration_plate}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: proceed },
      ],
    );
  };

  const makeDefault = async (v: Vehicle) => {
    try {
      await setDefaultVehicle(v.id);
      refresh();
    } catch (e: any) {
      Alert.alert('Could not set default', e?.message || 'Please apply Migration 005 first.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Vehicles</Text>
        <TouchableOpacity onPress={openAdd} style={styles.iconBtn} testID="btn-add-vehicle">
          <Plus size={22} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.lede}>
          Add the cars you use for lessons. The default vehicle is auto-selected on new bookings.
        </Text>

        {loading && vehicles.length === 0 && (
          <Card><ActivityIndicator size="small" color={theme.colors.primary} /></Card>
        )}
        {!!error && (
          <Card><Text style={styles.errorText}>{error}</Text></Card>
        )}

        {!loading && vehicles.length === 0 && !error && (
          <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
            <Car size={32} color={theme.colors.textMuted} />
            <Text style={styles.emptyText}>You haven't added any vehicles yet.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={openAdd} testID="btn-add-first">
              <Plus size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Add your first vehicle</Text>
            </TouchableOpacity>
          </Card>
        )}

        {vehicles.map((v) => (
          <Card key={v.id} style={{ gap: 10 }} testID={`vehicle-${v.id}`}>
            <View style={styles.cardHead}>
              <View style={styles.vehicleIcon}>
                <Car size={22} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{v.make_and_model}</Text>
                <Text style={styles.cardPlate}>{v.registration_plate}</Text>
              </View>
              {v.is_default && (
                <Badge label="Default" bg={theme.colors.primary} color="#fff" />
              )}
            </View>

            <View style={styles.metaRow}>
              <Badge label={v.transmission} bg={theme.colors.primaryLight} color={theme.colors.primary} />
              {v.is_right_hand_drive && <Badge label="RHD" bg="#E0E7FF" color="#3730A3" />}
            </View>

            <View style={styles.actionRow}>
              {!v.is_default ? (
                <TouchableOpacity style={styles.actionBtn} onPress={() => makeDefault(v)} testID={`btn-default-${v.id}`}>
                  <Star size={16} color={theme.colors.accent} />
                  <Text style={[styles.actionText, { color: theme.colors.accent }]}>Set default</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.actionBtn, { opacity: 0.6 }]}>
                  <StarOff size={16} color={theme.colors.textMuted} />
                  <Text style={[styles.actionText, { color: theme.colors.textMuted }]}>Default ✓</Text>
                </View>
              )}
              <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(v)} testID={`btn-edit-${v.id}`}>
                <Pencil size={16} color={theme.colors.primary} />
                <Text style={[styles.actionText, { color: theme.colors.primary }]}>Amend</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => confirmDelete(v)} testID={`btn-delete-${v.id}`}>
                <Trash2 size={16} color={theme.colors.danger} />
                <Text style={[styles.actionText, { color: theme.colors.danger }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))}

        <View style={{ height: 24 }} />
      </ScrollView>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? 'Amend vehicle' : 'Add a new vehicle'}
        testID="sheet-vehicle"
      >
        <Text style={styles.label}>Make & model</Text>
        <TextInput
          value={makeModel}
          onChangeText={setMakeModel}
          placeholder="e.g. Vauxhall Corsa SRi"
          style={styles.input}
          autoCapitalize="words"
          testID="input-make-model"
        />

        <Text style={styles.label}>Registration plate</Text>
        <TextInput
          value={plate}
          onChangeText={(t) => setPlate(t.toUpperCase())}
          placeholder="e.g. AB21 CDE"
          style={[styles.input, styles.plateInput]}
          autoCapitalize="characters"
          maxLength={8}
          testID="input-plate"
        />

        <Text style={styles.label}>Transmission</Text>
        <View style={styles.chipRow}>
          {TRANSMISSIONS.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, transmission === t && styles.chipActive]}
              onPress={() => setTransmission(t)}
              testID={`chip-${t}`}
            >
              <Text style={[styles.chipText, transmission === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={styles.defaultRow}
          onPress={() => setSetAsDefault((v) => !v)}
          testID="toggle-default"
        >
          <View style={[styles.checkbox, setAsDefault && styles.checkboxActive]}>
            {setAsDefault && <CheckCircle2 size={18} color="#fff" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.defaultLabel}>Set as default vehicle</Text>
            <Text style={styles.defaultSub}>Auto-selected when booking new lessons.</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          testID="btn-save-vehicle"
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>{editing ? 'Save changes' : 'Add vehicle'}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSheetOpen(false)} style={styles.cancelLink} testID="btn-cancel-vehicle">
          <Text style={styles.cancelLinkText}>Cancel</Text>
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  lede: { color: theme.colors.textMuted, fontSize: 13, marginBottom: 4 },
  errorText: { color: theme.colors.danger, fontSize: 13 },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', fontSize: 14 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.primary, paddingHorizontal: 16, height: 44, borderRadius: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vehicleIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  cardPlate: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 1 },
  metaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 6 },
  actionText: { fontSize: 13, fontWeight: '600' },
  // Sheet form
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 15, color: theme.colors.text, backgroundColor: theme.colors.surface },
  plateInput: { letterSpacing: 2, fontWeight: '700' },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
  chipTextActive: { color: '#fff' },
  defaultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 10, borderRadius: 10, backgroundColor: theme.colors.background },
  checkbox: { width: 28, height: 28, borderRadius: 7, borderWidth: 2, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  checkboxActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  defaultLabel: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  defaultSub: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  saveBtn: { marginTop: 18, backgroundColor: theme.colors.primary, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cancelLink: { alignItems: 'center', padding: 12, marginTop: 4 },
  cancelLinkText: { color: theme.colors.textMuted, fontWeight: '600' },
});
