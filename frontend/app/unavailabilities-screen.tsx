import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Plus, Ban, CalendarRange, Clock, Tag } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card, Badge } from '../src/ui';
import { useAvailabilityBlocks } from '../src/useSupabaseData';
import type { AvailabilityBlock } from '../src/supabaseDb';
import { UnavailabilityModal } from '../src/UnavailabilityModal';
import { BottomNav } from '../src/BottomNav';

/**
 * Dedicated Unavailabilities screen. Lists upcoming and past blocks, with a
 * prominent "Add" button and tap-to-edit. The same modal used in the Diary
 * powers the CRUD here too.
 */
export default function UnavailabilitiesScreen() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<AvailabilityBlock | null>(null);

  // Fetch a wide window — last 6 months → next 12 months.
  const range = useMemo(() => {
    const from = new Date(); from.setMonth(from.getMonth() - 6); from.setHours(0, 0, 0, 0);
    const to = new Date(); to.setMonth(to.getMonth() + 12); to.setHours(0, 0, 0, 0);
    return { from, to };
  }, []);
  const { blocks, loading, error } = useAvailabilityBlocks(range.from, range.to);

  const now = new Date();
  const sorted = useMemo(() => {
    const u = [...blocks].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const upcoming = u.filter((b) => new Date(b.ends_at) >= now);
    const past = u.filter((b) => new Date(b.ends_at) < now).reverse();
    return { upcoming, past };
  }, [blocks]);

  const onAdd = () => { setEditingBlock(null); setModalOpen(true); };
  const onRowPress = (b: AvailabilityBlock) => { setEditingBlock(b); setModalOpen(true); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="btn-back" style={styles.iconBtn}>
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Unavailabilities</Text>
        <TouchableOpacity onPress={onAdd} style={styles.iconBtn} testID="btn-add-unavail">
          <Plus size={22} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}>
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ban size={16} color={theme.colors.danger} />
            <Text style={styles.intro}>Mark time off so it shows as grey bands in your diary.</Text>
          </View>
          <Text style={styles.subIntro}>
            Lessons cannot be added inside an unavailability. Tap a block to edit or delete.
          </Text>
        </Card>

        {loading ? (
          <View style={{ alignItems: 'center', padding: 24 }}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : error ? (
          <Card><Text style={styles.errText}>{error}</Text></Card>
        ) : (
          <>
            <Section title={`Upcoming (${sorted.upcoming.length})`}>
              {sorted.upcoming.length === 0 ? (
                <Empty />
              ) : sorted.upcoming.map((b) => (
                <BlockRow key={b.id} block={b} onPress={() => onRowPress(b)} />
              ))}
            </Section>

            {sorted.past.length > 0 && (
              <Section title={`Past (${sorted.past.length})`}>
                {sorted.past.slice(0, 10).map((b) => (
                  <BlockRow key={b.id} block={b} onPress={() => onRowPress(b)} dim />
                ))}
              </Section>
            )}
          </>
        )}
      </ScrollView>

      <UnavailabilityModal
        visible={modalOpen}
        block={editingBlock}
        onClose={() => setModalOpen(false)}
      />

      <BottomNav />
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

function Empty() {
  return (
    <Card>
      <Text style={styles.empty}>No upcoming unavailabilities. Tap + to add one.</Text>
    </Card>
  );
}

function BlockRow({ block, onPress, dim }: { block: AvailabilityBlock; onPress: () => void; dim?: boolean }) {
  const start = new Date(block.starts_at);
  const end = new Date(block.ends_at);
  const sameDay = start.toDateString() === end.toDateString();
  const dateLabel = sameDay
    ? start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const timeLabel = block.all_day
    ? 'All day'
    : `${start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <TouchableOpacity onPress={onPress} testID={`unavail-row-${block.id}`} activeOpacity={0.7}>
      <Card style={[styles.row, dim && { opacity: 0.6 }] as any}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CalendarRange size={14} color={theme.colors.text} />
            <Text style={styles.dateText}>{dateLabel}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Clock size={13} color={theme.colors.textMuted} />
            <Text style={styles.timeText}>{timeLabel}</Text>
          </View>
          {block.reason ? (
            <Text style={styles.reasonText} numberOfLines={2}>{block.reason}</Text>
          ) : null}
        </View>
        <Badge label={block.category.charAt(0).toUpperCase() + block.category.slice(1)} />
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  title: { fontSize: 18, fontWeight: '800', color: theme.colors.text },
  iconBtn: { padding: 6 },
  intro: { color: theme.colors.text, fontWeight: '700', fontSize: 13 },
  subIntro: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: theme.colors.textMuted, letterSpacing: 0.5, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateText: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  timeText: { fontSize: 12, color: theme.colors.textMuted },
  reasonText: { fontSize: 12, color: theme.colors.text, marginTop: 2 },
  empty: { color: theme.colors.textMuted, textAlign: 'center', paddingVertical: 6 },
  errText: { color: theme.colors.danger, fontSize: 13 },
});
