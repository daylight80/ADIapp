import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ChevronRight, CheckCircle2 } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { useActionCentre } from '../src/useActionCentre';
import { groupActionItems, actionSummary } from '../src/actionCentre';
import { routeForTarget } from '../src/actionCentreNav';

/**
 * Action Centre: one "what needs me today" list. Lessons that ended without being marked complete, recent and
 * upcoming cancellations, practical tests coming up, the instructor's own deadlines, pupils low on prepaid hours
 * and pupils who have gone quiet. Each row opens the right screen. It is built from data the app already holds
 * (see actionCentre.ts for the rules), so it costs nothing to run and is open to every plan.
 */
export default function ActionCentreScreen() {
  const router = useRouter();
  const { items, loading } = useActionCentre();
  const groups = groupActionItems(items);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="btn-back">
          <ArrowLeft size={20} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>Action Centre</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.summary} testID="action-centre-screen-summary">{loading && items.length === 0 ? 'Checking…' : actionSummary(items.length)}</Text>

        {loading && items.length === 0 && <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 20 }} />}

        {!loading && items.length === 0 && (
          <Card style={s.clear} testID="action-centre-clear">
            <CheckCircle2 size={34} color="#047857" />
            <Text style={s.clearTitle}>Nothing needs you right now</Text>
            <Text style={s.clearSub}>No lessons to wrap up, cancellations, tests coming up, deadlines, low prepaid hours or quiet pupils.</Text>
          </Card>
        )}

        {groups.map((g) => (
          <View key={g.group} style={{ gap: 8 }} testID={`group-${g.group}`}>
            <Text style={s.groupLabel}>{g.title} ({g.items.length})</Text>
            {g.items.map((it) => (
              <TouchableOpacity
                key={it.key}
                style={[s.row, it.urgent && s.rowUrgent]}
                onPress={() => router.push(routeForTarget(it.target) as any)}
                testID={`action-${it.key}`}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowTitle} numberOfLines={2}>{it.title}</Text>
                  <Text style={s.rowDetail} numberOfLines={2}>{it.detail}</Text>
                </View>
                <ChevronRight size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h3 },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 18 },
  summary: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  groupLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: theme.colors.textMuted },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
  },
  rowUrgent: { borderColor: '#B91C1C', backgroundColor: '#FEF2F2' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  rowDetail: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  clear: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  clearTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  clearSub: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center' },
});
