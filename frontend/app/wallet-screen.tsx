import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, PoundSterling, Clock, Receipt } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import {
  useBlockBookings,
  useStudentByEmail,
  useStudentByAuthId,
  useStudent,
  useLessonsForStudent,
  bump,
} from '../src/useSupabaseData';
import { Card, Badge } from '../src/ui';
import { formatHoursLabel } from '../src/voucher';
import { RedeemVoucherCard } from '../src/RedeemVoucherCard';
import { PupilPaymentsCard } from '../src/PupilPaymentsCard';
import { formatDate } from '../src/dateFormat';

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
    const total_paid = bookings.reduce((s, b) => s + (b.money ?? b.amount), 0);
    return { hours_remaining, total_paid };
  }, [bookings]);

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
          <Text style={styles.addHoursHint} testID="add-hours-hint">
            To add prepaid hours, record the payment on the pupil&apos;s profile and tick Also add hours. That keeps the money and the hours in one place.
          </Text>
        )}

        {!isInstructorManaging && !!studentId && <RedeemVoucherCard />}
        {!isInstructorManaging && !!studentId && <PupilPaymentsCard />}

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
                    Added {formatDate(b.purchased_at)} · {(b.hours_paid - b.hours_used).toFixed(1)}h left
                  </Text>
                </View>
                <Badge label={`£${b.money ?? b.amount}`} bg={theme.colors.primaryLight} color={theme.colors.primary} />
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
                    {formatDate(l.date)} · £{l.amount_paid} (inc. 20% VAT)
                  </Text>
                </View>
              </View>
            </Card>
          ))
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

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
  addHoursHint: { fontSize: 13.5, lineHeight: 19, color: theme.colors.textMuted },
  section: { ...theme.font.h3, marginTop: 4 },
  empty: { color: theme.colors.textMuted, textAlign: 'center', padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bookHours: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  bookMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
});
