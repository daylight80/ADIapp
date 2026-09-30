import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Plus, Gift } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { useAuth } from '../src/AuthContext';
import { isPaidTier } from '../src/tiers';
import {
  listGiftVouchers, createGiftVoucher, setGiftVoucherStatus, getInstructorProfile, getMySchoolProfile,
  type GiftVoucher, type InstructorProfile, type SchoolProfile,
} from '../src/supabaseDb';
import {
  HOUR_CHOICES, EXPIRY_CHOICES, DEFAULT_EXPIRY_MONTHS, MAX_VOUCHER_HOURS,
  addMonths, buildVoucherHtml, formatHoursLabel, formatVoucherDate, parseVoucherHours, voucherStatus,
  type VoucherStatus,
} from '../src/voucher';
import { generateAndSharePdf, A4_POINTS } from '../src/invoice';

/**
 * Gift vouchers ("Drive Vouchers", 30 Sept 2026, Migration 049). The instructor
 * or school picks a number of prepaid hours and a PDF gift voucher is made, with
 * their logo and business name, a code and an expiry date. Redeeming is manual:
 * when the recipient books, the instructor adds the hours to the student's
 * wallet and marks the voucher redeemed here so the code can't be used twice.
 * Paid plans only. Profile shows the upgrade prompt to Starter users, and this
 * screen sends them home if they arrive anyway (a UX safeguard, not a security
 * boundary, same as the other paid screens).
 */

const STATUS_STYLE: Record<VoucherStatus, { bg: string; text: string; label: string }> = {
  active: { bg: '#D1FAE5', text: theme.colors.success, label: 'Active' },
  redeemed: { bg: '#E5F0FA', text: theme.colors.primary, label: 'Redeemed' },
  cancelled: { bg: '#EDE8DE', text: theme.colors.textMuted, label: 'Cancelled' },
  expired: { bg: '#FEF3C7', text: '#92400E', label: 'Expired' },
};

/** confirm() on the web (Alert.alert does nothing in a browser), Alert on a phone. */
function confirmAction(title: string, message: string, confirmText: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
    ], { onDismiss: () => resolve(false) });
  });
}

export default function VouchersScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [vouchers, setVouchers] = useState<GiftVoucher[]>([]);
  const [instructor, setInstructor] = useState<InstructorProfile | null>(null);
  const [school, setSchool] = useState<SchoolProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [hoursText, setHoursText] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [expiryMonths, setExpiryMonths] = useState(DEFAULT_EXPIRY_MONTHS);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Paid feature; see the header comment.
  useEffect(() => {
    if (user && !isPaidTier(user.tier)) router.replace('/home-screen' as any);
  }, [user]);

  const load = useCallback(async () => {
    try {
      const [rows, me] = await Promise.all([listGiftVouchers(), getInstructorProfile()]);
      setVouchers(rows);
      setInstructor(me);
      setLoadError(null);
      // Branding is optional: only a school's owner can read the school profile,
      // so anyone else (or a failure) simply gets the instructor's name on the PDF.
      try { setSchool(await getMySchoolProfile()); } catch { setSchool(null); }
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load your vouchers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const hours = useMemo(() => parseVoucherHours(hoursText), [hoursText]);
  const expiryPreview = useMemo(() => formatVoucherDate(addMonths(new Date(), expiryMonths)), [expiryMonths]);

  const sharePdf = async (v: GiftVoucher): Promise<boolean> => {
    const html = buildVoucherHtml({
      code: v.code,
      hours: v.hours,
      expiresAt: v.expires_at,
      issuedAt: new Date(v.issued_at),
      recipientName: v.recipient_name,
      message: v.message,
      businessName: school?.business_name,
      logoUrl: school?.logo_url,
      instructorName: instructor?.full_name || user?.name || 'Your instructor',
      contactEmail: school?.contact_email || instructor?.email || user?.email,
      contactPhone: school?.contact_phone || instructor?.mobile_number,
      address: school?.address,
    });
    const result = await generateAndSharePdf(html, `Gift-voucher-${v.code}.pdf`, 'voucher', A4_POINTS);
    if (!result.ok) Alert.alert('Could not make the PDF', result.error || 'Please try again.');
    return result.ok;
  };

  const openForm = () => {
    setFormOpen(true);
    setHoursText(''); setRecipient(''); setMessage(''); setExpiryMonths(DEFAULT_EXPIRY_MONTHS); setFormError(null);
  };

  const handleCreate = async () => {
    setFormError(null);
    if (hours === null) {
      setFormError(`Enter the hours in half-hour steps, up to ${MAX_VOUCHER_HOURS}, for example 5 or 2.5.`);
      return;
    }
    if (!instructor?.id || !instructor.school_id) {
      setFormError('Your instructor profile is not loaded yet. Please try again.');
      return;
    }
    setSaving(true);
    try {
      const created = await createGiftVoucher({
        instructorId: instructor.id,
        schoolId: instructor.school_id,
        hours,
        expiresAt: addMonths(new Date(), expiryMonths),
        recipientName: recipient,
        message,
      });
      setFormOpen(false);
      // PDF first, straight after the click, so a browser is less likely to block the print window.
      const ok = await sharePdf(created);
      await load();
      if (!ok) Alert.alert('Voucher saved', 'The voucher is saved. Tap "Share PDF" on it to try the PDF again.');
    } catch (e: any) {
      setFormError(e?.message || 'Could not create the voucher. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (v: GiftVoucher, next: 'redeemed' | 'cancelled') => {
    const ok = next === 'redeemed'
      ? await confirmAction('Mark as redeemed?', `Use this once ${formatHoursLabel(v.hours)} has been added to the student's wallet. The code can't then be used again.`, 'Mark redeemed')
      : await confirmAction('Cancel this voucher?', 'The code will no longer be valid.', 'Cancel voucher');
    if (!ok) return;
    setBusyId(v.id);
    try {
      await setGiftVoucherStatus(v.id, next);
      await load();
    } catch (e: any) {
      setLoadError(e?.message || 'Could not update that voucher. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile-screen' as any))} style={styles.iconBtn} testID="btn-back">
            <ArrowLeft size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Gift vouchers</Text>
          <TouchableOpacity
            onPress={() => (formOpen ? setFormOpen(false) : openForm())}
            style={styles.iconBtn}
            testID="btn-new-voucher"
            accessibilityLabel="New gift voucher"
          >
            <Plus size={22} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>
            Make a PDF gift voucher for a number of prepaid driving hours, with your logo and business name.
            When the recipient books, add the hours to their wallet and mark the voucher redeemed.
          </Text>

          {!!loadError && (
            <Card style={{ borderColor: theme.colors.danger, borderWidth: 1 }} testID="vouchers-error">
              <Text style={{ color: theme.colors.danger, fontSize: 13 }}>{loadError}</Text>
            </Card>
          )}

          {formOpen && (
            <Card style={{ gap: 10 }} testID="card-voucher-form">
              <Text style={styles.cardTitle}>New gift voucher</Text>

              <Text style={styles.label}>How many hours?</Text>
              <View style={styles.chips}>
                {HOUR_CHOICES.map((h) => (
                  <TouchableOpacity
                    key={h}
                    onPress={() => setHoursText(String(h))}
                    style={[styles.chip, hours === h && styles.chipActive]}
                    testID={`chip-hours-${h}`}
                  >
                    <Text style={[styles.chipText, hours === h && styles.chipTextActive]}>{h}h</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                value={hoursText}
                onChangeText={setHoursText}
                placeholder="Or type the hours, e.g. 2.5"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="decimal-pad"
                testID="input-voucher-hours"
              />
              {hours !== null && <Text style={styles.helper}>{formatHoursLabel(hours)} of driving lessons.</Text>}

              <Text style={styles.label}>For (optional)</Text>
              <TextInput
                style={styles.input}
                value={recipient}
                onChangeText={setRecipient}
                placeholder="Who is it for?"
                placeholderTextColor={theme.colors.textMuted}
                maxLength={80}
                testID="input-voucher-for"
              />

              <Text style={styles.label}>Message (optional)</Text>
              <TextInput
                style={[styles.input, { height: 64, textAlignVertical: 'top' }]}
                value={message}
                onChangeText={setMessage}
                placeholder="Happy birthday, good luck with the lessons…"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                maxLength={300}
                testID="input-voucher-message"
              />

              <Text style={styles.label}>Valid for</Text>
              <View style={styles.chips}>
                {EXPIRY_CHOICES.map((c) => (
                  <TouchableOpacity
                    key={c.months}
                    onPress={() => setExpiryMonths(c.months)}
                    style={[styles.chip, expiryMonths === c.months && styles.chipActive]}
                    testID={`chip-expiry-${c.months}`}
                  >
                    <Text style={[styles.chipText, expiryMonths === c.months && styles.chipTextActive]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.helper}>Valid until {expiryPreview}.</Text>

              {!school?.logo_url && (
                <Text style={styles.helper}>
                  No logo yet. Add your logo and business name in your business details and they will appear on the voucher.
                </Text>
              )}

              {!!formError && <Text style={styles.formError} testID="voucher-form-error">{formError}</Text>}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setFormOpen(false)} disabled={saving} testID="btn-cancel-voucher">
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { flex: 1 }, saving && { opacity: 0.6 }]}
                  onPress={handleCreate}
                  disabled={saving}
                  testID="btn-create-voucher"
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Create voucher PDF</Text>}
                </TouchableOpacity>
              </View>
            </Card>
          )}

          {vouchers.length === 0 && !formOpen && (
            <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }} testID="vouchers-empty">
              <Gift size={28} color={theme.colors.textMuted} />
              <Text style={styles.emptyTitle}>No vouchers yet</Text>
              <Text style={styles.emptyText}>
                Make a gift voucher for prepaid lessons. It comes as a PDF with your logo that you can send or print.
              </Text>
              <TouchableOpacity style={[styles.saveBtn, { paddingHorizontal: 20, alignSelf: 'stretch' }]} onPress={openForm} testID="btn-first-voucher">
                <Text style={styles.saveBtnText}>Make your first voucher</Text>
              </TouchableOpacity>
            </Card>
          )}

          {vouchers.map((v) => {
            const status = voucherStatus(v);
            const tone = STATUS_STYLE[status];
            return (
              <Card key={v.id} style={{ gap: 6 }} testID={`voucher-${v.id}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.code} testID={`voucher-code-${v.id}`}>{v.code}</Text>
                    <Text style={styles.itemName}>{formatHoursLabel(v.hours)}{v.recipient_name ? ` · ${v.recipient_name}` : ''}</Text>
                    <Text style={styles.itemDate}>
                      {status === 'redeemed' && v.redeemed_at
                        ? `Redeemed ${new Date(v.redeemed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : `Valid until ${formatVoucherDate(v.expires_at)}`}
                    </Text>
                  </View>
                  <View style={[styles.pill, { backgroundColor: tone.bg }]} testID={`voucher-status-${v.id}`}>
                    <Text style={[styles.pillText, { color: tone.text }]}>{tone.label}</Text>
                  </View>
                </View>

                {status === 'active' && (
                  <View style={styles.actions}>
                    <TouchableOpacity onPress={() => sharePdf(v)} testID={`btn-share-${v.id}`}>
                      <Text style={styles.actionLink}>Share PDF</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => changeStatus(v, 'redeemed')} disabled={busyId === v.id} testID={`btn-redeem-${v.id}`}>
                      <Text style={styles.actionLink}>Mark redeemed</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => changeStatus(v, 'cancelled')} disabled={busyId === v.id} testID={`btn-cancel-${v.id}`}>
                      <Text style={[styles.actionLink, { color: theme.colors.danger }]}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>
            );
          })}

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
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
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
  code: { fontSize: 16, fontWeight: '800', letterSpacing: 1.5, color: theme.colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  itemName: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginTop: 4 },
  itemDate: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  actionLink: { color: theme.colors.primary, fontWeight: '600', fontSize: 13.5 },
});
