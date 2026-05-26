import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, PoundSterling, Clock, Plus, Receipt } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb } from '../src/mockDb';
import { useAuth } from '../src/AuthContext';
import {
  useBlockBookings,
  purchaseBlock,
  useStudentByEmail,
  useStudentByAuthId,
  useLessonsForStudent,
} from '../src/useSupabaseData';
import { Card, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';

const BLOCK_OPTIONS = [
  { hours: 5, price: 180 },
  { hours: 10, price: 340 },
  { hours: 20, price: 660 },
];

export default function WalletScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams();

  // -----------------------------------------------------------------------
  // Resolve the student row.
  //   • If a Supabase student UUID is passed (instructor → Wallet flow), use it.
  //   • Otherwise, try Supabase Auth uid lookup (post Migration 004).
  //   • Otherwise, fall back to email lookup against Supabase students.
  //   • Otherwise, fall back to the mockDb seed (legacy demo flow).
  // -----------------------------------------------------------------------
  const passedId = (params.studentId as string) || '';
  const isPassedSupabaseUuid = /^[0-9a-f-]{36}$/i.test(passedId);
  const { student: sbStudentByAuth } = useStudentByAuthId(!passedId ? user?.id : undefined);
  const { student: sbStudentByEmail } = useStudentByEmail(
    !passedId && !sbStudentByAuth ? user?.email : undefined,
  );
  const supabaseStudent = isPassedSupabaseUuid ? undefined : (sbStudentByAuth || sbStudentByEmail);

  const studentId = isPassedSupabaseUuid
    ? passedId
    : (supabaseStudent?.id
        || (user?.email ? mockDb.getStudentByEmail(user.email)?.id : undefined)
        || passedId
        || 's2');

  const mockStudent = mockDb.getStudent(studentId);
  const student = supabaseStudent
    ? { id: supabaseStudent.id, name: supabaseStudent.name, hourly_rate: supabaseStudent.hourly_rate ?? 38 }
    : mockStudent
      ? { id: mockStudent.id, name: mockStudent.name, hourly_rate: mockStudent.hourly_rate }
      : { id: studentId, name: user?.name || 'Learner', hourly_rate: 38 };

  // -----------------------------------------------------------------------
  // Live data from Supabase.
  // -----------------------------------------------------------------------
  const { bookings, loading: bookingsLoading } = useBlockBookings(studentId);
  const { lessons: sbLessons } = useLessonsForStudent(studentId);
  const lessons = useMemo(() => {
    if (sbLessons && sbLessons.length > 0) return sbLessons.filter((l) => l.amount_paid);
    // mockDb fallback (legacy demo)
    return mockDb.listLessonsForStudent(studentId).filter((l) => l.amount_paid);
  }, [sbLessons, studentId]);

  // Wallet balance is derived client-side from the bookings array.
  const wallet = useMemo(() => {
    const hours_remaining = bookings.reduce((s, b) => s + (b.hours_paid - b.hours_used), 0);
    const total_paid = bookings.reduce((s, b) => s + b.amount, 0);
    return { hours_remaining, total_paid };
  }, [bookings]);

  const [buyOpen, setBuyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const buy = async (hours: number, amount: number) => {
    setBusy(true);
    try {
      await purchaseBlock({ student_id: studentId, hours_paid: hours, amount });
      setBuyOpen(false);
      Alert.alert('Block booked', `${hours} hours added for £${amount}. A VAT receipt is available below.`);
    } catch (e: any) {
      Alert.alert('Purchase failed', e?.message || 'Could not add the block booking.');
    } finally {
      setBusy(false);
    }
  };

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

        <TouchableOpacity style={styles.buyBtn} onPress={() => setBuyOpen(true)} testID="btn-buy-block">
          <Plus size={18} color="#fff" />
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

      <BottomSheet visible={buyOpen} onClose={() => setBuyOpen(false)} title="Buy a block booking" testID="sheet-buy-block">
        <Text style={styles.hint}>Save money by purchasing lessons in advance. Includes a VAT receipt.</Text>
        {BLOCK_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.hours}
            style={[styles.blockCard, busy && { opacity: 0.5 }]}
            onPress={() => !busy && buy(opt.hours, opt.price)}
            disabled={busy}
            testID={`block-${opt.hours}h`}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.blockHours}>{opt.hours} hours</Text>
              <Text style={styles.blockSaving}>£{(opt.price / opt.hours).toFixed(2)}/hr · save £{(opt.hours * student.hourly_rate - opt.price).toFixed(0)}</Text>
            </View>
            <Text style={styles.blockPrice}>£{opt.price}</Text>
          </TouchableOpacity>
        ))}
        {busy && (
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        )}
      </BottomSheet>
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
});
