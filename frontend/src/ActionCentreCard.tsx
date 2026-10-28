import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { ListChecks, ChevronRight, CheckCircle2 } from 'lucide-react-native';
import { useActionCentre } from './useActionCentre';
import { useAuth } from './AuthContext';
import { isPaidTier } from './tiers';
import { actionSummary } from './actionCentre';
import { routeForTarget } from './actionCentreNav';

/**
 * Home card for the Action Centre: how many things need the instructor, the top three, and a way into the full
 * list. Always shown (with an "all caught up" line when there is nothing) so the way in never disappears.
 */
/** Paid plans only (Action Centre is a DC Pro feature): Starter sees nothing here and nothing is fetched. */
export function ActionCentreCard() {
  const { user } = useAuth();
  return isPaidTier(user?.tier) ? <ActionCentreCardContent /> : null;
}

function ActionCentreCardContent() {
  const router = useRouter();
  const { items, loading } = useActionCentre();
  const top = items.slice(0, 3);
  const urgent = items.some((i) => i.urgent);
  const accent = items.length === 0 ? '#047857' : urgent ? '#B91C1C' : '#C2410C';
  const bg = items.length === 0 ? '#ECFDF5' : urgent ? '#FEE2E2' : '#FFF7ED';

  return (
    <View style={[s.card, { backgroundColor: bg, borderColor: accent }]} testID="home-action-centre">
      <TouchableOpacity style={s.head} onPress={() => router.push('/action-centre-screen' as any)} activeOpacity={0.8} testID="action-centre-open">
        {items.length === 0 ? <CheckCircle2 size={20} color={accent} /> : <ListChecks size={20} color={accent} />}
        <View style={{ flex: 1 }}>
          <Text style={[s.label, { color: accent }]}>Needs attention</Text>
          <Text style={s.summary} testID="action-centre-summary">{loading && items.length === 0 ? 'Checking…' : actionSummary(items.length)}</Text>
        </View>
        {loading && items.length === 0 ? <ActivityIndicator size="small" color={accent} /> : <ChevronRight size={18} color={accent} />}
      </TouchableOpacity>
      {top.map((it) => (
        <TouchableOpacity
          key={it.key}
          style={s.row}
          onPress={() => router.push(routeForTarget(it.target) as any)}
          testID={`action-top-${it.key}`}
        >
          <View style={[s.dot, { backgroundColor: it.urgent ? '#B91C1C' : '#C2410C' }]} />
          <Text style={s.rowText} numberOfLines={1}>{it.title}</Text>
        </TouchableOpacity>
      ))}
      {items.length > top.length && (
        <Text style={s.more}>+ {items.length - top.length} more</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 12, borderRadius: 16, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontFamily: 'Barlow_700Bold', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  summary: { fontFamily: 'Barlow_600SemiBold', fontSize: 15.5, color: '#0F172A', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingLeft: 32 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  rowText: { flex: 1, fontFamily: 'Barlow_500Medium', fontSize: 14, color: '#0F172A' },
  more: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#6B6356', paddingLeft: 32 },
});
