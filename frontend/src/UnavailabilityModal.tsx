import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Switch,
} from 'react-native';
import { X, Trash2, Ban } from 'lucide-react-native';
import { theme } from './theme';
import { DateField, TimeField } from './DateTimeFields';
import type { AvailabilityBlock, AvailabilityCategory } from './supabaseDb';
import {
  createAvailabilityBlock,
  patchAvailabilityBlock,
  removeAvailabilityBlock,
} from './useSupabaseData';

export type UnavailabilityModalProps = {
  visible: boolean;
  /** If provided, modal is in EDIT mode for this block; otherwise CREATE. */
  block?: AvailabilityBlock | null;
  /** Optional pre-selected starting date in 'YYYY-MM-DD' (e.g. today on diary). */
  initialDate?: string;
  onClose: () => void;
  onSaved?: () => void;
};

type CategoryOption = { value: AvailabilityCategory; label: string };
const CATEGORIES: CategoryOption[] = [
  { value: 'holiday',  label: 'Holiday' },
  { value: 'personal', label: 'Personal' },
  { value: 'family',   label: 'Family' },
  { value: 'sick',     label: 'Sick' },
  { value: 'other',    label: 'Other' },
];

const todayYmd = () => new Date().toISOString().slice(0, 10);

function ymdAndHmsToIso(ymd: string, hm: string): string {
  // Construct a local-time ISO string and let JS convert to UTC.
  const d = new Date(`${ymd}T${hm}:00`);
  return d.toISOString();
}

function isoToYmd(iso: string): string {
  // Use local-time components so the user sees the wall-clock value they entered.
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function isoToHm(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${mn}`;
}

export function UnavailabilityModal({ visible, block, initialDate, onClose, onSaved }: UnavailabilityModalProps) {
  const editing = !!block;

  const [date, setDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [allDay, setAllDay] = useState(false);
  const [category, setCategory] = useState<AvailabilityCategory>('other');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset form whenever the modal becomes visible or switches block.
  useEffect(() => {
    if (!visible) return;
    setErr(null);
    if (block) {
      setDate(isoToYmd(block.starts_at));
      setEndDate(isoToYmd(block.ends_at));
      setStartTime(isoToHm(block.starts_at));
      setEndTime(isoToHm(block.ends_at));
      setAllDay(!!block.all_day);
      setCategory(block.category);
      setReason(block.reason || '');
    } else {
      const seed = initialDate || todayYmd();
      setDate(seed);
      setEndDate(seed);
      setStartTime('09:00');
      setEndTime('17:00');
      setAllDay(false);
      setCategory('other');
      setReason('');
    }
  }, [visible, block, initialDate]);

  const computedRange = useMemo(() => {
    try {
      const sIso = allDay
        ? new Date(`${date}T00:00:00`).toISOString()
        : ymdAndHmsToIso(date, startTime);
      // For all-day, end is the start of the next day so the band fills the whole day cleanly.
      const endYmd = endDate || date;
      const eIso = allDay
        ? new Date(`${endYmd}T23:59:59`).toISOString()
        : ymdAndHmsToIso(endYmd, endTime);
      return { sIso, eIso };
    } catch {
      return { sIso: '', eIso: '' };
    }
  }, [date, endDate, startTime, endTime, allDay]);

  const onSave = async () => {
    setErr(null);
    if (!date) { setErr('Please pick a start date.'); return; }
    if (!computedRange.sIso || !computedRange.eIso) { setErr('Invalid date or time.'); return; }
    if (new Date(computedRange.eIso) <= new Date(computedRange.sIso)) {
      setErr('End time must be after the start time.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        starts_at: computedRange.sIso,
        ends_at: computedRange.eIso,
        all_day: allDay,
        category,
        reason: reason.trim() ? reason.trim() : null,
      };
      if (editing && block) {
        await patchAvailabilityBlock(block.id, payload);
      } else {
        await createAvailabilityBlock(payload);
      }
      onSaved?.();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Could not save unavailability.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!editing || !block) return;
    const yes = await new Promise<boolean>((resolve) => {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        resolve(window.confirm('Delete this unavailability? Your diary will be open for lessons in this window again.'));
      } else {
        Alert.alert('Delete unavailability?', 'Your diary will be open for lessons in this window again.', [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
        ]);
      }
    });
    if (!yes) return;
    setBusy(true);
    try {
      await removeAvailabilityBlock(block.id);
      onSaved?.();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Could not delete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ban size={18} color={theme.colors.danger} />
              <Text style={styles.title}>
                {editing ? 'Edit unavailability' : 'Add unavailability'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => !busy && onClose()} testID="btn-unavail-close" hitSlop={8}>
              <X size={20} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8, gap: 14 }}>
            {/* Category chips */}
            <View>
              <Text style={styles.label}>Reason category</Text>
              <View style={styles.chipRow}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c.value}
                    style={[styles.chip, category === c.value && styles.chipActive]}
                    onPress={() => setCategory(c.value)}
                    testID={`unavail-cat-${c.value}`}
                  >
                    <Text style={[styles.chipText, category === c.value && styles.chipTextActive]}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Optional free-text note */}
            <View>
              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. School run, Dentist, Eid"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.textInput}
                maxLength={120}
                testID="input-unavail-reason"
              />
            </View>

            {/* All-day toggle */}
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>All day</Text>
                <Text style={styles.hint}>Blocks the full day (00:00–23:59).</Text>
              </View>
              <Switch
                value={allDay}
                onValueChange={setAllDay}
                trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
                testID="switch-unavail-allday"
              />
            </View>

            {/* Date fields */}
            <View>
              <Text style={styles.label}>From date</Text>
              <DateField value={date} onChange={(v) => { setDate(v); if (!endDate || endDate < v) setEndDate(v); }} testID="input-unavail-date" />
            </View>
            <View>
              <Text style={styles.label}>To date</Text>
              <DateField value={endDate || date} onChange={setEndDate} testID="input-unavail-enddate" />
            </View>

            {/* Time fields — hidden when all-day */}
            {!allDay && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>From time</Text>
                  <TimeField value={startTime} onChange={setStartTime} testID="input-unavail-start" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>To time</Text>
                  <TimeField value={endTime} onChange={setEndTime} testID="input-unavail-end" />
                </View>
              </View>
            )}

            {err ? <Text style={styles.errText}>{err}</Text> : null}

            {/* Actions */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              {editing && (
                <TouchableOpacity
                  style={[styles.deleteBtn, busy && styles.btnDisabled]}
                  onPress={onDelete}
                  disabled={busy}
                  testID="btn-unavail-delete"
                  accessibilityLabel="Delete unavailability"
                >
                  <Trash2 size={16} color="#fff" />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.saveBtn, busy && styles.btnDisabled]}
                onPress={onSave}
                disabled={busy}
                testID="btn-unavail-save"
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>{editing ? 'Save changes' : 'Add unavailability'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 22,
    maxHeight: '92%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '800', color: theme.colors.text },
  label: { fontSize: 12, fontWeight: '700', color: theme.colors.textMuted, marginBottom: 6, letterSpacing: 0.4 },
  hint: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  chipTextActive: { color: '#fff' },
  textInput: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, height: 44, color: theme.colors.text, backgroundColor: theme.colors.background,
  },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 4,
  },
  saveBtn: {
    flex: 1, height: 50, borderRadius: 12,
    backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  deleteBtn: {
    width: 50, height: 50, borderRadius: 12,
    backgroundColor: theme.colors.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  errText: { color: theme.colors.danger, fontSize: 13 },
});
