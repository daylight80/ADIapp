import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Plus, FileText, Bell } from 'lucide-react-native';
import {
  getReminderStatus, sendPaymentReminder, reminderErrorMessage, reminderSuccessMessage, reminderHistoryLine, type ReminderStatus,
} from './paymentReminder';
import { theme } from './theme';
import { Card } from './ui';
import { BottomSheet } from './BottomSheet';
import { DateField } from './DateTimeFields';
import { useAuth } from './AuthContext';
import { usePaymentLedger, bump, purchaseBlock } from './useSupabaseData';
import { recordPayment, voidPayment, updatePaymentDate, getMySchoolProfile, listLessonPackages, type LessonPackage } from './supabaseDb';
import { usablePackages, packageTopUp, describePackageTopUp } from './pricing';
import { generateAndSharePdf } from './invoice';
import { newAttemptId } from './walletTopUp';
import { todayKey } from './voucher';
import {
  PAYMENT_METHOD_CHOICES, parseAmount, formatGbp, describeBalance, paymentSubline, paymentErrorMessage,
  buildReceiptHtml, paymentDateKey, paidAtForDay, isFutureDay, paymentDate, suggestWalletHours, parseWalletHours, type PaymentMethod, type PaymentRow,
} from './payments';

const TONE = {
  owes: { bg: '#FFF7ED', fg: '#C2410C' },
  credit: { bg: '#ECFDF5', fg: '#047857' },
  clear: { bg: '#F1F5F9', fg: '#334155' },
} as const;

/** The paid date as an ISO time: today means "now" (the database stamps it); an earlier day is taken at midday. */
export function paidAtFor(dateKey: string, today: string = todayKey()): string | null {
  if (!dateKey || dateKey === today) return null;
  const d = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The pupil's Earnings tab: what they owe or have in credit, the payments recorded, and a way to record
 * one. Payments are taken outside the app (cash, bank transfer, a card reader); the app only keeps the
 * record. A payment entered while completing a lesson appears here too and is edited from the lesson.
 */
export function PaymentsCard({ student }: { student: { id: string; name: string; hourly_rate?: number | null } }) {
  const { user } = useAuth();
  const { payments, balance, loading, error } = usePaymentLedger(student.id);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [date, setDate] = useState(todayKey());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const attemptId = useRef<string>(newAttemptId());
  // "Also add hours to their wallet": the hours default to what the amount buys at their rate, and can be changed.
  const [addHours, setAddHours] = useState(false);
  const [hoursText, setHoursText] = useState<string | null>(null);
  const blockAttemptId = useRef<string>(newAttemptId());
  // Packages from Pricing & packages: choosing the one that was paid for gives the hours (and the price as the amount).
  const [packages, setPackages] = useState<LessonPackage[]>([]);
  const [packageId, setPackageId] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !addHours) return;
    let alive = true;
    listLessonPackages({ activeOnly: true })
      .then((list) => { if (alive) setPackages(usablePackages(list)); })
      .catch(() => { if (alive) setPackages([]); });
    return () => { alive = false; };
  }, [open, addHours]);
  const chosenPackage = packages.find((p) => p.id === packageId) || null;
  const packageDeal = chosenPackage ? packageTopUp(chosenPackage) : null;
  const choosePackage = (id: string | null) => {
    setFormError(null);
    setPackageId(id);
    const pkg = packages.find((p) => p.id === id);
    if (pkg) setAmount(String(packageTopUp(pkg).amount));
  };

  // Changing the date a payment was received (e.g. entered late, or on the wrong day).
  const [dateEditId, setDateEditId] = useState<string | null>(null);
  const [dateEditValue, setDateEditValue] = useState('');
  const [dateEditError, setDateEditError] = useState<string | null>(null);

  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<string | null>(null);

  // Payment reminder: only when the pupil owes money. The backend decides if another may be sent yet.
  const [reminderStatus, setReminderStatus] = useState<ReminderStatus | null>(null);
  const [reminding, setReminding] = useState(false);
  const [reminderMessage, setReminderMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const owing = (balance?.outstanding ?? 0) > 0;
  useEffect(() => {
    if (!owing) { setReminderStatus(null); return; }
    let cancelled = false;
    getReminderStatus(student.id).then((s) => { if (!cancelled) setReminderStatus(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [student.id, owing, balance?.outstanding]);

  const remind = async () => {
    setReminding(true);
    setReminderMessage(null);
    try {
      const r = await sendPaymentReminder(student.id);
      setReminderMessage({ ok: true, text: reminderSuccessMessage(student.name.split(' ')[0], r.channel) });
      setReminderStatus(await getReminderStatus(student.id).catch(() => reminderStatus));
    } catch (e) {
      setReminderMessage({ ok: false, text: reminderErrorMessage(e) });
    } finally {
      setReminding(false);
    }
  };

  const bal = describeBalance(balance?.outstanding);
  const tone = TONE[bal.kind];
  const parsed = parseAmount(amount);
  const hoursShown = hoursText ?? suggestWalletHours(parsed, student.hourly_rate);
  const hoursParsed = !addHours ? null : packageDeal ? packageDeal.hours : parseWalletHours(hoursShown);
  const canSave = parsed !== null && method !== null && !saving && (!addHours || hoursParsed !== null);

  const openForm = () => {
    setAmount('');
    setMethod(null);
    setDate(todayKey());
    setReference('');
    setNote('');
    setFormError(null);
    attemptId.current = newAttemptId();
    blockAttemptId.current = newAttemptId();
    setAddHours(false);
    setHoursText(null);
    setPackageId(null);
    setOpen(true);
  };

  const save = async () => {
    if (parsed === null || method === null) return;
    setSaving(true);
    setFormError(null);
    try {
      const recorded = await recordPayment({
        id: attemptId.current,
        studentId: student.id,
        amount: parsed,
        method,
        paidAt: paidAtFor(date),
        reference: reference.trim() || null,
        note: note.trim() || null,
      });
      if (addHours && hoursParsed !== null) {
        try {
          await purchaseBlock({
            id: blockAttemptId.current,
            student_id: student.id,
            hours_paid: hoursParsed,
            amount: 0,
            payment_id: recorded?.id ?? null,
            payment_method: method === 'bank_transfer' || method === 'card' || method === 'cash' ? method : null,
            notes: packageDeal ? packageDeal.notes : 'Added with a payment',
          });
        } catch (e: any) {
          // A retry of the same attempt is refused as a duplicate: the hours did land.
          if (!(e?.code === '23505' || /duplicate key/i.test(e?.message || ''))) {
            bump();
            setFormError(`The payment is recorded, but the hours weren't added: ${paymentErrorMessage(e)} Tap the button again to add them (the payment won't be recorded twice).`);
            return;
          }
        }
      }
      setOpen(false);
      bump();
    } catch (e) {
      setFormError(paymentErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const doVoid = async (p: PaymentRow) => {
    setRowBusy(p.id);
    setRowMessage(null);
    try {
      await voidPayment(p.id, null);
      setVoidingId(null);
      bump();
    } catch (e) {
      setRowMessage(paymentErrorMessage(e));
    } finally {
      setRowBusy(null);
    }
  };

  const startDateEdit = (p: PaymentRow) => {
    setVoidingId(null);
    setRowMessage(null);
    setDateEditError(null);
    setDateEditValue(paymentDateKey(p.paid_at));
    setDateEditId(p.id);
  };

  const saveDateEdit = async (p: PaymentRow) => {
    const paidAt = paidAtForDay(dateEditValue);
    if (!paidAt) { setDateEditError('Pick the date the payment was received.'); return; }
    if (isFutureDay(dateEditValue, todayKey())) { setDateEditError('A payment can’t be dated in the future.'); return; }
    setRowBusy(p.id);
    setDateEditError(null);
    try {
      await updatePaymentDate(p.id, paidAt);
      setDateEditId(null);
      bump();
    } catch (e) {
      setDateEditError(paymentErrorMessage(e));
    } finally {
      setRowBusy(null);
    }
  };

  const receipt = async (p: PaymentRow) => {
    setRowBusy(p.id);
    setRowMessage(null);
    try {
      let school: Awaited<ReturnType<typeof getMySchoolProfile>> = null;
      try { school = await getMySchoolProfile(); } catch { /* falls back to the instructor's name */ }
      const issuedAt = new Date();
      const html = buildReceiptHtml({
        receiptNo: p.id.slice(0, 8).toUpperCase(),
        amount: p.amount,
        method: p.method,
        paidAt: p.paid_at,
        reference: p.reference,
        note: p.note,
        studentName: student.name,
        instructorName: user?.name || 'Your instructor',
        instructorEmail: user?.email || null,
        issuedAt,
        schoolName: school?.business_name,
        schoolLogoUrl: school?.logo_url,
        schoolContactEmail: school?.contact_email,
        schoolContactPhone: school?.contact_phone,
        schoolAddress: school?.address,
      });
      const result = await generateAndSharePdf(html, `Receipt-${p.id.slice(0, 8).toUpperCase()}.pdf`, 'receipt');
      if (!result.ok) setRowMessage(`Could not make the receipt. ${result.error || 'Please try again.'}`);
    } catch (e: any) {
      setRowMessage(`Could not make the receipt. ${e?.message || 'Please try again.'}`);
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <>
      <Card style={{ gap: 12 }} testID="payments-card">
        <View style={[styles.balance, { backgroundColor: tone.bg }]} testID="payments-balance">
          <Text style={[styles.balanceLabel, { color: tone.fg }]}>{loading && !balance ? 'Loading…' : bal.label}</Text>
          {!!balance && (
            <Text style={styles.balanceSub}>
              Charged {formatGbp(balance.charged)} · Paid {formatGbp(balance.paid)}
            </Text>
          )}
        </View>

        <TouchableOpacity style={styles.recordBtn} onPress={openForm} testID="btn-record-payment">
          <Plus size={18} color="#fff" />
          <Text style={styles.recordBtnText}>Record a payment</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          For money you have been given outside the app: cash, a bank transfer or a card reader. The app doesn&apos;t take payments.
        </Text>

        {bal.kind === 'owes' && (
          <View style={{ gap: 6 }} testID="reminder-section">
            <TouchableOpacity
              style={[styles.remindBtn, (!reminderStatus?.can_send || reminding) && { opacity: 0.5 }]}
              onPress={remind}
              disabled={!reminderStatus?.can_send || reminding}
              testID="btn-send-reminder"
            >
              {reminding ? <ActivityIndicator color={theme.colors.primary} /> : (<><Bell size={16} color={theme.colors.primary} /><Text style={styles.remindBtnText}>Send payment reminder</Text></>)}
            </TouchableOpacity>
            {reminderStatus && !reminderStatus.reachable && (
              <Text style={styles.hint} testID="reminder-unreachable">
                {student.name.split(' ')[0]} has no app login or email address, so a reminder can&apos;t be sent. Contact them directly.
              </Text>
            )}
            {!!reminderHistoryLine(reminderStatus) && <Text style={styles.hint} testID="reminder-history">{reminderHistoryLine(reminderStatus)}</Text>}
            {!!reminderMessage && (
              <Text style={[styles.hint, { color: reminderMessage.ok ? '#047857' : theme.colors.danger }]} testID="reminder-message">{reminderMessage.text}</Text>
            )}
            <Text style={styles.hint}>Sends a notification to their phone, or an email if they don&apos;t have the app. It doesn&apos;t show the amount on their lock screen.</Text>
          </View>
        )}

        {!!error && <Text style={styles.error} testID="payments-error">{error}</Text>}
        {!!rowMessage && <Text style={styles.error} testID="payments-row-error">{rowMessage}</Text>}

        <Text style={styles.sectionLabel}>Payments</Text>
        {payments.length === 0 && !loading ? (
          <Text style={styles.empty} testID="payments-empty">No payments recorded yet.</Text>
        ) : (
          payments.map((p) => {
            const voided = !!p.voided_at;
            const derived = p.source === 'lesson' || p.source === 'migrated';
            return (
              <View key={p.id} style={styles.row} testID={`payment-${p.id}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.amount, voided && styles.struck]}>{formatGbp(p.amount)}</Text>
                  <Text style={styles.sub} numberOfLines={2}>
                    {paymentSubline(p)}{derived ? ' · from the lesson' : ''}{voided ? ' · voided' : ''}
                  </Text>
                  {!!p.covered_by_prepaid && !voided && (
                    <Text style={styles.sub} testID={`payment-covered-${p.id}`}>
                      Paid from prepaid hours: the prepaid hours are the money, so this is not counted again.
                    </Text>
                  )}
                  {!!p.note && !derived && <Text style={styles.sub} numberOfLines={2}>{p.note}</Text>}
                  {!!p.date_changed_at && !!p.original_paid_at && (
                    <Text style={styles.sub} testID={`payment-date-changed-${p.id}`}>Date changed (first recorded {paymentDate(p.original_paid_at)})</Text>
                  )}
                  {dateEditId === p.id && (
                    <View style={{ gap: 6, marginTop: 6 }} testID={`date-edit-${p.id}`}>
                      <DateField value={dateEditValue} onChange={(v) => { setDateEditValue(v); setDateEditError(null); }} testID={`input-date-edit-${p.id}`} />
                      {!!dateEditError && <Text style={styles.error} testID={`date-edit-error-${p.id}`}>{dateEditError}</Text>}
                      <View style={styles.confirmRow}>
                        <TouchableOpacity onPress={() => saveDateEdit(p)} disabled={rowBusy === p.id} testID={`btn-date-save-${p.id}`}>
                          <Text style={styles.actionText}>{rowBusy === p.id ? 'Saving…' : 'Save date'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setDateEditId(null)} testID={`btn-date-cancel-${p.id}`}>
                          <Text style={[styles.actionText, { color: theme.colors.textMuted }]}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
                {!voided && (
                  <View style={styles.actions}>
                    <TouchableOpacity onPress={() => receipt(p)} disabled={rowBusy === p.id} testID={`btn-receipt-${p.id}`} style={styles.actionBtn}>
                      {rowBusy === p.id ? <ActivityIndicator size="small" color={theme.colors.primary} /> : (<><FileText size={14} color={theme.colors.primary} /><Text style={styles.actionText}>Receipt</Text></>)}
                    </TouchableOpacity>
                    {dateEditId !== p.id && (
                      <TouchableOpacity onPress={() => startDateEdit(p)} testID={`btn-change-date-${p.id}`}>
                        <Text style={styles.actionText}>Change date</Text>
                      </TouchableOpacity>
                    )}
                    {!derived && (voidingId === p.id ? (
                      <View style={styles.confirmRow}>
                        <TouchableOpacity onPress={() => doVoid(p)} disabled={rowBusy === p.id} testID={`btn-void-yes-${p.id}`}>
                          <Text style={[styles.actionText, { color: theme.colors.danger }]}>Yes, void</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setVoidingId(null)} testID={`btn-void-no-${p.id}`}>
                          <Text style={styles.actionText}>Keep</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => setVoidingId(p.id)} testID={`btn-void-${p.id}`}>
                        <Text style={[styles.actionText, { color: theme.colors.danger }]}>Void</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}
      </Card>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={`Payment from ${student.name.split(' ')[0]}`} testID="sheet-record-payment">
        <Text style={styles.label}>Amount (£)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={(t) => { setAmount(t); setFormError(null); }}
          keyboardType="decimal-pad"
          placeholder="e.g. 36.00"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-payment-amount"
        />
        <Text style={styles.label}>How was it paid?</Text>
        <View style={styles.chips}>
          {PAYMENT_METHOD_CHOICES.map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[styles.chip, method === m.key && styles.chipActive]}
              onPress={() => { setMethod(m.key); setFormError(null); }}
              testID={`payment-method-${m.key}`}
            >
              <Text style={[styles.chipText, method === m.key && styles.chipTextActive]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>Date paid</Text>
        <DateField value={date} onChange={setDate} testID="input-payment-date" />
        <Text style={styles.label}>Reference (optional)</Text>
        <TextInput
          style={styles.input}
          value={reference}
          onChangeText={setReference}
          maxLength={80}
          placeholder="e.g. the bank transfer reference"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-payment-reference"
        />
        <Text style={styles.label}>Note (optional)</Text>
        <TextInput
          style={[styles.input, { height: 64, paddingTop: 10 }]}
          value={note}
          onChangeText={setNote}
          maxLength={300}
          multiline
          placeholderTextColor={theme.colors.textMuted}
          testID="input-payment-note"
        />
        <Text style={styles.hint} testID="payment-wallet-note">
          Paid for a package or hours? Tick the box below to add them to the wallet. Don&apos;t also use Add hours in the wallet, or the money is counted twice.
        </Text>
        <TouchableOpacity
          style={styles.toggleRow}
          onPress={() => { setAddHours((v) => !v); setFormError(null); }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: addHours }}
          testID="toggle-add-hours"
        >
          <View style={[styles.box, addHours && styles.boxOn]}>{addHours && <Text style={styles.tick}>✓</Text>}</View>
          <Text style={styles.toggleText}>Also add hours to {student.name.split(' ')[0]}&apos;s wallet</Text>
        </TouchableOpacity>
        {addHours && (
          <>
            {packages.length > 0 && (
              <>
                <Text style={styles.label}>Which package was paid for?</Text>
                <View style={styles.chips}>
                  <TouchableOpacity
                    style={[styles.chip, !packageId && styles.chipActive]}
                    onPress={() => choosePackage(null)}
                    testID="pay-pkg-custom"
                  >
                    <Text style={[styles.chipText, !packageId && styles.chipTextActive]}>Custom hours</Text>
                  </TouchableOpacity>
                  {packages.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.chip, packageId === p.id && styles.chipActive]}
                      onPress={() => choosePackage(p.id)}
                      testID={`pay-pkg-${p.id}`}
                    >
                      <Text style={[styles.chipText, packageId === p.id && styles.chipTextActive]}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            {chosenPackage ? (
              <Text style={styles.hint} testID="pay-package-summary">{describePackageTopUp(chosenPackage)}. The amount above is set to the package price; change it if they paid something different.</Text>
            ) : (
              <>
                <Text style={styles.label}>Hours to add</Text>
                <TextInput
                  style={styles.input}
                  value={hoursShown}
                  onChangeText={(t) => { setHoursText(t); setFormError(null); }}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 4"
                  placeholderTextColor={theme.colors.textMuted}
                  testID="input-wallet-hours"
                />
                <Text style={styles.hint}>
                  {student.hourly_rate ? `Worked out at £${student.hourly_rate}/hr; change it if they paid for a different amount. ` : ''}
                  The hours go into their wallet and use up as lessons are completed. The money is counted once, in this payment.
                </Text>
              </>
            )}
          </>
        )}
        {!!formError && <Text style={styles.error} testID="payment-form-error">{formError}</Text>}
        <TouchableOpacity style={[styles.saveBtn, !canSave && { opacity: 0.45 }]} onPress={save} disabled={!canSave} testID="btn-save-payment">
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{parsed !== null ? `Record ${formatGbp(parsed)}` : 'Record payment'}</Text>}
        </TouchableOpacity>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  balance: { borderRadius: 14, padding: 14, gap: 2 },
  balanceLabel: { fontSize: 24, fontWeight: '800' },
  balanceSub: { fontSize: 12.5, color: theme.colors.textMuted },
  recordBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 12, backgroundColor: theme.colors.primary },
  recordBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hint: { fontSize: 12, color: theme.colors.textMuted, lineHeight: 17 },
  remindBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.primary },
  remindBtnText: { color: theme.colors.primary, fontWeight: '700', fontSize: 14.5 },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: theme.colors.textMuted, marginTop: 4 },
  empty: { fontSize: 13, color: theme.colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.border },
  amount: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  struck: { textDecorationLine: 'line-through', color: theme.colors.textMuted },
  sub: { fontSize: 12.5, color: theme.colors.textMuted },
  actions: { alignItems: 'flex-end', gap: 6 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 },
  actionText: { fontSize: 12.5, fontWeight: '700', color: theme.colors.primary },
  confirmRow: { flexDirection: 'row', gap: 12 },
  error: { fontSize: 13, color: theme.colors.danger, lineHeight: 18 },
  label: { fontSize: 12.5, fontWeight: '600', color: theme.colors.text, marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, color: theme.colors.text, backgroundColor: theme.colors.background },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13.5, fontWeight: '600', color: theme.colors.text },
  chipTextActive: { color: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, minHeight: 40 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  tick: { color: '#fff', fontWeight: '800', fontSize: 14, lineHeight: 16 },
  toggleText: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.colors.text },
  saveBtn: { marginTop: 16, height: 50, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
