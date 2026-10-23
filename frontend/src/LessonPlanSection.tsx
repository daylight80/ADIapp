import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from './theme';
import { DVSA_SYLLABUS } from './supabaseDb';
import { patchLessonOfflineAware } from './offlineSync';
import { addTopic, removeTopic, toggleCovered, topicName, MAX_PLAN_BRIEF, type Plan } from './lessonPlan';

type Props = {
  lesson: { id: string; plan_topics?: string[]; plan_covered?: string[]; plan_brief?: string };
  /** Weak topics not yet planned, offered as one-tap suggestions. */
  suggestions: string[];
  label: string;
  onSaved?: () => void;
};

/** Plan for a lesson (paid plans): pick syllabus topics, write a short briefing, tick topics off during the lesson. */
export function LessonPlanSection({ lesson, suggestions, label, onSaved }: Props) {
  const [plan, setPlan] = useState<Plan>({ topics: lesson.plan_topics ?? [], covered: lesson.plan_covered ?? [] });
  const [brief, setBrief] = useState(lesson.plan_brief ?? '');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlan({ topics: lesson.plan_topics ?? [], covered: lesson.plan_covered ?? [] });
    setBrief(lesson.plan_brief ?? '');
  }, [lesson.id, lesson.plan_topics, lesson.plan_covered, lesson.plan_brief]);

  const save = async (patch: { plan_topics?: string[]; plan_covered?: string[]; plan_brief?: string | null }) => {
    setError(null);
    try {
      await patchLessonOfflineAware(lesson.id, patch as any, label);
      onSaved?.();
    } catch (e: any) {
      setError(e?.message || 'Could not save the plan. Please try again.');
    }
  };
  const change = (next: Plan) => { setPlan(next); save({ plan_topics: next.topics, plan_covered: next.covered }); };

  const unplanned = DVSA_SYLLABUS.filter((t) => !plan.topics.includes(t.key));
  const suggested = suggestions.filter((k) => !plan.topics.includes(k));

  return (
    <View style={s.card} testID="lesson-plan">
      <Text style={s.title}>Lesson plan</Text>

      {plan.topics.length === 0 && <Text style={s.hint}>No topics planned yet.</Text>}
      {plan.topics.map((k) => {
        const done = plan.covered.includes(k);
        return (
          <View key={k} style={s.row}>
            <TouchableOpacity style={s.rowMain} onPress={() => change(toggleCovered(plan, k))} accessibilityRole="checkbox" accessibilityState={{ checked: done }} testID={`plan-tick-${k}`}>
              <Text style={[s.box, done && s.boxOn]}>{done ? '✓' : ''}</Text>
              <Text style={[s.name, done && s.nameDone]}>{topicName(k)}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => change(removeTopic(plan, k))} accessibilityLabel={`Remove ${topicName(k)}`} testID={`plan-remove-${k}`}>
              <Text style={s.remove}>{'×'}</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {suggested.length > 0 && (
        <View style={s.chips} testID="plan-suggestions">
          <Text style={s.hint}>Suggested: </Text>
          {suggested.map((k) => (
            <TouchableOpacity key={k} style={s.chip} onPress={() => change(addTopic(plan, k))} testID={`plan-suggest-${k}`}>
              <Text style={s.chipText}>+ {topicName(k)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity onPress={() => setAdding((v) => !v)} testID="plan-add-toggle">
        <Text style={s.link}>{adding ? 'Done adding' : '+ Add topics'}</Text>
      </TouchableOpacity>
      {adding && (
        <View style={s.chips}>
          {unplanned.map((t) => (
            <TouchableOpacity key={t.key} style={s.chip} onPress={() => change(addTopic(plan, t.key))} testID={`plan-add-${t.key}`}>
              <Text style={s.chipText}>{t.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={s.hint}>Briefing for the pupil (where you will go, what to expect). They see this on their Next lesson card.</Text>
      <TextInput
        style={s.input}
        value={brief}
        onChangeText={setBrief}
        onEndEditing={() => { if (brief.trim() !== (lesson.plan_brief ?? '').trim()) save({ plan_brief: brief.trim() || null }); }}
        multiline
        maxLength={MAX_PLAN_BRIEF}
        placeholder="e.g. Residential roads, then the Sutton roundabouts"
        placeholderTextColor={theme.colors.textMuted}
        testID="plan-brief"
      />
      {!!error && <Text style={s.error} testID="plan-error">{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { padding: 14, gap: 8, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 12.5, color: theme.colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: theme.colors.border, textAlign: 'center', lineHeight: 20, fontWeight: '800', color: '#fff' },
  boxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  name: { fontSize: 14.5, color: theme.colors.text },
  nameDone: { textDecorationLine: 'line-through', color: theme.colors.textMuted },
  remove: { fontSize: 22, paddingHorizontal: 8, color: theme.colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { paddingHorizontal: 10, minHeight: 32, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 12.5, fontWeight: '600', color: theme.colors.text },
  link: { fontSize: 13.5, fontWeight: '700', color: theme.colors.primary },
  input: { minHeight: 64, padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: '#fff', fontSize: 14, color: theme.colors.text, textAlignVertical: 'top' },
  error: { fontSize: 13, color: theme.colors.danger },
});
