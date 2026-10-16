import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { theme } from './theme';
import { Card } from './ui';
import { getMyPaymentSummary, type MyPaymentSummary } from './supabaseDb';
import { useVersion } from './useSupabaseData';
import { describeBalance, formatGbp, pupilBalanceLine, pupilHistory } from './payments';

const TONE = { owes: '#C2410C', credit: '#047857', clear: '#334155' } as const;

/**
 * "Your payments" on the pupil's own Wallet: what they owe or have in credit, what has been charged and
 * paid, and each payment and prepaid top-up. Payments are made to the instructor directly; the app only
 * shows the record, and has no way to pay.
 */
export function PupilPaymentsCard({ instructorFirstName }: { instructorFirstName?: string | null }) {
  const version = useVersion();
  const [summary, setSummary] = useState<MyPaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMyPaymentSummary()
      .then((s) => { if (!cancelled) { setSummary(s); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version]);

  if (loading && !summary) {
    return <Card><ActivityIndicator size="small" color={theme.colors.primary} /></Card>;
  }
  if (failed || !summary) {
    return failed ? (
      <Card testID="pupil-payments-card"><Text style={styles.hint}>Couldn&apos;t load your payments. Check your connection and reopen this page.</Text></Card>
    ) : null;
  }

  const kind = describeBalance(summary.balance).kind;
  const history = pupilHistory(summary);

  return (
    <Card style={{ gap: 8 }} testID="pupil-payments-card">
      <Text style={styles.title}>Your payments</Text>
      <Text style={[styles.balance, { color: TONE[kind] }]} testID="pupil-balance">{pupilBalanceLine(summary.balance, instructorFirstName)}</Text>
      <Text style={styles.hint}>Lessons so far {formatGbp(summary.charged)} · You have paid {formatGbp(summary.paid)}</Text>
      {history.length === 0 ? (
        <Text style={styles.hint} testID="pupil-payments-empty">No payments recorded yet.</Text>
      ) : (
        history.slice(0, 12).map((h) => (
          <View key={h.id} style={styles.row} testID={`pupil-payment-${h.id}`}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rowTitle}>{h.title}</Text>
              <Text style={styles.hint}>{h.sub}</Text>
            </View>
            <Text style={styles.amount}>{formatGbp(h.amount)}</Text>
          </View>
        ))
      )}
      <Text style={styles.hint}>You pay your instructor directly. This page only shows what they have recorded.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  balance: { fontSize: 17, fontWeight: '800' },
  hint: { fontSize: 12.5, color: theme.colors.textMuted, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: theme.colors.border },
  rowTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  amount: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
});
