import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { AlertTriangle, CloudSun } from 'lucide-react-native';
import { useAuth } from './AuthContext';
import { isPaidTier } from './tiers';
import type { Lesson, Student } from './supabaseDb';
import { useRoadBriefing } from './useRoadBriefing';

/**
 * Home card: today's road briefing. Pro and Franchise only. It appears only once something could really be checked
 * (live traffic between back-to-back lessons, or the forecast), and stays out of the way otherwise.
 */
export function RoadBriefingCard({ lessons, students }: { lessons: Lesson[]; students: Student[] }) {
  const { user } = useAuth();
  const paid = isPaidTier(user?.tier);
  const { briefing } = useRoadBriefing(lessons, students, paid);
  if (!paid || !briefing || !briefing.checked || !briefing.headline) return null;

  const warn = briefing.items.some((i) => i.severity === 'warn');
  const accent = warn ? '#B91C1C' : briefing.items.length ? '#C2410C' : '#047857';
  const bg = warn ? '#FEE2E2' : briefing.items.length ? '#FFF7ED' : '#ECFDF5';
  const shown = [...briefing.items].sort((a, b) => Number(b.severity === 'warn') - Number(a.severity === 'warn')).slice(0, 3);

  return (
    <View style={[s.card, { backgroundColor: bg, borderColor: accent }]} testID="home-road-briefing">
      <View style={s.head}>
        {warn ? <AlertTriangle size={20} color={accent} /> : <CloudSun size={20} color={accent} />}
        <View style={{ flex: 1 }}>
          <Text style={[s.label, { color: accent }]}>Today&apos;s road briefing</Text>
          <Text style={s.headline} testID="road-briefing-headline">{briefing.headline}</Text>
        </View>
      </View>
      {shown.map((it) => (
        <View key={it.key} style={s.row} testID={`road-item-${it.key}`}>
          <View style={[s.dot, { backgroundColor: it.severity === 'warn' ? '#B91C1C' : '#C2410C' }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.title} numberOfLines={2}>{it.title}</Text>
            {!!it.detail && <Text style={s.detail} numberOfLines={3}>{it.detail}</Text>}
          </View>
        </View>
      ))}
      <Text style={s.note}>Live traffic and the forecast can change. Check again before you set off.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 12, borderRadius: 16, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontFamily: 'Barlow_700Bold', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  headline: { fontFamily: 'Barlow_600SemiBold', fontSize: 15.5, color: '#0F172A', marginTop: 2 },
  row: { flexDirection: 'row', gap: 10, paddingLeft: 32 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  title: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: '#0F172A' },
  detail: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 17, color: '#6B6356', marginTop: 1 },
  note: { fontFamily: 'Barlow_400Regular', fontSize: 11.5, color: '#6B6356', paddingLeft: 32 },
});
