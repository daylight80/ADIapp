import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Platform, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { X, CheckCircle, UserPlus, Search, Smartphone, AlertTriangle } from 'lucide-react-native';
import { theme } from './theme';
import { addStudent } from './supabaseDb';
import { supabase } from './supabaseClient';

export type ContactsImportSheetProps = {
  visible: boolean;
  onClose: () => void;
  onImported?: (count: number) => void;
};

type ImportableContact = {
  id: string;
  name: string;
  phone: string;   // E.164-ish or whatever the OS hands us
};

/**
 * Bulk contacts import sheet — opens AFTER the privacy banner CTA is tapped.
 *
 * Mobile: requests contacts permission → lists every contact that has at
 * least one phone number → multi-select checkboxes → "Add N students" creates
 * student rows with status='New' (per user spec).
 *
 * Web: shows a friendly "open the app on your phone" message (spec 6a).
 */
export function ContactsImportSheet({ visible, onClose, onImported }: ContactsImportSheetProps) {
  const isWeb = Platform.OS === 'web';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ImportableContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const [permissionState, setPermissionState] = useState<'idle' | 'requesting' | 'denied' | 'granted'>('idle');
  const [successCount, setSuccessCount] = useState<number | null>(null);

  // Reset whenever modal opens/closes.
  useEffect(() => {
    if (!visible) {
      setError(null);
      setContacts([]);
      setSelected(new Set());
      setImporting(false);
      setQuery('');
      setPermissionState('idle');
      setSuccessCount(null);
      return;
    }
    if (isWeb) return;
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const loadContacts = async () => {
    setLoading(true);
    setError(null);
    setPermissionState('requesting');
    try {
      // Dynamic import so the bundle doesn't break on web where the native module is absent.
      const Contacts = await import('expo-contacts');
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setPermissionState('denied');
        setError('Contacts permission was not granted. You can enable it later in Settings.');
        return;
      }
      setPermissionState('granted');
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
        pageSize: 0, // all
      });
      const mapped: ImportableContact[] = (data || [])
        .map((c: any) => {
          const name = (c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || '').trim();
          const phone = c.phoneNumbers && c.phoneNumbers.length > 0
            ? (c.phoneNumbers[0].number || c.phoneNumbers[0].digits || '').trim()
            : '';
          return { id: String(c.id), name, phone };
        })
        .filter((c) => c.name && c.phone)
        .sort((a, b) => a.name.localeCompare(b.name));
      setContacts(mapped);
    } catch (e: any) {
      setError(e?.message || 'Could not load contacts.');
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const doImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    const toImport = contacts.filter((c) => selected.has(c.id));
    let ok = 0;
    let fail = 0;
    for (const c of toImport) {
      try {
        // Per user spec 4a: strictly name + phone. Email/address/postcode/
        // provisional licence are left blank and the row is created with
        // status='New' (default in addStudent + AddStudentInput).
        await addStudent({
          name: c.name,
          email: '',
          phone: c.phone,
          provisional_licence: 'PENDING',
        });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setImporting(false);
    setSuccessCount(ok);
    onImported?.(ok);
    if (fail > 0) setError(`${fail} contact${fail === 1 ? '' : 's'} could not be added.`);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !importing && onClose()}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <UserPlus size={18} color={theme.colors.primary} />
              <Text style={styles.title}>Import from Contacts</Text>
            </View>
            <TouchableOpacity onPress={() => !importing && onClose()} testID="btn-import-close" hitSlop={8}>
              <X size={20} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Success screen */}
          {successCount !== null ? (
            <View style={styles.successBox}>
              <CheckCircle size={40} color={theme.colors.success} />
              <Text style={styles.successTitle}>
                {successCount} student{successCount === 1 ? '' : 's'} imported
              </Text>
              <Text style={styles.successSub}>
                They have been added as “New” on your Students screen. You can add their email,
                address, postcode and provisional licence later.
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={onClose}
                testID="btn-import-done"
              >
                <Text style={styles.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : isWeb ? (
            // Web fallback per spec 6a
            <View style={styles.webBox}>
              <Smartphone size={36} color={theme.colors.primary} />
              <Text style={styles.webTitle}>Open the app on your phone</Text>
              <Text style={styles.webSub}>
                Importing from your contacts works on iPhone and Android only. Sign in to the
                ADI Pro mobile app on your phone and tap this button there.
              </Text>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Got it</Text>
              </TouchableOpacity>
            </View>
          ) : loading ? (
            <View style={{ alignItems: 'center', padding: 36, gap: 12 }}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.hint}>
                {permissionState === 'requesting' ? 'Requesting permission…' : 'Loading contacts…'}
              </Text>
            </View>
          ) : permissionState === 'denied' ? (
            <View style={styles.webBox}>
              <AlertTriangle size={36} color={theme.colors.danger} />
              <Text style={styles.webTitle}>Permission needed</Text>
              <Text style={styles.webSub}>
                {error || 'Contacts permission was not granted. You can enable it later from your phone Settings.'}
              </Text>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Search */}
              <View style={styles.searchWrap}>
                <Search size={14} color={theme.colors.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search contacts…"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.searchInput}
                />
              </View>

              <View style={styles.toolbar}>
                <Text style={styles.count}>
                  {selected.size}/{filtered.length} selected
                </Text>
                <TouchableOpacity onPress={toggleAll} testID="btn-toggle-all">
                  <Text style={styles.toggleAll}>
                    {selected.size === filtered.length && filtered.length > 0 ? 'Clear all' : 'Select all'}
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
                {filtered.length === 0 ? (
                  <Text style={styles.empty}>No contacts with a phone number found.</Text>
                ) : filtered.map((c) => {
                  const isOn = selected.has(c.id);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.row}
                      onPress={() => toggleOne(c.id)}
                      testID={`contact-row-${c.id}`}
                      activeOpacity={0.6}
                    >
                      <View style={[styles.checkbox, isOn && styles.checkboxOn]}>
                        {isOn && <CheckCircle size={14} color="#fff" />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowName} numberOfLines={1}>{c.name}</Text>
                        <Text style={styles.rowPhone} numberOfLines={1}>{c.phone}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {error ? <Text style={styles.errText}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.primaryBtn, (selected.size === 0 || importing) && styles.btnDisabled]}
                onPress={doImport}
                disabled={selected.size === 0 || importing}
                testID="btn-import-confirm"
              >
                {importing ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.primaryBtnText}>
                    {selected.size === 0 ? 'Select contacts to import' : `Add ${selected.size} student${selected.size === 1 ? '' : 's'}`}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 22,
    maxHeight: '92%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '800', color: theme.colors.text },
  hint: { color: theme.colors.textMuted, fontSize: 13 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 10, height: 40, marginBottom: 10, backgroundColor: theme.colors.background,
  },
  searchInput: { flex: 1, fontSize: 14, color: theme.colors.text, padding: 0 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  count: { fontSize: 12, fontWeight: '700', color: theme.colors.textMuted, letterSpacing: 0.4 },
  toggleAll: { fontSize: 13, fontWeight: '700', color: theme.colors.primary },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: theme.colors.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  checkboxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  rowName: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  rowPhone: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', color: theme.colors.textMuted, paddingVertical: 24, fontSize: 13 },
  primaryBtn: {
    height: 50, borderRadius: 12, backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 14,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center' },
  secondaryBtnText: { color: theme.colors.textMuted, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  errText: { color: theme.colors.danger, fontSize: 12, marginTop: 6 },
  webBox: { alignItems: 'center', padding: 24, gap: 12 },
  webTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text, textAlign: 'center' },
  webSub: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 19 },
  successBox: { alignItems: 'center', padding: 24, gap: 10 },
  successTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.text },
  successSub: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 19 },
});

// =============================================================================
// Dismissal persistence helpers — Migration 014
// =============================================================================

/** Mark the contacts-import onboarding banner as dismissed for this instructor. */
export async function markContactsImportDismissed(): Promise<void> {
  const { data: ses } = await supabase.auth.getSession();
  const uid = ses.session?.user?.id;
  if (!uid) return;
  try {
    await supabase
      .from('instructors')
      .update({ contacts_import_dismissed_at: new Date().toISOString() })
      .eq('auth_user_id', uid);
  } catch {
    /* Migration 014 may not be applied yet — silently no-op. */
  }
}

/** Has the current instructor dismissed the banner before? */
export async function isContactsImportDismissed(): Promise<boolean> {
  const { data: ses } = await supabase.auth.getSession();
  const uid = ses.session?.user?.id;
  if (!uid) return false;
  try {
    const { data, error } = await supabase
      .from('instructors')
      .select('contacts_import_dismissed_at')
      .eq('auth_user_id', uid)
      .maybeSingle();
    if (error) return false;
    return !!(data && (data as any).contacts_import_dismissed_at);
  } catch {
    return false;
  }
}
