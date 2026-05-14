import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, X, RotateCcw } from 'lucide-react-native';
import { theme } from '../src/theme';
import { THEORY_BANK, mockDb_ext, mockDb } from '../src/mockDb';
import { useAuth } from '../src/AuthContext';
import { Card, ProgressBar, Badge } from '../src/ui';

export default function TheoryTestScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const student = user?.email ? mockDb.getStudentByEmail(user.email) : mockDb.getStudent('s2');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const correct = Object.keys(answers).filter(
    (qid) => THEORY_BANK.find((q) => q.id === qid)?.answer_index === answers[qid]
  ).length;
  const total = THEORY_BANK.length;
  const passMark = 8; // 80%
  const passed = correct >= passMark;

  const onSubmit = () => {
    setSubmitted(true);
    if (correct >= passMark && student) {
      mockDb_ext.awardBadge(student.id, 'theory_passed');
    }
  };

  const reset = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Theory Test</Text>
        <TouchableOpacity onPress={reset} style={styles.iconBtn} testID="btn-reset">
          <RotateCcw size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.progRow}>
        <Text style={styles.progText}>{Object.keys(answers).length} / {total} answered</Text>
        <ProgressBar progress={(Object.keys(answers).length / total) * 100} height={6} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} testID="theory-questions">
        {THEORY_BANK.map((q, i) => {
          const chosen = answers[q.id];
          return (
            <Card key={q.id} style={styles.qCard} testID={`q-${q.id}`}>
              <View style={styles.qHead}>
                <Badge label={`Q${i + 1}`} />
                <Badge label={q.topic} bg="#FFF7ED" color={theme.colors.accent} />
              </View>
              <Text style={styles.qText}>{q.question}</Text>
              <View style={{ gap: 8, marginTop: 8 }}>
                {q.options.map((opt, idx) => {
                  const selected = chosen === idx;
                  const showRight = submitted && idx === q.answer_index;
                  const showWrong = submitted && selected && idx !== q.answer_index;
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.opt,
                        selected && styles.optActive,
                        showRight && styles.optRight,
                        showWrong && styles.optWrong,
                      ]}
                      onPress={() => !submitted && setAnswers((a) => ({ ...a, [q.id]: idx }))}
                      disabled={submitted}
                      testID={`q-${q.id}-opt-${idx}`}
                    >
                      <Text style={[styles.optText, (selected || showRight) && { fontWeight: '700' }]}>{opt}</Text>
                      {showRight && <Check size={18} color={theme.colors.success} />}
                      {showWrong && <X size={18} color={theme.colors.danger} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Card>
          );
        })}

        {!submitted ? (
          <TouchableOpacity
            style={[styles.submit, Object.keys(answers).length < total && styles.submitDisabled]}
            disabled={Object.keys(answers).length < total}
            onPress={onSubmit}
            testID="btn-submit-theory"
          >
            <Text style={styles.submitText}>Submit Test</Text>
          </TouchableOpacity>
        ) : (
          <Card style={[styles.resultCard, { borderColor: passed ? theme.colors.success : theme.colors.danger }]} testID="theory-result">
            <Text style={[styles.resultTitle, { color: passed ? theme.colors.success : theme.colors.danger }]}>
              {passed ? 'PASS' : 'FAIL'}
            </Text>
            <Text style={styles.resultSub}>Score: {correct} / {total} ({Math.round((correct / total) * 100)}%) · Pass mark: 80%</Text>
            {passed && <Text style={styles.badgeEarned}>🏆 Badge unlocked: Theory Champion</Text>}
          </Card>
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
  progRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  progText: { ...theme.font.caption, fontWeight: '600' },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  qCard: { gap: 8 },
  qHead: { flexDirection: 'row', gap: 8 },
  qText: { fontSize: 15, fontWeight: '600', color: theme.colors.text, lineHeight: 22 },
  opt: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, gap: 8 },
  optActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight },
  optRight: { borderColor: theme.colors.success, backgroundColor: '#D1FAE5' },
  optWrong: { borderColor: theme.colors.danger, backgroundColor: '#FEE2E2' },
  optText: { fontSize: 14, color: theme.colors.text, flex: 1 },
  submit: { backgroundColor: theme.colors.primary, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resultCard: { alignItems: 'center', gap: 6, borderWidth: 2, marginTop: 8 },
  resultTitle: { fontSize: 28, fontWeight: '800' },
  resultSub: { color: theme.colors.textMuted, fontSize: 14, textAlign: 'center' },
  badgeEarned: { color: theme.colors.accent, fontWeight: '700', marginTop: 6 },
});
