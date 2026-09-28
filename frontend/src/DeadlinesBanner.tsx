import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { AlertTriangle, CalendarClock, ChevronRight } from 'lucide-react-native';
import { listMyDeadlineItems } from './supabaseDb';
import { attentionSummary, daysUntil, needsAttention, type DeadlineItem } from './deadlines';

/**
 * Home-screen heads-up for the instructor's own deadlines (28 Sept 2026,
 * Migration 046): shows only when something is overdue or due within 30 days,
 * and disappears entirely otherwise — a card that's always there just gets
 * ignored. Paid plans only (the caller passes `enabled`), because Deadlines is
 * a paid feature. Reloads whenever Home regains focus so it updates as soon as
 * a date is renewed on the Deadlines screen. A failed load shows nothing: a
 * nudge failing to appear is not worth an error state.
 */
export function DeadlinesBanner({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<DeadlineItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let cancelled = false;
      listMyDeadlineItems()
        .then((list) => { if (!cancelled) setItems(list); })
        .catch(() => { /* see above */ });
      return () => { cancelled = true; };
    }, [enabled]),
  );

  if (!enabled) return null;
  const summary = attentionSummary(items);
  if (!summary) return null;

  const overdue = needsAttention(items).some((i) => (daysUntil(i.due_date) ?? 1) < 0);
  const accent = overdue ? '#B91C1C' : '#C2410C';
  const bg = overdue ? '#FEE2E2' : '#FFEDD5';

  return (
    <TouchableOpacity
      style={[s.card, { backgroundColor: bg, borderColor: accent }]}
      onPress={() => router.push('/deadlines-screen' as any)}
      activeOpacity={0.8}
      testID="home-deadlines-banner"
    >
      {overdue ? <AlertTriangle size={20} color={accent} /> : <CalendarClock size={20} color={accent} />}
      <View style={{ flex: 1 }}>
        <Text style={[s.title, { color: accent }]}>{overdue ? 'Deadline overdue' : 'Deadline coming up'}</Text>
        <Text style={s.sub} numberOfLines={2}>{summary}</Text>
      </View>
      <ChevronRight size={18} color={accent} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 20, marginTop: 12, borderRadius: 16, borderWidth: 1,
    paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  title: { fontFamily: 'Barlow_700Bold', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  sub: { fontFamily: 'Barlow_600SemiBold', fontSize: 14.5, color: '#0F172A', marginTop: 2 },
});
