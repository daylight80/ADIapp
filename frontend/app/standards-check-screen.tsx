import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Plus, Trash2, AlertTriangle } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card, Badge } from '../src/ui';
import { useAuth } from '../src/AuthContext';
import {
  listMyStandardsChecks, addStandardsCheck, removeStandardsCheck, computeAdiGrade,
  type AdiStandardsCheck,
} from '../src/supabaseDb';

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  A: { bg: '#D1FAE5', text: theme.colors.success },
  B: { bg: '#FEF3C7', text: '#92400E' },
  Fail: { bg: '#FEE2E2', text: theme.colors.danger },
};

// DVSA re-checks every registered ADI at least once every 4 years.
const RENEWAL_WINDOW_YEARS = 4;

export default function StandardsCheckScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [checks, setChecks] = useState<AdiStandardsCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [checkDate, setCheckDate] = useState('');
  const [overallScore, setOverallScore] = useState('');
  const [riskScore, setRiskScore] = useState('');
  const [notes, setNotes] = useState('');

  const load = async () => {
    if (!user?.instructor_id) return;
    try {
      setChecks(await listMyStandardsChecks(user.instructor_id));
    } catch (e: any) {
      Alert.alert('Could not load', e?.message || 'Please apply Migration 030 first.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user?.instructor_id]);

  const mostRecent = checks[0];
  const nextDueInfo = useMemo(() => {
    if (!mostRecent) return null;
    const last = new Date(`${mostRecent.check_date}T00:00:00`);
    const due = new Date(last);
    due.setFullYear(due.getFullYear() + RENEWAL_WINDOW_YEARS);
    const monthsLeft = Math.round((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30));
    return { dueDate: due, overdue: monthsLeft < 0, monthsLeft };
  }, [mostRecent]);

  const previewGrade = overallScore.trim() && !isNaN(Number(overallScore))
    ? computeAdiGrade(Math.max(0, Math.min(51, Number(overallScore))))
    : null;

  const handleSave = async () => {
    if (!user?.instructor_id) return;
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(checkDate.trim());
    if (!dateOk) {
      Alert.alert('Invalid date', 'Enter the check date as YYYY-MM-DD, e.g. 2026-08-19.');
      return;
    }
    const score = Number(overallScore.trim());
    if (!Number.isFinite(score) || score < 0 || score > 51) {
      Alert.alert('Invalid score', 'Overall score must be between 0 and 51.');
      return;
    }
    let riskVal: number | null = null;
    if (riskScore.trim()) {
      const parsed = Number(riskScore.trim());
      if (!Number.isFinite(parsed) || parsed < 0) {
        Alert.alert('Invalid risk management score', 'Enter a valid number, or leave blank.');
        return;
      }
      riskVal = parsed;
    }
    setSaving(true);
    try {
      await addStandardsCheck({
        instructorId: user.instructor_id,
        checkDate: checkDate.trim(),
        overallScore: score,
        riskManagementScore: riskVal,
        notes,
      });
      setCheckDate(''); setOverallScore(''); setRiskScore(''); setNotes('');
      setFormOpen(false);
      load();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (check: AdiStandardsCheck) => {
    Alert.alert('Remove this entry?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeStandardsCheck(check.id);
            setChecks((prev) => prev.filter((c) => c.id !== check.id));
          } catch (e: any) {
            Alert.alert('Could not remove', e?.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
            <ArrowLeft size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Standards Check</Text>
          <TouchableOpacity onPress={() => setFormOpen((v) => !v)} style={styles.iconBtn} testID="btn-toggle-form">
            <Plus size={22} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Text style={styles.subtitle}>
            Your own DVSA quality assurance record — distinct from your students' pass rates. DVSA re-checks every registered ADI at least once every 4 years.
          </Text>

          {nextDueInfo && (
            <Card style={[{ gap: 4 }, nextDueInfo.overdue && { borderColor: theme.colors.danger, borderWidth: 1 }]} testID="card-next-due">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {nextDueInfo.overdue && <AlertTriangle size={16} color={theme.colors.danger} />}
                <Text style={[styles.cardTitle, nextDueInfo.overdue && { color: theme.colors.danger }]}>
                  {nextDueInfo.overdue ? 'Renewal window has passed' : 'Next check due'}
                </Text>
              </View>
              <Text style={styles.dueText}>
                {nextDueInfo.dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                {' '}({RENEWAL_WINDOW_YEARS} years after your last logged check)
              </Text>
            </Card>
          )}

          {formOpen && (
            <Card style={{ gap: 10 }} testID="card-add-check">
              <Text style={styles.cardTitle}>Log a Standards Check</Text>

              <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={checkDate}
                onChangeText={setCheckDate}
                placeholder="2026-08-19"
                placeholderTextColor={theme.colors.textMuted}
                testID="input-check-date"
              />

              <Text style={styles.label}>Overall score (0–51)</Text>
              <TextInput
                style={styles.input}
                value={overallScore}
                onChangeText={setOverallScore}
                placeholder="e.g. 45"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="number-pad"
                testID="input-overall-score"
              />
              {previewGrade && (
                <Badge
                  label={`Grade ${previewGrade}`}
                  bg={GRADE_COLORS[previewGrade].bg}
                  color={GRADE_COLORS[previewGrade].text}
                />
              )}

              <Text style={styles.label}>Risk Management score (optional)</Text>
              <TextInput
                style={styles.input}
                value={riskScore}
                onChangeText={setRiskScore}
                placeholder="Automatic fail if 7 or under, regardless of total"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="number-pad"
                testID="input-risk-score"
              />

              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Examiner feedback, areas to work on…"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                testID="input-check-notes"
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
                testID="btn-save-check"
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </Card>
          )}

          <Text style={styles.sectionTitle}>History</Text>
          {checks.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No Standards Checks logged yet.</Text>
            </Card>
          ) : (
            checks.map((check) => {
              const grade = computeAdiGrade(check.overall_score);
              const riskFail = check.risk_management_score != null && check.risk_management_score <= 7;
              return (
                <Card key={check.id} style={{ gap: 6 }} testID={`check-${check.id}`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.checkDate}>
                        {new Date(`${check.check_date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </Text>
                      <Text style={styles.checkScore}>{check.overall_score} / 51 points</Text>
                    </View>
                    <Badge label={`Grade ${grade}`} bg={GRADE_COLORS[grade].bg} color={GRADE_COLORS[grade].text} />
                  </View>
                  {riskFail && (
                    <Text style={styles.riskWarning}>
                      Risk Management scored {check.risk_management_score} — automatic fail regardless of total, per DVSA rules.
                    </Text>
                  )}
                  {check.notes ? <Text style={styles.checkNotes}>{check.notes}</Text> : null}
                  <TouchableOpacity onPress={() => handleDelete(check)} style={{ alignSelf: 'flex-end' }} testID={`btn-delete-check-${check.id}`}>
                    <Trash2 size={16} color={theme.colors.danger} />
                  </TouchableOpacity>
                </Card>
              );
            })
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },
  subtitle: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 18 },
  sectionTitle: { ...theme.font.h3, marginTop: 4 },
  cardTitle: { ...theme.font.h3 },
  dueText: { fontSize: 13, color: theme.colors.textMuted },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.text, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  saveBtn: {
    backgroundColor: theme.colors.primary, height: 46, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  emptyText: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center' },
  checkDate: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  checkScore: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  checkNotes: { fontSize: 13, color: theme.colors.text, marginTop: 2 },
  riskWarning: { fontSize: 12, color: theme.colors.danger, fontWeight: '600' },
});
