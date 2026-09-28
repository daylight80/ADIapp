import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Plus, Trash2, AlertTriangle, CalendarClock, Award } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { useAuth } from '../src/AuthContext';
import { isPaidTier } from '../src/tiers';
import {
  listMyDeadlineItems, addDeadline, updateDeadline, removeDeadline, type DeadlineItem,
} from '../src/supabaseDb';
import {
  KIND_INFO, REMIND_DAYS, availableKinds, daysUntil, describeDays, formatDueDate,
  isValidDateInput, itemDisplayName, sortByDueDate, statusForDays,
  type DeadlineStatus, type EditableDeadlineKind,
} from '../src/deadlines';

/**
 * Deadlines (28 Sept 2026, Migration 046) — the dates an instructor can't afford
 * to miss: ADI badge, MOT, insurance, road tax, dual-control service, plus their
 * own. The DVSA standards check is shown here too but worked out from the checks
 * they've logged (last + 4 years), so it has no date to type. Reminders go out
 * by email and push at 30, 7 and 1 days before, and once if it's overdue
 * (backend/admin_reminders.py). Paid plans only — Profile shows the upgrade
 * prompt to Starter users, and this screen sends them home if they arrive anyway
 * (a UX safeguard, not a security boundary, same as the other paid screens).
 */

const STATUS_STYLE: Record<DeadlineStatus, { bg: string; text: string }> = {
  overdue: { bg: '#FEE2E2', text: theme.colors.danger },
  urgent: { bg: '#FFEDD5', text: '#C2410C' },
  soon: { bg: '#FEF3C7', text: '#92400E' },
  ok: { bg: '#D1FAE5', text: theme.colors.success },
};

/** confirm() on the web (Alert.alert does nothing in a browser), Alert on a phone. */
function confirmDelete(name: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`Delete "${name}"? You will stop getting reminders for it.`));
  }
  return new Promise((resolve) => {
    Alert.alert(`Delete "${name}"?`, 'You will stop getting reminders for it.', [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ], { onDismiss: () => resolve(false) });
  });
}

type FormMode = { type: 'add' } | { type: 'edit'; item: DeadlineItem };

export default function DeadlinesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<DeadlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormMode | null>(null);
  const [kind, setKind] = useState<EditableDeadlineKind | null>(null);
  const [label, setLabel] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Paid feature — see the header comment.
  useEffect(() => {
    if (user && !isPaidTier(user.tier)) router.replace('/home-screen' as any);
  }, [user]);

  const load = useCallback(async () => {
    try {
      setItems(await listMyDeadlineItems());
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load your deadlines.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the screen regains focus, so a standards check logged on
  // the next screen shows up here straight away.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sorted = useMemo(() => sortByDueDate(items), [items]);
  const freeKinds = useMemo(() => availableKinds(items), [items]);
  const hasStandardsCheck = items.some((i) => i.kind === 'standards_check');

  const openAdd = () => {
    setForm({ type: 'add' });
    setKind(freeKinds[0] ?? null);
    setLabel(''); setDueDate(''); setNotes(''); setFormError(null);
  };

  const openEdit = (item: DeadlineItem) => {
    setForm({ type: 'edit', item });
    setKind(item.kind === 'standards_check' ? null : (item.kind as EditableDeadlineKind));
    setLabel(item.label || ''); setDueDate(''); setNotes(item.notes || ''); setFormError(null);
  };

  const closeForm = () => { setForm(null); setFormError(null); };

  const handleSave = async () => {
    if (!form) return;
    setFormError(null);
    const isEdit = form.type === 'edit';
    const activeKind = isEdit ? (form.item.kind as EditableDeadlineKind) : kind;
    if (!activeKind) { setFormError('Choose what this deadline is for.'); return; }
    if (!isValidDateInput(dueDate)) {
      setFormError('Enter the date as YYYY-MM-DD, for example 2026-11-30.');
      return;
    }
    if (activeKind === 'other' && !label.trim()) {
      setFormError('Give this deadline a name, like "First aid certificate".');
      return;
    }
    if (!isEdit && !user?.instructor_id) { setFormError('Your instructor profile is not loaded yet. Please try again.'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await updateDeadline(form.item.id as string, {
          dueDate: dueDate.trim(),
          label: activeKind === 'other' ? label : undefined,
          notes,
        });
      } else {
        await addDeadline({
          instructorId: user!.instructor_id as string,
          kind: activeKind,
          dueDate: dueDate.trim(),
          label: activeKind === 'other' ? label : null,
          notes,
        });
      }
      closeForm();
      await load();
    } catch (e: any) {
      setFormError(e?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: DeadlineItem) => {
    if (!item.id) return;
    if (!(await confirmDelete(itemDisplayName(item)))) return;
    try {
      await removeDeadline(item.id);
      setItems((prev) => prev.filter((i) => i.item_key !== item.item_key));
    } catch (e: any) {
      setLoadError(e?.message || 'Could not delete that. Please try again.');
    }
  };

  const datePreview = (() => {
    if (!dueDate.trim()) return null;
    if (!isValidDateInput(dueDate)) return { ok: false, text: 'That is not a valid date yet (YYYY-MM-DD).' };
    const d = daysUntil(dueDate.trim());
    return { ok: true, text: `${formatDueDate(dueDate.trim())}${d === null ? '' : `  ·  ${describeDays(d)}`}` };
  })();

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const isEdit = form?.type === 'edit';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile-screen' as any))} style={styles.iconBtn} testID="btn-back">
            <ArrowLeft size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Deadlines</Text>
          <TouchableOpacity
            onPress={() => (form ? closeForm() : openAdd())}
            style={styles.iconBtn}
            testID="btn-add-deadline"
            accessibilityLabel="Add a deadline"
          >
            <Plus size={22} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>
            Keep track of the dates you can't afford to miss. We'll email you and send a notification{' '}
            {REMIND_DAYS.slice(0, -1).join(', ')} and {REMIND_DAYS[REMIND_DAYS.length - 1]} days before each one,
            and once more if it slips past.
          </Text>

          {!!loadError && (
            <Card style={{ borderColor: theme.colors.danger, borderWidth: 1 }} testID="deadlines-error">
              <Text style={{ color: theme.colors.danger, fontSize: 13 }}>{loadError}</Text>
            </Card>
          )}

          {form && (
            <Card style={{ gap: 10 }} testID="card-deadline-form">
              <Text style={styles.cardTitle}>{isEdit ? `Update ${itemDisplayName(form.item)}` : 'Add a deadline'}</Text>

              {!isEdit && (
                <>
                  <Text style={styles.label}>What is it?</Text>
                  <View style={styles.chips}>
                    {freeKinds.map((k) => (
                      <TouchableOpacity
                        key={k}
                        onPress={() => setKind(k)}
                        style={[styles.chip, kind === k && styles.chipActive]}
                        testID={`chip-kind-${k}`}
                      >
                        <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>{KIND_INFO[k].label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {kind && <Text style={styles.helper}>{KIND_INFO[kind].hint}</Text>}
                </>
              )}

              {(isEdit ? form.item.kind === 'other' : kind === 'other') && (
                <>
                  <Text style={styles.label}>Name</Text>
                  <TextInput
                    style={styles.input}
                    value={label}
                    onChangeText={setLabel}
                    placeholder="e.g. First aid certificate"
                    placeholderTextColor={theme.colors.textMuted}
                    maxLength={80}
                    testID="input-deadline-label"
                  />
                </>
              )}

              <Text style={styles.label}>{isEdit ? 'New due date (YYYY-MM-DD)' : 'Due date (YYYY-MM-DD)'}</Text>
              <TextInput
                style={styles.input}
                value={dueDate}
                onChangeText={setDueDate}
                placeholder="2026-11-30"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                testID="input-deadline-date"
              />
              {isEdit && (
                <Text style={styles.helper}>
                  Currently {formatDueDate(form.item.due_date)}. Enter the new date once you've renewed it.
                </Text>
              )}
              {datePreview && (
                <Text style={[styles.helper, !datePreview.ok && { color: theme.colors.danger }]} testID="deadline-date-preview">
                  {datePreview.text}
                </Text>
              )}

              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, { height: 64, textAlignVertical: 'top' }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Policy number, garage, anything useful…"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                maxLength={500}
                testID="input-deadline-notes"
              />

              {!!formError && <Text style={styles.formError} testID="deadline-form-error">{formError}</Text>}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeForm} disabled={saving} testID="btn-cancel-deadline">
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { flex: 1 }, saving && { opacity: 0.6 }]}
                  onPress={handleSave}
                  disabled={saving}
                  testID="btn-save-deadline"
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{isEdit ? 'Save new date' : 'Save'}</Text>}
                </TouchableOpacity>
              </View>
            </Card>
          )}

          {sorted.length === 0 && !form && (
            <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }} testID="deadlines-empty">
              <CalendarClock size={28} color={theme.colors.textMuted} />
              <Text style={styles.emptyTitle}>No deadlines yet</Text>
              <Text style={styles.emptyText}>
                Add your MOT, insurance, road tax, ADI badge and dual-control service dates, and we'll remind you before each one.
              </Text>
              <TouchableOpacity style={[styles.saveBtn, { paddingHorizontal: 20, alignSelf: 'stretch' }]} onPress={openAdd} testID="btn-add-first-deadline">
                <Text style={styles.saveBtnText}>Add your first deadline</Text>
              </TouchableOpacity>
            </Card>
          )}

          {sorted.map((item) => {
            const days = daysUntil(item.due_date);
            const status = days === null ? 'ok' : statusForDays(days);
            const tone = STATUS_STYLE[status];
            return (
              <Card
                key={item.item_key}
                style={[{ gap: 6 }, status === 'overdue' && { borderColor: theme.colors.danger, borderWidth: 1 }]}
                testID={`deadline-${item.item_key}`}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {status === 'overdue' && <AlertTriangle size={15} color={theme.colors.danger} />}
                      {item.kind === 'standards_check' && <Award size={15} color={theme.colors.primary} />}
                      <Text style={styles.itemName}>{itemDisplayName(item)}</Text>
                    </View>
                    <Text style={styles.itemDate}>{formatDueDate(item.due_date)}</Text>
                  </View>
                  {days !== null && (
                    <View style={[styles.pill, { backgroundColor: tone.bg }]} testID={`deadline-status-${item.item_key}`}>
                      <Text style={[styles.pillText, { color: tone.text }]}>{describeDays(days)}</Text>
                    </View>
                  )}
                </View>

                {item.kind === 'standards_check' && (
                  <Text style={styles.helper}>Worked out from your logged checks: 4 years after the most recent one.</Text>
                )}
                {!!item.notes && <Text style={styles.notes}>{item.notes}</Text>}

                <View style={styles.actions}>
                  {item.derived ? (
                    <TouchableOpacity onPress={() => router.push('/standards-check-screen' as any)} testID="btn-log-standards-check">
                      <Text style={styles.actionLink}>Log a check</Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <TouchableOpacity onPress={() => openEdit(item)} testID={`btn-renew-${item.item_key}`}>
                        <Text style={styles.actionLink}>Renewed? Update date</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(item)} testID={`btn-delete-${item.item_key}`} accessibilityLabel="Delete deadline">
                        <Trash2 size={16} color={theme.colors.danger} />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </Card>
            );
          })}

          {!hasStandardsCheck && (
            <Card style={{ gap: 6 }} testID="standards-check-hint">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Award size={15} color={theme.colors.primary} />
                <Text style={styles.itemName}>DVSA standards check</Text>
              </View>
              <Text style={styles.helper}>
                Log your most recent check and we'll work out when the next one is due, then remind you. No date to type in.
              </Text>
              <TouchableOpacity onPress={() => router.push('/standards-check-screen' as any)} testID="btn-log-first-standards-check">
                <Text style={styles.actionLink}>Log a standards check</Text>
              </TouchableOpacity>
            </Card>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },
  subtitle: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 18 },
  cardTitle: { ...theme.font.h3 },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.text, marginTop: 4 },
  helper: { fontSize: 12.5, color: theme.colors.textMuted, lineHeight: 17 },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
    borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  chipTextActive: { color: '#fff' },
  formError: { color: theme.colors.danger, fontSize: 13, fontWeight: '600' },
  saveBtn: {
    backgroundColor: theme.colors.primary, height: 46, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  cancelBtn: {
    height: 46, borderRadius: 10, paddingHorizontal: 18, marginTop: 4,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border,
  },
  cancelBtnText: { color: theme.colors.text, fontWeight: '600' },
  emptyTitle: { ...theme.font.h3 },
  emptyText: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 20 },
  itemName: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  itemDate: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  notes: { fontSize: 13, color: theme.colors.text },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  actionLink: { color: theme.colors.primary, fontWeight: '600', fontSize: 13.5 },
});
