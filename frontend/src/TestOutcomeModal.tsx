import React, { useEffect, useState, useMemo } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { X, Trophy, CircleX } from 'lucide-react-native';
import { theme } from './theme';
import { DateField } from './DateTimeFields';
import { TEST_RETEST_REASONS, type TestType, type TestResult } from './supabaseDb';
import { createTestOutcome } from './useSupabaseData';

export type TestOutcomeModalProps = {
  visible: boolean;
  studentId: string;
  onClose: () => void;
  onSaved?: () => void;
};

const todayYmd = () => new Date().toISOString().slice(0, 10);
const toIntOrNull = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

export function TestOutcomeModal({ visible, studentId, onClose, onSaved }: TestOutcomeModalProps) {
  const [testType, setTestType] = useState<TestType>('practical');
  const [result, setResult] = useState<TestResult>('pass');
  const [testDate, setTestDate] = useState<string>('');
  const [testCentre, setTestCentre] = useState('');
  // Practical
  const [drivingFaults, setDrivingFaults] = useState('');
  const [seriousFaults, setSeriousFaults] = useState('');
  const [dangerousFaults, setDangerousFaults] = useState('');
  // Theory
  const [mcScore, setMcScore] = useState('');
  const [hpScore, setHpScore] = useState('');
  // Both
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTestType('practical');
    setResult('pass');
    setTestDate(todayYmd());
    setTestCentre('');
    setDrivingFaults(''); setSeriousFaults(''); setDangerousFaults('');
    setMcScore(''); setHpScore('');
    setReasons(new Set()); setNotes('');
    setBusy(false); setErr(null);
  }, [visible]);

  const toggleReason = (r: string) => {
    const next = new Set(reasons);
    if (next.has(r)) next.delete(r); else next.add(r);
    setReasons(next);
  };

  const onSave = async () => {
    setErr(null);
    if (!testDate) { setErr('Pick a test date.'); return; }
    setBusy(true);
    try {
      await createTestOutcome({
        student_id: studentId,
        test_type: testType,
        result,
        test_date: testDate,
        test_centre: testCentre.trim() || null,
        examiner_notes: notes.trim() || null,
        retest_reasons: Array.from(reasons),
        driving_faults: testType === 'practical' ? toIntOrNull(drivingFaults) : null,
        serious_faults: testType === 'practical' ? toIntOrNull(seriousFaults) : null,
        dangerous_faults: testType === 'practical' ? toIntOrNull(dangerousFaults) : null,
        theory_mc_score: testType === 'theory' ? toIntOrNull(mcScore) : null,
        theory_hp_score: testType === 'theory' ? toIntOrNull(hpScore) : null,
      });
      onSaved?.();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Could not save test outcome.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Trophy size={18} color={theme.colors.primary} />
              <Text style={styles.title}>Log test outcome</Text>
            </View>
            <TouchableOpacity onPress={() => !busy && onClose()} testID="btn-test-close" hitSlop={8}>
              <X size={20} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8, gap: 14 }}>
            {/* Test type segmented control */}
            <View>
              <Text style={styles.label}>Test type</Text>
              <View style={styles.segRow}>
                {(['practical', 'theory'] as TestType[]).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.segBtn, testType === t && styles.segBtnActive]}
                    onPress={() => setTestType(t)}
                    testID={`seg-type-${t}`}
                  >
                    <Text style={[styles.segText, testType === t && styles.segTextActive]}>
                      {t === 'practical' ? 'Practical' : 'Theory'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Result */}
            <View>
              <Text style={styles.label}>Result</Text>
              <View style={styles.segRow}>
                <TouchableOpacity
                  style={[styles.resBtn, result === 'pass' && styles.resPass]}
                  onPress={() => setResult('pass')}
                  testID="seg-result-pass"
                >
                  <Trophy size={14} color={result === 'pass' ? '#fff' : theme.colors.success} />
                  <Text style={[styles.resText, result === 'pass' && styles.resTextActive]}>Pass</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.resBtn, result === 'fail' && styles.resFail]}
                  onPress={() => setResult('fail')}
                  testID="seg-result-fail"
                >
                  <CircleX size={14} color={result === 'fail' ? '#fff' : theme.colors.danger} />
                  <Text style={[styles.resText, result === 'fail' && styles.resTextActive]}>Fail</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View>
              <Text style={styles.label}>Test date</Text>
              <DateField value={testDate} onChange={setTestDate} testID="input-test-date" />
            </View>

            <View>
              <Text style={styles.label}>Test centre</Text>
              <TextInput
                value={testCentre}
                onChangeText={setTestCentre}
                placeholder="e.g. Bristol (Avonmouth)"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.input}
                testID="input-test-centre"
              />
            </View>

            {/* Practical metrics */}
            {testType === 'practical' && (
              <View>
                <Text style={styles.label}>Faults (optional — DVSA mark sheet)</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subLabel}>Driving</Text>
                    <TextInput
                      value={drivingFaults} onChangeText={(v) => setDrivingFaults(v.replace(/[^0-9]/g, '').slice(0, 3))}
                      placeholder="0" keyboardType="numeric" style={styles.input} testID="input-driving-faults"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subLabel}>Serious</Text>
                    <TextInput
                      value={seriousFaults} onChangeText={(v) => setSeriousFaults(v.replace(/[^0-9]/g, '').slice(0, 3))}
                      placeholder="0" keyboardType="numeric" style={styles.input} testID="input-serious-faults"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subLabel}>Dangerous</Text>
                    <TextInput
                      value={dangerousFaults} onChangeText={(v) => setDangerousFaults(v.replace(/[^0-9]/g, '').slice(0, 3))}
                      placeholder="0" keyboardType="numeric" style={styles.input} testID="input-dangerous-faults"
                    />
                  </View>
                </View>
              </View>
            )}

            {/* Theory metrics */}
            {testType === 'theory' && (
              <View>
                <Text style={styles.label}>Scores (optional)</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subLabel}>Multiple choice (/50)</Text>
                    <TextInput
                      value={mcScore} onChangeText={(v) => setMcScore(v.replace(/[^0-9]/g, '').slice(0, 2))}
                      placeholder="0" keyboardType="numeric" style={styles.input} testID="input-mc-score"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subLabel}>Hazard perception (/75)</Text>
                    <TextInput
                      value={hpScore} onChangeText={(v) => setHpScore(v.replace(/[^0-9]/g, '').slice(0, 2))}
                      placeholder="0" keyboardType="numeric" style={styles.input} testID="input-hp-score"
                    />
                  </View>
                </View>
              </View>
            )}

            {/* Retest reason chips — relevant for both types but mostly for fails */}
            {result === 'fail' && (
              <View>
                <Text style={styles.label}>Fault categories (multi-select)</Text>
                <View style={styles.chipsWrap}>
                  {TEST_RETEST_REASONS.map((r) => {
                    const on = reasons.has(r);
                    return (
                      <TouchableOpacity
                        key={r}
                        style={[styles.chip, on && styles.chipActive]}
                        onPress={() => toggleReason(r)}
                        testID={`reason-${r.replace(/[^a-z]/gi, '-').toLowerCase()}`}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextActive]}>{r}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            <View>
              <Text style={styles.label}>Examiner notes (optional)</Text>
              <TextInput
                value={notes} onChangeText={setNotes}
                placeholder="e.g. Confident on roundabouts, more practice on dual carriageways"
                placeholderTextColor={theme.colors.textMuted}
                style={[styles.input, { height: 80 }]} multiline testID="input-notes"
              />
            </View>

            {err ? <Text style={styles.errText}>{err}</Text> : null}

            <TouchableOpacity
              style={[styles.saveBtn, busy && styles.btnDisabled]}
              onPress={onSave}
              disabled={busy}
              testID="btn-test-save"
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.saveBtnText}>Save test outcome</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 22,
    maxHeight: '92%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '800', color: theme.colors.text },
  label: { fontSize: 12, fontWeight: '800', color: theme.colors.textMuted, marginBottom: 6, letterSpacing: 0.4 },
  subLabel: { fontSize: 11, fontWeight: '700', color: theme.colors.textMuted, marginBottom: 4 },
  segRow: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  segBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  segText: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  segTextActive: { color: '#fff' },
  resBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: theme.colors.border,
    backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6,
  },
  resPass: { backgroundColor: theme.colors.success, borderColor: theme.colors.success },
  resFail: { backgroundColor: theme.colors.danger, borderColor: theme.colors.danger },
  resText: { fontSize: 15, fontWeight: '800', color: theme.colors.text },
  resTextActive: { color: '#fff' },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, height: 44, color: theme.colors.text,
    backgroundColor: theme.colors.background, fontSize: 14,
  },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: theme.colors.text },
  chipTextActive: { color: '#fff' },
  saveBtn: {
    height: 50, borderRadius: 12, backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
  errText: { color: theme.colors.danger, fontSize: 13 },
});
