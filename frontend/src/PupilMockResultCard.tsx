import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { MOCK_DEBRIEF_NOTE_PUPIL } from './mockDebrief';

const C = { border: '#E4DED2', text: '#0F172A', muted: '#6B6356', primary: '#00539F', pass: '#047857', passBg: '#ECFDF5', fail: '#B45309', failBg: '#FFF7ED' };

type Attempt = {
  taken_at: string;
  passed: boolean;
  driving_faults: number;
  serious_faults: number;
  dangerous_faults: number;
  ai_debrief?: string | null;
};

/**
 * "Your latest mock test" on the pupil's home screen. Shown only once the instructor has attached a debrief to
 * the attempt, so a pupil never sees a result before their instructor has gone through it with them.
 */
export function PupilMockResultCard({ attempt }: { attempt: Attempt | null | undefined }) {
  if (!attempt || !attempt.ai_debrief) return null;
  const when = new Date(attempt.taken_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View style={styles.card} testID="pupil-mock-result">
      <View style={styles.head}>
        <Text style={styles.title}>Your latest mock test</Text>
        <Text style={[styles.pill, { backgroundColor: attempt.passed ? C.passBg : C.failBg, color: attempt.passed ? C.pass : C.fail }]} testID="pupil-mock-pill">
          {attempt.passed ? 'Pass' : 'Not yet'}
        </Text>
      </View>
      <Text style={styles.sub}>
        {when} · {attempt.driving_faults} driving · {attempt.serious_faults} serious · {attempt.dangerous_faults} dangerous
      </Text>
      <Text style={styles.body} testID="pupil-mock-debrief">{attempt.ai_debrief}</Text>
      <View style={styles.note}>
        <Sparkles size={12} color={C.muted} />
        <Text style={styles.noteText}>{MOCK_DEBRIEF_NOTE_PUPIL}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },
  pill: { fontFamily: 'Barlow_700Bold', fontSize: 12, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  sub: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: C.muted },
  body: { fontFamily: 'Barlow_400Regular', fontSize: 14.5, lineHeight: 21, color: C.text },
  note: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteText: { fontFamily: 'Barlow_400Regular', fontSize: 12, color: C.muted },
});
