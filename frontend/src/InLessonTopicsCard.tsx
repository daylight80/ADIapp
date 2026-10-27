import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from './theme';
import { getLessonById } from './supabaseDb';
import { patchLessonOfflineAware } from './offlineSync';
import { useCompetencies, updateCompetency } from './useSupabaseData';
import { topicName, toggleCovered, type Plan } from './lessonPlan';
import { levelLabel, MAX_LEVEL } from './competencyLevels';

/**
 * Shown while a lesson is being recorded: the topics planned for it, to tick off as they are covered, with the pupil's
 * current level on each so it can be moved up or down on the spot. Nothing shows when the lesson has no plan.
 */
export function InLessonTopicsCard({ lessonId, studentId, studentName }: { lessonId: string; studentId: string; studentName?: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { competencies } = useCompetencies(studentId);

  useEffect(() => {
    let alive = true;
    getLessonById(lessonId)
      .then((l) => { if (alive && l) setPlan({ topics: l.plan_topics ?? [], covered: l.plan_covered ?? [] }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [lessonId]);

  if (!plan || plan.topics.length === 0) return null;

  const tick = (key: string) => {
    const next = toggleCovered(plan, key);
    setPlan(next);
    setError(null);
    patchLessonOfflineAware(lessonId, { plan_topics: next.topics, plan_covered: next.covered } as any, `Lesson plan: ${studentName || 'pupil'}`)
      .catch((e: any) => setError(e?.message || 'Could not save that tick. Please try again.'));
  };

  const move = async (key: string, delta: number) => {
    const current = competencies.find((c) => c.category_key === key)?.level ?? 1;
    const next = Math.min(MAX_LEVEL, Math.max(1, current + delta));
    if (next === current) return;
    setError(null);
    try {
      await updateCompetency(studentId, key, { level: next });
    } catch (e: any) {
      setError(e?.message || 'Could not change the level. Please try again.');
    }
  };

  return (
    <View style={s.card} testID="in-lesson-topics">
      <Text style={s.title}>Today&apos;s topics</Text>
      {plan.topics.map((k) => {
        const done = plan.covered.includes(k);
        const level = competencies.find((c) => c.category_key === k)?.level ?? 1;
        return (
          <View key={k} style={s.row}>
            <TouchableOpacity style={s.main} onPress={() => tick(k)} accessibilityRole="checkbox" accessibilityState={{ checked: done }} testID={`topic-tick-${k}`}>
              <Text style={[s.box, done && s.boxOn]}>{done ? '✓' : ''}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.name, done && s.nameDone]}>{topicName(k)}</Text>
                <Text style={s.level} testID={`topic-level-${k}`}>{levelLabel(level)} ({level} of {MAX_LEVEL})</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={s.step} onPress={() => move(k, -1)} accessibilityLabel={`Lower ${topicName(k)} level`} testID={`topic-down-${k}`}>
              <Text style={s.stepText}>{'−'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.step} onPress={() => move(k, 1)} accessibilityLabel={`Raise ${topicName(k)} level`} testID={`topic-up-${k}`}>
              <Text style={s.stepText}>+</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      {!!error && <Text style={s.error} testID="topics-error">{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { alignSelf: 'stretch', gap: 8, marginTop: 8 },
  title: { fontSize: 12, color: theme.colors.textMuted, fontWeight: '800', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 1.5, borderColor: theme.colors.border, textAlign: 'center', lineHeight: 24, color: '#fff', fontWeight: '800' },
  boxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  name: { fontSize: 14.5, fontWeight: '700', color: theme.colors.text },
  nameDone: { textDecorationLine: 'line-through', color: theme.colors.textMuted },
  level: { fontSize: 12, color: theme.colors.textMuted, marginTop: 1 },
  step: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '700', color: theme.colors.primary, lineHeight: 26 },
  error: { fontSize: 13, color: '#B91C1C' },
});
