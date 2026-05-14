import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, PoundSterling, Clock, Plus, Receipt } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb, mockDb_ext } from '../src/mockDb';
import { useAuth } from '../src/AuthContext';
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
  const studentId = (params.studentId as string) || (user?.email ? mockDb.getStudentByEmail(user.email)?.id : 's2') || 's2';
  const student = mockDb.getStudent(studentId)!;

  const [buyOpen, setBuyOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const wallet = mockDb_ext.getWalletBalance(studentId);
  const bookings = mockDb_ext.listBlockBookings(studentId);
  const lessons = mockDb.listLessonsForStudent(studentId).filter((l) => l.amount_paid);

  const buy = (hours: number, amount: number) => {
    mockDb_ext.addBlockBooking(studentId, hours, amount);
    setBuyOpen(false);
    setReloadKey((k) => k + 1);
    Alert.alert('Block booked', `${hours} hours added for £${amount}. A VAT receipt is available below.`);
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
        {bookings.length === 0 ? (
          <Card><Text style={styles.empty}>No block bookings yet.</Text></Card>
        ) : (
          bookings.map((b) => (
            <Card key={b.id} testID={`booking-${b.id}`}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bookHours}>{b.hours}h block</Text>
                  <Text style={styles.bookMeta}>
                    Purchased {new Date(b.purchased_at).toLocaleDateString('en-GB')} · {b.hours - b.hours_used}h left
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
            style={styles.blockCard}
            onPress={() => buy(opt.hours, opt.price)}
            testID={`block-${opt.hours}h`}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.blockHours}>{opt.hours} hours</Text>
              <Text style={styles.blockSaving}>£{(opt.price / opt.hours).toFixed(2)}/hr · save £{(opt.hours * 38 - opt.price).toFixed(0)}</Text>
            </View>
            <Text style={styles.blockPrice}>£{opt.price}</Text>
          </TouchableOpacity>
        ))}
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
