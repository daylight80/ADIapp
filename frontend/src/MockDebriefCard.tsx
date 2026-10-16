import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { bump } from './useSupabaseData';
import { generateMockDebrief, removeMockDebrief, mockDebriefErrorMessage, MOCK_DEBRIEF_NOTE_INSTRUCTOR } from './mockDebrief';

/**
 * On the mock test report, for the instructor: write an AI debrief for the pupil from the marks just entered.
 * It is saved on the attempt and the pupil sees it on their home screen. The instructor can write it again
 * or remove it.
 */
export function MockDebriefCard({ attemptId, pupilFirstName, existing }: { attemptId: string; pupilFirstName: string; existing?: string | null }) {
  const [text, setText] = useState<string | null>(existing ?? null);
  const [busy, setBusy] = useState<'write' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The attempt can arrive after the first render (the report loads it once saved).
  useEffect(() => { setText(existing ?? null); }, [existing, attemptId]);

  const write = async () => {
    setBusy('write');
    setError(null);
    try {
      const r = await generateMockDebrief(attemptId);
      setText(r.debrief);
      bump();
    } catch (e) {
      setError(mockDebriefErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    setError(null);
    try {
      await removeMockDebrief(attemptId);
      setText(null);
      bump();
    } catch (e) {
      setError(mockDebriefErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ gap: 10 }} testID="mock-debrief-card">
      <View style={styles.titleRow}>
        <Sparkles size={16} color={theme.colors.primary} />
        <Text style={styles.title}>Debrief for {pupilFirstName || 'the pupil'}</Text>
      </View>

      {!!text && <Text style={styles.body} testID="mock-debrief-text">{text}</Text>}

      <TouchableOpacity
        style={[styles.btn, busy !== null && { opacity: 0.6 }]}
        onPress={write}
        disabled={busy !== null}
        testID="btn-write-debrief"
      >
        {busy === 'write' ? <ActivityIndicator color={theme.colors.primary} /> : <Text style={styles.btnText}>{text ? 'Write it again' : 'Write a debrief'}</Text>}
      </TouchableOpacity>

      {!!text && (
        <TouchableOpacity onPress={remove} disabled={busy !== null} testID="btn-remove-debrief">
          {busy === 'remove' ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : <Text style={styles.remove}>Remove it</Text>}
        </TouchableOpacity>
      )}

      {!!error && <Text style={styles.error} testID="mock-debrief-error">{error}</Text>}
      <Text style={styles.hint}>{MOCK_DEBRIEF_NOTE_INSTRUCTOR}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  body: { fontSize: 14.5, lineHeight: 21, color: theme.colors.text },
  btn: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: theme.colors.primary, fontWeight: '700', fontSize: 14.5 },
  remove: { color: theme.colors.danger, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  error: { color: theme.colors.danger, fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 12, color: theme.colors.textMuted, lineHeight: 17 },
});
