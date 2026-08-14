import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, X, ArrowLeft, RotateCcw, Home, History } from 'lucide-react-native';
import { theme } from '../src/theme';
import { DVSA_CATEGORIES_BASE } from '../src/mockDb';
import { Card, Badge } from '../src/ui';
import { useAuth } from '../src/AuthContext';
import { useStudentByAuthId, useStudentByEmail, useMockTestAttempts } from '../src/useSupabaseData';

export default function Dl25ReportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { user } = useAuth();

  // Same student-resolution pattern as the mock test screen itself, so the
  // history shown here lines up with whatever attempt was just saved.
  const { student: sbStudentByAuth } = useStudentByAuthId(user?.id);
  const { student: sbStudentByEmail } = useStudentByEmail(
    !sbStudentByAuth ? user?.email : undefined,
  );
  const supabaseStudent = sbStudentByAuth || sbStudentByEmail;
  const { attempts, loading: attemptsLoading } = useMockTestAttempts(supabaseStudent?.id);

  // The attempt just taken is always attempts[0] (most recent) once saved,
  // so "past attempts" excludes it to avoid showing the same result twice.
  const pastAttempts = attempts.slice(1);

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
                      <Badge label={`D:${f.driving}`} bg={theme.colors.warningLight} color={theme.colors.faultDriving} />
                    )}
                    {f.serious > 0 && (
                      <Badge label={`S:${f.serious}`} bg={theme.colors.dangerLight} color={theme.colors.faultSerious} />
                    )}
                    {f.dangerous > 0 && (
                      <Badge label={`X:${f.dangerous}`} bg={theme.colors.dangerLight} color={theme.colors.faultDangerous} />
                    )}
                  </View>
                </View>
              );
            })
          )}
        </Card>

        {/* Past attempts */}
        {supabaseStudent && (
          <Card style={{ gap: 10 }}>
            <View style={styles.historyHeader}>
              <History size={16} color={theme.colors.textMuted} />
              <Text style={styles.cardTitle}>Past attempts</Text>
            </View>
            {attemptsLoading ? (
              <ActivityIndicator color={theme.colors.textMuted} />
            ) : pastAttempts.length === 0 ? (
              <Text style={styles.empty}>This is your first recorded attempt.</Text>
            ) : (
              pastAttempts.map((a) => (
                <View key={a.id} style={styles.historyRow} testID={`history-${a.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyDate}>
                      {new Date(a.taken_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                    <Text style={styles.historyFaults}>
                      {a.driving_faults} driving · {a.serious_faults} serious · {a.dangerous_faults} dangerous
                    </Text>
                  </View>
                  <Badge
                    label={a.passed ? 'PASS' : 'FAIL'}
                    bg={a.passed ? theme.colors.successLight : theme.colors.dangerLight}
                    color={a.passed ? theme.colors.success : theme.colors.danger}
                  />
                </View>
              ))
            )}
          </Card>
        )}

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
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  historyDate: { fontSize: 14, color: theme.colors.text, fontWeight: '600' },
  historyFaults: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
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
