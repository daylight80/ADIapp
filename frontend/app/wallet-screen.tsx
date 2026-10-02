import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, PoundSterling, Clock, Plus, Minus, Receipt, Lock } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { isProTier } from '../src/tiers';
import { PaywallModal } from '../src/PaywallModal';
import {
  useBlockBookings,
  purchaseBlock,
  useStudentByEmail,
  useStudentByAuthId,
  useStudent,
  useLessonsForStudent,
  bump,
} from '../src/useSupabaseData';
import { Card, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import {
  PAYMENT_METHODS, MIN_ADD_HOURS, MAX_ADD_HOURS, stepAddHours, topUpAmount, describeTopUp,
  topUpConfirmation, canAddHours, runTopUp, newAttemptId, type PaymentMethod,
} from '../src/walletTopUp';
import { formatHoursLabel } from '../src/voucher';

export default function WalletScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams();

  // -----------------------------------------------------------------------
  // Resolve the student row.
  //   • If a Supabase student UUID is passed (instructor → Wallet flow), use it.
  //   • Otherwise, try Supabase Auth uid lookup (post Migration 004).
  //   • Otherwise, fall back to email lookup against Supabase students.
  //   • Otherwise, no real link found — see noRealLinkFound below.
  // -----------------------------------------------------------------------
  const passedId = (params.studentId as string) || '';
  const isPassedSupabaseUuid = /^[0-9a-f-]{36}$/i.test(passedId);
  const { student: sbStudentByAuth } = useStudentByAuthId(!passedId ? user?.id : undefined);
  const { student: sbStudentByEmail } = useStudentByEmail(
    !passedId && !sbStudentByAuth ? user?.email : undefined,
  );
  const supabaseStudent = isPassedSupabaseUuid ? undefined : (sbStudentByAuth || sbStudentByEmail);

  // Same principle as student-home-screen: a real logged-in user (user
  // exists) whose own link is missing is a genuine problem, not a reason
  // to silently show them a hardcoded demo student's identity/rate as if
  // it were their own. Mock fallback removed entirely (3 Sept 2026), per
  // Grant directly — already confirmed safe (mock IDs like 's2' never
  // collide with a real UUID), but he wanted it gone regardless.
  const studentId = isPassedSupabaseUuid ? passedId : supabaseStudent?.id;
  const noRealLinkFound = !isPassedSupabaseUuid && !!user && !supabaseStudent;

  // Block booking & wallet management is Pro+ (1 Sept 2026, tier-gating
  // audit) — wallet-screen.tsx had zero gating at all. Deliberately scoped
  // to ONLY the instructor-initiated flow (isPassedSupabaseUuid true, i.e.
  // an instructor opened a specific student's wallet to manage it) — this
  // screen is genuinely dual-purpose, and a student viewing their OWN
  // wallet balance must never be affected by their instructor's
  // subscription tier. Gating the whole screen by tier would have broken
  // that student-facing case, which isn't the tier-gated capability here.
  const isInstructorManaging = isPassedSupabaseUuid;
  const pro = isProTier(user?.tier);
  const [walletPaywallOpen, setWalletPaywallOpen] = useState(false);

  // When an instructor opens a student's wallet, load THAT student. This used to
  // show the instructor's own name and a hardcoded rate, because only the
  // student's own sign-in was ever looked up. Adding hours needs the real
  // student's name and rate (the amount is hours x their rate).
  const { student: managedStudent } = useStudent(isPassedSupabaseUuid ? passedId : undefined);
  const resolvedStudent = isPassedSupabaseUuid ? managedStudent : supabaseStudent;
  const student = resolvedStudent
    ? { id: resolvedStudent.id, name: resolvedStudent.name, hourly_rate: resolvedStudent.hourly_rate as number | null }
    : { id: studentId || '', name: user?.name || 'Learner', hourly_rate: null as number | null };

  // -----------------------------------------------------------------------
  // Live data from Supabase.
  // -----------------------------------------------------------------------
  const { bookings, loading: bookingsLoading } = useBlockBookings(studentId);
  const { lessons: sbLessons } = useLessonsForStudent(resolvedStudent ? studentId : undefined);
  const lessons = useMemo(() => (sbLessons || []).filter((l) => l.amount_paid), [sbLessons]);

  // Wallet balance is derived client-side from the bookings array.
  const wallet = useMemo(() => {
    const hours_remaining = bookings.reduce((s, b) => s + (b.hours_paid - b.hours_used), 0);
    const total_paid = bookings.reduce((s, b) => s + b.amount, 0);
    return { hours_remaining, total_paid };
  }, [bookings]);

  const [buyOpen, setBuyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [hoursToAdd, setHoursToAdd] = useState(MIN_ADD_HOURS);
  // One id per top-up attempt, reused if the instructor retries after a stall, so a
  // first try that did land can't be added a second time. Changing the hours or the
  // payment method makes it a different top-up, so the id is dropped.
  const attemptId = useRef<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const resetAttempt = () => { attemptId.current = null; setSheetError(null); };
  const amountToRecord = topUpAmount(hoursToAdd, student.hourly_rate);

  const closeSheet = () => { setBuyOpen(false); setPaymentMethod(null); setHoursToAdd(MIN_ADD_HOURS); resetAttempt(); };

  const addHours = async () => {
    if (!studentId) {
      Alert.alert('No student found', 'This wallet isn\u2019t linked to a real student yet.');
      return;
    }
    if (!paymentMethod) {
      Alert.alert('Choose a payment method', 'Pick Bank Transfer, Card, or Cash to record how they paid.');
      return;
    }
    if (student.hourly_rate == null) {
      Alert.alert('Student not loaded', 'Please wait a moment for the student\u2019s details to load, then try again.');
      return;
    }
    setSheetError(null);
    setBusy(true);
    if (!attemptId.current) attemptId.current = newAttemptId();
    const id = attemptId.current;
    try {
      // Gives up after 15 seconds instead of spinning forever. A save that times out may
      // still land, which is why the attempt id (above) makes a retry safe.
      const result = await runTopUp(() =>
        purchaseBlock({ id, student_id: studentId, hours_paid: hoursToAdd, amount: amountToRecord, payment_method: paymentMethod }),
      );
      if (result.status === 'saved') {
        const message = topUpConfirmation(student.name, hoursToAdd, amountToRecord, paymentMethod);
        closeSheet();
        Alert.alert('Hours added', message);
      } else if (result.status === 'already') {
        // The earlier try had landed after all: nothing more to add.
        bump();
        closeSheet();
        Alert.alert('Hours added', result.message);
      } else {
        if (result.status === 'timeout') bump(); // refresh the list so a late save shows up
        setSheetError(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (noRealLinkFound) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          <Text style={{ ...theme.font.h2, textAlign: 'center' }}>We couldn&apos;t find your student profile</Text>
          <Text style={{ color: theme.colors.textMuted, textAlign: 'center' }}>
            Your account isn&apos;t linked to a student record yet. Please contact your instructor.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.title}>Payment Wallet</Text>
          {isInstructorManaging && !!resolvedStudent && (
            <Text style={{ fontSize: 12.5, color: theme.colors.textMuted, marginTop: 1 }} testID="wallet-student-name">{student.name}</Text>
          )}
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.hero}>
          <Text style={styles.heroLabel}>Hours remaining</Text>
          <Text style={styles.heroValue} testID="wallet-hours">{wallet.hours_remaining.toFixed(1)}h</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroStat}>
              <PoundSterling size={16} color={theme.colors.accent} />
              <Text style={styles.heroStatText}>Total paid: £{wallet.total_paid}</Text>
            </View>
            <View style={styles.heroStat}>
              <Clock size={16} color={theme.colors.primary} />
              <Text style={styles.heroStatText}>Bookings: {bookings.length}</Text>
            </View>
          </View>
        </Card>

        {isInstructorManaging && (
          <TouchableOpacity
            style={[styles.buyBtn, !pro && { backgroundColor: theme.colors.textMuted }]}
            onPress={() => (!pro ? setWalletPaywallOpen(true) : setBuyOpen(true))}
            testID="btn-add-hours"
          >
            {!pro ? <Lock size={16} color="#fff" /> : <Plus size={18} color="#fff" />}
            <Text style={styles.buyBtnText}>Add hours</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.section}>Prepaid hours</Text>
        {bookingsLoading ? (
          <Card><ActivityIndicator size="small" color={theme.colors.primary} /></Card>
        ) : bookings.length === 0 ? (
          <Card><Text style={styles.empty}>No hours added yet.</Text></Card>
        ) : (
          bookings.map((b) => (
            <Card key={b.id} testID={`booking-${b.id}`}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bookHours}>{formatHoursLabel(b.hours_paid)} added</Text>
                  <Text style={styles.bookMeta}>
                    Added {new Date(b.purchased_at).toLocaleDateString('en-GB')} · {(b.hours_paid - b.hours_used).toFixed(1)}h left
                  </Text>
                </View>
                <Badge label={`£${b.amount}`} bg={theme.colors.primaryLight} color={theme.colors.primary} />
              </View>
            </Card>
          ))
        )}

        <Text style={styles.section}>VAT receipts</Text>
        {lessons.length === 0 ? (
          <Card><Text style={styles.empty}>No paid lessons yet.</Text></Card>
        ) : (
          lessons.map((l) => (
            <Card key={l.id} testID={`receipt-${l.id}`}>
              <View style={styles.row}>
                <Receipt size={20} color={theme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bookHours}>{l.topic}</Text>
                  <Text style={styles.bookMeta}>
                    {new Date(l.date).toLocaleDateString('en-GB')} · £{l.amount_paid} (inc. 20% VAT)
                  </Text>
                </View>
              </View>
            </Card>
          ))
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <BottomSheet visible={buyOpen} onClose={closeSheet} title={`Add time for ${student.name}`} testID="sheet-add-hours">
        <Text style={styles.pmLabel}>Add time</Text>
        <View style={styles.stepperRow}>
          <TouchableOpacity
            style={[styles.stepBtn, hoursToAdd <= MIN_ADD_HOURS && { opacity: 0.35 }]}
            onPress={() => { resetAttempt(); setHoursToAdd((h) => stepAddHours(h, -1)); }}
            disabled={hoursToAdd <= MIN_ADD_HOURS || busy}
            accessibilityLabel="One hour less"
            testID="btn-hours-minus"
          >
            <Minus size={20} color={theme.colors.primary} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center', minWidth: 110 }}>
            <Text style={styles.stepValue} testID="hours-to-add">{hoursToAdd}</Text>
            <Text style={styles.stepUnit}>{hoursToAdd === 1 ? 'hour' : 'hours'}</Text>
          </View>
          <TouchableOpacity
            style={[styles.stepBtn, hoursToAdd >= MAX_ADD_HOURS && { opacity: 0.35 }]}
            onPress={() => { resetAttempt(); setHoursToAdd((h) => stepAddHours(h, 1)); }}
            disabled={hoursToAdd >= MAX_ADD_HOURS || busy}
            accessibilityLabel="One hour more"
            testID="btn-hours-plus"
          >
            <Plus size={20} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.pmHelp} testID="top-up-summary">
          {student.hourly_rate == null ? 'Loading the student\u2019s rate\u2026' : describeTopUp(hoursToAdd, student.hourly_rate)}
        </Text>

        <Text style={styles.pmLabel}>Payment method</Text>
        <View style={styles.pmRow}>
          {PAYMENT_METHODS.map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[styles.pmChip, paymentMethod === m.key && styles.pmChipActive]}
              onPress={() => { resetAttempt(); setPaymentMethod(paymentMethod === m.key ? null : m.key); }}
              testID={`pm-${m.key}`}
            >
              <Text style={[styles.pmChipText, paymentMethod === m.key && { color: '#fff', fontWeight: '700' }]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {!paymentMethod && <Text style={styles.pmHelp}>Choose how they paid to continue.</Text>}
        {!!sheetError && <Text style={styles.sheetError} testID="top-up-error">{sheetError}</Text>}

        <TouchableOpacity
          style={[styles.confirmBtn, (busy || !canAddHours(studentId, paymentMethod) || student.hourly_rate == null) && { opacity: 0.45 }]}
          onPress={addHours}
          disabled={busy || !canAddHours(studentId, paymentMethod) || student.hourly_rate == null}
          testID="btn-confirm-add-hours"
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmBtnText}>Add {formatHoursLabel(hoursToAdd)}</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <PaywallModal
        visible={walletPaywallOpen}
        onClose={() => setWalletPaywallOpen(false)}
        reason="Block booking and wallet management is available from Pro tier."
        targetTier="pro"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  scroll: { padding: 16, gap: 14, paddingBottom: 32 },
  hero: { gap: 8 },
  heroLabel: { ...theme.font.caption },
  heroValue: { fontSize: 36, fontWeight: '800', color: theme.colors.primary },
  heroRow: { flexDirection: 'row', gap: 16, marginTop: 4 },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroStatText: { fontSize: 13, color: theme.colors.text, fontWeight: '600' },
  buyBtn: { backgroundColor: theme.colors.accent, height: 50, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buyBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  section: { ...theme.font.h3, marginTop: 4 },
  empty: { color: theme.colors.textMuted, textAlign: 'center', padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bookHours: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  bookMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginVertical: 8 },
  stepBtn: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  stepValue: { fontSize: 44, fontWeight: '800', color: theme.colors.primary, lineHeight: 50 },
  stepUnit: { fontSize: 13, color: theme.colors.textMuted, fontWeight: '600' },
  sheetError: { color: theme.colors.danger, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 10, lineHeight: 18 },
  confirmBtn: { backgroundColor: theme.colors.accent, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  pmLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginBottom: 6, marginTop: 4 },
  pmRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  pmChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  pmChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  pmChipText: { fontSize: 13, color: theme.colors.text },
  pmHelp: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', marginTop: 6 },
});
