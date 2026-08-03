import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, RotateCcw, Flag } from 'lucide-react-native';
import { theme } from '../src/theme';
import { DVSA_CATEGORIES_BASE } from '../src/mockDb';
import { BottomNav } from '../src/BottomNav';

type FaultType = 'driving' | 'serious' | 'dangerous';
type Faults = Record<string, { driving: number; serious: number; dangerous: number }>;

const initialFaults = (): Faults => {
  const f: Faults = {};
  DVSA_CATEGORIES_BASE.forEach((c) => {
    f[c.key] = { driving: 0, serious: 0, dangerous: 0 };
  });
  return f;
};

export default function Dl25MockTestScreen() {
  const router = useRouter();
  const [faults, setFaults] = useState<Faults>(initialFaults());

  const addFault = (key: string, type: FaultType) => {
    setFaults((prev) => ({
      ...prev,
      [key]: { ...prev[key], [type]: prev[key][type] + 1 },
    }));
  };

  const removeFault = (key: string, type: FaultType) => {
    setFaults((prev) => ({
      ...prev,
      [key]: { ...prev[key], [type]: Math.max(0, prev[key][type] - 1) },
    }));
  };

  const totals = Object.values(faults).reduce(
    (acc, f) => ({
      driving: acc.driving + f.driving,
      serious: acc.serious + f.serious,
      dangerous: acc.dangerous + f.dangerous,
    }),
    { driving: 0, serious: 0, dangerous: 0 }
  );

  const handleFinish = () => {
    // DVSA pass criteria: <= 15 driving faults, 0 serious, 0 dangerous
    const passed = totals.driving <= 15 && totals.serious === 0 && totals.dangerous === 0;
    router.push({
      pathname: '/dl25-report-screen',
      params: {
        d: totals.driving.toString(),
        s: totals.serious.toString(),
        x: totals.dangerous.toString(),
        passed: passed ? '1' : '0',
        breakdown: JSON.stringify(faults),
      },
    });
  };

  const handleReset = () => {
    Alert.alert('Reset mock test?', 'All recorded faults will be cleared.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => setFaults(initialFaults()) },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>DL25 Mock Test</Text>
        <TouchableOpacity onPress={handleReset} style={styles.iconBtn} testID="btn-reset">
          <RotateCcw size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Summary header */}
      <View style={styles.summaryRow} testID="fault-summary">
        <SummaryBox label="Driving" count={totals.driving} colour={theme.colors.faultDriving} />
        <SummaryBox label="Serious" count={totals.serious} colour={theme.colors.faultSerious} />
        <SummaryBox label="Dangerous" count={totals.dangerous} colour={theme.colors.faultDangerous} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} testID="categories-scroll">
        {DVSA_CATEGORIES_BASE.map((c) => {
          const f = faults[c.key];
          return (
            <View key={c.key} style={styles.catCard} testID={`cat-${c.key}`}>
              <Text style={styles.catName}>{c.name}</Text>
              <View style={styles.catRow}>
                <FaultControl
                  label="Driving"
                  value={f.driving}
                  colour={theme.colors.faultDriving}
                  onAdd={() => addFault(c.key, 'driving')}
                  onSub={() => removeFault(c.key, 'driving')}
                  testIDPrefix={`${c.key}-driving`}
                />
                <FaultControl
                  label="Serious"
                  value={f.serious}
                  colour={theme.colors.faultSerious}
                  onAdd={() => addFault(c.key, 'serious')}
                  onSub={() => removeFault(c.key, 'serious')}
                  testIDPrefix={`${c.key}-serious`}
                />
                <FaultControl
                  label="Dangerous"
                  value={f.dangerous}
                  colour={theme.colors.faultDangerous}
                  onAdd={() => addFault(c.key, 'dangerous')}
                  onSub={() => removeFault(c.key, 'dangerous')}
                  testIDPrefix={`${c.key}-dangerous`}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.finishBtn} onPress={handleFinish} testID="btn-finish-test">
          <Flag size={18} color="#fff" />
          <Text style={styles.finishText}>Finish & View Report</Text>
        </TouchableOpacity>
      </View>

      <BottomNav role="student" />
    </SafeAreaView>
  );
}

function SummaryBox({ label, count, colour }: { label: string; count: number; colour: string }) {
  return (
    <View style={[styles.summaryBox, { borderColor: colour }]} testID={`summary-${label.toLowerCase()}`}>
      <Text style={[styles.summaryValue, { color: colour }]}>{count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function FaultControl({
  label,
  value,
  colour,
  onAdd,
  onSub,
  testIDPrefix,
}: {
  label: string;
  value: number;
  colour: string;
  onAdd: () => void;
  onSub: () => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.ctrl}>
      <Text style={styles.ctrlLabel}>{label}</Text>
      <View style={styles.ctrlRow}>
        <TouchableOpacity
          style={[styles.ctrlBtn, { backgroundColor: theme.colors.background, borderColor: colour }]}
          onPress={onSub}
          testID={`${testIDPrefix}-sub`}
        >
          <Text style={[styles.ctrlSign, { color: colour }]}>−</Text>
        </TouchableOpacity>
        <Text style={[styles.ctrlValue, { color: colour }]} testID={`${testIDPrefix}-val`}>{value}</Text>
        <TouchableOpacity
          style={[styles.ctrlBtn, { backgroundColor: colour }]}
          onPress={onAdd}
          testID={`${testIDPrefix}-add`}
        >
          <Text style={[styles.ctrlSign, { color: '#fff' }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  summaryRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  summaryBox: { flex: 1, borderWidth: 2, borderRadius: theme.radius.md, padding: 10, alignItems: 'center' },
  summaryValue: { fontSize: 22, fontWeight: '700' },
  summaryLabel: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  scroll: { paddingHorizontal: 16, paddingBottom: 160, gap: 10 },
  catCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    marginBottom: 8,
  },
  catName: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginBottom: 10 },
  catRow: { flexDirection: 'row', gap: 8 },
  ctrl: { flex: 1, alignItems: 'center', gap: 6 },
  ctrlLabel: { fontSize: 11, color: theme.colors.textMuted, fontWeight: '600' },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctrlBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  ctrlSign: { fontSize: 18, fontWeight: '700' },
  ctrlValue: { fontSize: 18, fontWeight: '700', minWidth: 22, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 84, left: 16, right: 16 },
  finishBtn: {
    height: 54,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    boxShadow: '0px 0px 6px rgba(0, 0, 0, 0.15)',
    elevation: 4,
  },
  finishText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
