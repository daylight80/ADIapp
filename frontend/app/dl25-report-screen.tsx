import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, X, ArrowLeft, RotateCcw, Home } from 'lucide-react-native';
import { theme } from '../src/theme';
import { DVSA_CATEGORIES_BASE } from '../src/mockDb';
import { Card, Badge } from '../src/ui';

export default function Dl25ReportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const driving = parseInt((params.d as string) || '0', 10);
  const serious = parseInt((params.s as string) || '0', 10);
  const dangerous = parseInt((params.x as string) || '0', 10);
  const passed = params.passed === '1';

  const breakdown = useMemo(() => {
    try {
      return params.breakdown ? JSON.parse(params.breakdown as string) : {};
    } catch {
      return {};
    }
  }, [params.breakdown]);

  const categoriesWithFaults = DVSA_CATEGORIES_BASE.filter((c) => {
    const f = breakdown[c.key];
    return f && (f.driving > 0 || f.serious > 0 || f.dangerous > 0);
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>DL25 Report</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Result Card */}
        <View
          style={[
            styles.resultCard,
            { backgroundColor: passed ? theme.colors.success : theme.colors.faultSerious },
          ]}
          testID="result-card"
        >
          <View style={styles.resultIcon}>
            {passed ? <Check size={48} color="#fff" /> : <X size={48} color="#fff" />}
          </View>
          <Text style={styles.resultTitle} testID="result-title">{passed ? 'PASS' : 'FAIL'}</Text>
          <Text style={styles.resultSub}>
            {passed
              ? 'Well done! You have met DVSA test standards.'
              : 'Not quite there yet. Review the faults below and keep practising.'}
          </Text>
        </View>

        {/* Faults summary */}
        <Card style={{ gap: 14 }}>
          <Text style={styles.cardTitle}>Fault summary</Text>
          <View style={styles.faultsRow}>
            <FaultCard label="Driving Faults" value={driving} note="≤ 15 to pass" colour={theme.colors.faultDriving} />
            <FaultCard label="Serious Faults" value={serious} note="0 to pass" colour={theme.colors.faultSerious} />
            <FaultCard label="Dangerous" value={dangerous} note="0 to pass" colour={theme.colors.faultDangerous} />
          </View>
        </Card>

        {/* Breakdown by category */}
        <Card style={{ gap: 10 }}>
          <Text style={styles.cardTitle}>Breakdown by category</Text>
          {categoriesWithFaults.length === 0 ? (
            <Text style={styles.empty}>No faults recorded — excellent drive!</Text>
          ) : (
            categoriesWithFaults.map((c) => {
              const f = breakdown[c.key];
              return (
                <View key={c.key} style={styles.bdRow} testID={`breakdown-${c.key}`}>
                  <Text style={styles.bdName}>{c.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {f.driving > 0 && (
                      <Badge label={`D:${f.driving}`} bg="#FEF3C7" color={theme.colors.faultDriving} />
                    )}
                    {f.serious > 0 && (
                      <Badge label={`S:${f.serious}`} bg="#FEE2E2" color={theme.colors.faultSerious} />
                    )}
                    {f.dangerous > 0 && (
                      <Badge label={`X:${f.dangerous}`} bg="#FEE2E2" color={theme.colors.faultDangerous} />
                    )}
                  </View>
                </View>
              );
            })
          )}
        </Card>

        {/* Actions */}
        <View style={{ gap: 10, marginTop: 4 }}>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => router.replace('/dl25-mock-test-screen')}
            testID="btn-retake"
          >
            <RotateCcw size={18} color="#fff" />
            <Text style={styles.btnText}>Retake Mock Test</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnPrimary, { backgroundColor: theme.colors.primary }]}
            onPress={() => router.replace('/student-home-screen')}
            testID="btn-back-home"
          >
            <Home size={18} color="#fff" />
            <Text style={styles.btnText}>Back to My Learning</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function FaultCard({ label, value, note, colour }: { label: string; value: number; note: string; colour: string }) {
  return (
    <View style={[styles.faultCard, { borderColor: colour }]}>
      <Text style={[styles.faultVal, { color: colour }]}>{value}</Text>
      <Text style={styles.faultLab}>{label}</Text>
      <Text style={styles.faultNote}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  scroll: { padding: 16, gap: 16, paddingBottom: 32 },
  resultCard: { borderRadius: theme.radius.lg, padding: 24, alignItems: 'center', gap: 8 },
  resultIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  resultTitle: { color: '#fff', fontSize: 36, fontWeight: '800', letterSpacing: 2 },
  resultSub: { color: '#ffffffee', textAlign: 'center', fontSize: 14, paddingHorizontal: 20 },
  cardTitle: { ...theme.font.h3 },
  faultsRow: { flexDirection: 'row', gap: 8 },
  faultCard: { flex: 1, borderRadius: theme.radius.md, borderWidth: 2, padding: 12, alignItems: 'center', gap: 4 },
  faultVal: { fontSize: 26, fontWeight: '800' },
  faultLab: { fontSize: 12, color: theme.colors.text, fontWeight: '600', textAlign: 'center' },
  faultNote: { fontSize: 10, color: theme.colors.textMuted },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  bdName: { fontSize: 14, color: theme.colors.text, fontWeight: '500', flex: 1 },
  empty: { textAlign: 'center', color: theme.colors.textMuted, padding: 12 },
  btnPrimary: {
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
