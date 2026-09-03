import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, PoundSterling, Clock, Plus, Receipt, Lock } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { isProTier } from '../src/tiers';
import { PaywallModal } from '../src/PaywallModal';
import {
  useBlockBookings,
  purchaseBlock,
  useStudentByEmail,
  useStudentByAuthId,
  useLessonsForStudent,
} from '../src/useSupabaseData';
import { Card, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import { listLessonPackages, LessonPackage } from '../src/supabaseDb';

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

  const student = supabaseStudent
    ? { id: supabaseStudent.id, name: supabaseStudent.name, hourly_rate: supabaseStudent.hourly_rate ?? 38 }
    : { id: studentId || '', name: user?.name || 'Learner', hourly_rate: 38 };

  // -----------------------------------------------------------------------
  // Live data from Supabase.
  // -----------------------------------------------------------------------
  const { bookings, loading: bookingsLoading } = useBlockBookings(studentId);
  const { lessons: sbLessons } = useLessonsForStudent(supabaseStudent ? studentId : undefined);
  const lessons = useMemo(() => (sbLessons || []).filter((l) => l.amount_paid), [sbLessons]);

  // Wallet balance is derived client-side from the bookings array.
  const wallet = useMemo(() => {
    const hours_remaining = bookings.reduce((s, b) => s + (b.hours_paid - b.hours_used), 0);
    const total_paid = bookings.reduce((s, b) => s + b.amount, 0);
    return { hours_remaining, total_paid };
  }, [bookings]);

  const [buyOpen, setBuyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'card' | 'cash' | null>(null);
  const [packages, setPackages] = useState<LessonPackage[]>([]);

  useEffect(() => {
    let active = true;
    listLessonPackages({ activeOnly: true })
      .then((rows) => { if (active) setPackages(rows.filter((p) => p.price != null)); })
      .catch(() => { if (active) setPackages([]); });
    return () => { active = false; };
  }, []);

  const buy = async (hours: number, amount: number) => {
    if (!paymentMethod) {
      Alert.alert('Choose a payment method', 'Pick Bank Transfer, Card, or Cash to record this purchase.');
      return;
    }
    setBusy(true);
    try {
      await purchaseBlock({ student_id: studentId, hours_paid: hours, amount, payment_method: paymentMethod });
      setBuyOpen(false);
      setPaymentMethod(null);
      Alert.alert('Block booked', `${hours} hours added for £${amount} (${paymentMethodLabel(paymentMethod)}). A VAT receipt is available below.`);
    } catch (e: any) {
      Alert.alert('Purchase failed', e?.message || 'Could not add the block booking.');
    } finally {
      setBusy(false);
    }
  };

  if (noRealLinkFound) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          <Text style={{ ...theme.font.h2, textAlign: 'center' }}>We couldn't find your student profile</Text>
          <Text style={{ color: theme.colors.textMuted, textAlign: 'center' }}>
            Your account isn't linked to a student record yet. Please contact your instructor.
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
        <Text style={styles.title}>Payment Wallet</Text>
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

        <TouchableOpacity
          style={[styles.buyBtn, isInstructorManaging && !pro && { backgroundColor: theme.colors.textMuted }]}
          onPress={() => (isInstructorManaging && !pro) ? setWalletPaywallOpen(true) : setBuyOpen(true)}
          testID="btn-buy-block"
        >
          {isInstructorManaging && !pro ? <Lock size={16} color="#fff" /> : <Plus size={18} color="#fff" />}
          <Text style={styles.buyBtnText}>Buy block booking</Text>
        </TouchableOpacity>

        <Text style={styles.section}>Block bookings</Text>
        {bookingsLoading ? (
          <Card><ActivityIndicator size="small" color={theme.colors.primary} /></Card>
        ) : bookings.length === 0 ? (
          <Card><Text style={styles.empty}>No block bookings yet.</Text></Card>
        ) : (
          bookings.map((b) => (
            <Card key={b.id} testID={`booking-${b.id}`}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bookHours}>{b.hours_paid}h block</Text>
                  <Text style={styles.bookMeta}>
                    Purchased {new Date(b.purchased_at).toLocaleDateString('en-GB')} · {(b.hours_paid - b.hours_used).toFixed(1)}h left
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

      <BottomSheet visible={buyOpen} onClose={() => { setBuyOpen(false); setPaymentMethod(null); }} title="Buy a block booking" testID="sheet-buy-block">
        <Text style={styles.hint}>Save money by purchasing lessons in advance. Includes a VAT receipt.</Text>

        <Text style={styles.pmLabel}>Payment method</Text>
        <View style={styles.pmRow}>
          {([
            { key: 'bank_transfer', label: 'Bank Transfer' },
            { key: 'card',          label: 'Card' },
            { key: 'cash',          label: 'Cash' },
          ] as const).map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[styles.pmChip, paymentMethod === m.key && styles.pmChipActive]}
              onPress={() => setPaymentMethod(paymentMethod === m.key ? null : m.key)}
              testID={`pm-${m.key}`}
            >
              <Text style={[styles.pmChipText, paymentMethod === m.key && { color: '#fff', fontWeight: '700' }]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {packages.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 18 }}>
            <Text style={{ fontSize: 13, color: theme.colors.textMuted, textAlign: 'center' }}>
              Your instructor hasn't published any priced packages yet. Please contact them to top up your hours.
            </Text>
          </Card>
        ) : (
          packages.map((opt) => (
            <TouchableOpacity
              key={opt.id}
              style={[styles.blockCard, (busy || !paymentMethod) && { opacity: 0.45 }]}
              onPress={() => !busy && paymentMethod && buy(opt.hours, opt.price as number)}
              disabled={busy || !paymentMethod}
              testID={`block-${opt.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.blockHours}>
                  {opt.name}{opt.topic_tag ? ` · ${opt.topic_tag}` : ''}
                </Text>
                <Text style={styles.blockSaving}>
                  {opt.hours} hr{opt.hours === 1 ? '' : 's'} · £{((opt.price as number) / opt.hours).toFixed(2)}/hr
                </Text>
                {opt.description ? (
                  <Text style={[styles.blockSaving, { marginTop: 2 }]} numberOfLines={2}>{opt.description}</Text>
                ) : null}
              </View>
              <Text style={styles.blockPrice}>£{(opt.price as number).toFixed(2)}</Text>
            </TouchableOpacity>
          ))
        )}
        {!paymentMethod && (
          <Text style={styles.pmHelp}>Pick a payment method above to enable purchase.</Text>
        )}
        {busy && (
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        )}
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
  hint: { color: theme.colors.textMuted, marginBottom: 12 },
  blockCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  blockHours: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  blockSaving: { fontSize: 12, color: theme.colors.success, marginTop: 2 },
  blockPrice: { fontSize: 18, fontWeight: '800', color: theme.colors.primary },
  pmLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginBottom: 6, marginTop: 4 },
  pmRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  pmChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  pmChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  pmChipText: { fontSize: 13, color: theme.colors.text },
  pmHelp: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', marginTop: 6 },
});

function paymentMethodLabel(m: 'bank_transfer' | 'card' | 'cash'): string {
  return m === 'bank_transfer' ? 'Bank Transfer' : m === 'card' ? 'Card' : 'Cash';
}
