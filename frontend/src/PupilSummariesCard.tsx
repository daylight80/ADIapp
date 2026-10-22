import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { fetchMySummaries, SUMMARY_NOTE_PUPIL, type PupilSummary } from './lessonSummary';
import { formatDate } from './dateFormat';
import { useVersion } from './useSupabaseData';

const C = { border: '#E4DED2', text: '#0F172A', muted: '#6B6356', primary: '#00539F', card: '#FFFFFF' };

/** The pupil's own approved summaries from their instructor. Nothing shows until the instructor has approved one. */
export function usePupilSummaries(enabled: boolean): PupilSummary[] {
  const version = useVersion();
  const [list, setList] = useState<PupilSummary[]>([]);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    let alive = true;
    fetchMySummaries().then((r) => { if (alive) setList(r); }).catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [enabled, version]);
  return list;
}

/** "From your instructor" on the pupil's home screen, beside their own reflective log. Shows the latest two. */
export function PupilSummariesCard({ summaries }: { summaries: PupilSummary[] }) {
  if (summaries.length === 0) return null;
  return (
    <View style={s.card} testID="pupil-summaries">
      <Text style={s.title}>From your instructor</Text>
      {summaries.slice(0, 2).map((x) => (
        <View key={x.id} style={s.item} testID={`pupil-summary-${x.id}`}>
          <Text style={s.meta}>
            {formatDate(x.lesson_date)}{x.topic ? ` · ${x.topic}` : ''}{x.instructor_first_name ? ` · ${x.instructor_first_name}` : ''}
          </Text>
          <Text style={s.body}>{x.summary}</Text>
          {!!x.next_plan && (
            <>
              <Text style={s.planLabel}>Next lesson</Text>
              <Text style={s.body}>{x.next_plan}</Text>
            </>
          )}
        </View>
      ))}
      <View style={s.note}>
        <Sparkles size={12} color={C.muted} />
        <Text style={s.noteText}>{SUMMARY_NOTE_PUPIL}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, gap: 10 },
  title: { fontFamily: 'Barlow_700Bold', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: C.primary },
  item: { gap: 4 },
  meta: { fontSize: 12, color: C.muted },
  planLabel: { fontSize: 12, fontWeight: '700', color: C.primary, marginTop: 6 },
  body: { fontSize: 14.5, lineHeight: 21, color: C.text },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  noteText: { flex: 1, fontSize: 11.5, color: C.muted },
});
