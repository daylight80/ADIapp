import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { theme } from './theme';
import { Card } from './ui';
import { getMyDiaryPrefs, setMyDiaryPrefs } from './supabaseDb';
import { LESSON_TYPES } from './diary/lessonTypes';
import { LENGTH_CHOICES, MAX_LENGTHS, workHours, type DiaryPrefs, type LengthOption } from './diary/diaryPrefs';
import { lengthLabel } from './diary/lessonLength';

/** Loads the instructor's Add Lesson choices and saves a change to them, rolling back on failure. */
function useDiaryPrefs() {
  const [prefs, setPrefs] = useState<DiaryPrefs>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getMyDiaryPrefs().then((p) => { if (active) setPrefs(p); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const save = async (patch: DiaryPrefs): Promise<boolean> => {
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    setError(null);
    try {
      setPrefs(await setMyDiaryPrefs(patch));
      return true;
    } catch (e: any) {
      setPrefs(before);
      setError(e?.message || 'Could not save. Please try again.');
      return false;
    }
  };
  return { prefs, error, save };
}

/** Profile > Lesson types: tick the types Add Lesson should offer. Nothing ticked means all of them. */
export function LessonTypesCard() {
  const { prefs, error, save } = useDiaryPrefs();
  const chosen = prefs.lesson_types && prefs.lesson_types.length ? prefs.lesson_types : LESSON_TYPES.map((t) => t.value as string);
  const toggle = (value: string) => {
    const on = chosen.includes(value);
    if (on && chosen.length === 1) return; // always keep at least one
    const next = on ? chosen.filter((v) => v !== value) : [...chosen, value];
    save({ lesson_types: next.length === LESSON_TYPES.length ? null : next });
  };
  return (
    <Card style={{ gap: 10 }} testID="lesson-types-card">
      <Text style={styles.title}>Lesson types</Text>
      <Text style={styles.hint}>The types you pick here are the ones Add Lesson offers. Lessons already booked keep their type.</Text>
      <View style={styles.row}>
        {LESSON_TYPES.map((t) => {
          const on = chosen.includes(t.value);
          return (
            <TouchableOpacity key={t.value} style={[styles.chip, on && { backgroundColor: t.color, borderColor: t.color }]} onPress={() => toggle(t.value)} testID={`lesson-type-pref-${t.value}`}>
              <Text style={[styles.chipText, on && styles.chipTextActive]}>{t.value}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {!!error && <Text style={[styles.hint, { color: theme.colors.danger }]} testID="lesson-types-error">{error}</Text>}
    </Card>
  );
}

const STARTS = ['06:00', '07:00', '08:00', '09:00', '10:00'];
const ENDS = ['16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

/** Profile > Working hours: the hours "Next available" may suggest. */
export function WorkingHoursCard() {
  const { prefs, error, save } = useDiaryPrefs();
  const { start, end } = workHours(prefs);
  return (
    <Card style={{ gap: 10 }} testID="working-hours-card">
      <Text style={styles.title}>Working hours</Text>
      <Text style={styles.hint}>Add Lesson only suggests &quot;next available&quot; times between these hours.</Text>
      <Text style={styles.label}>Start</Text>
      <View style={styles.row}>
        {STARTS.map((t) => (
          <TouchableOpacity key={t} style={[styles.chip, start === t && styles.chipActive]} onPress={() => save({ work_start: t, work_end: end })} testID={`work-start-${t}`}>
            <Text style={[styles.chipText, start === t && styles.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Finish</Text>
      <View style={styles.row}>
        {ENDS.map((t) => (
          <TouchableOpacity key={t} style={[styles.chip, end === t && styles.chipActive]} onPress={() => save({ work_start: start, work_end: t })} testID={`work-end-${t}`}>
            <Text style={[styles.chipText, end === t && styles.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!!error && <Text style={[styles.hint, { color: theme.colors.danger }]} testID="working-hours-error">{error}</Text>}
    </Card>
  );
}

/**
 * Pricing & packages > Lesson lengths: the length chips Add Lesson offers, each with an optional total price.
 * A length with no price is priced from the hourly rate.
 */
export function LessonLengthsCard() {
  const { prefs, error, save } = useDiaryPrefs();
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [touched, setTouched] = useState(false);
  const lengths: LengthOption[] = prefs.lesson_lengths ?? [];
  // Show saved prices in the boxes once they load, until the instructor starts typing.
  useEffect(() => {
    if (touched) return;
    const next: Record<number, string> = {};
    (prefs.lesson_lengths ?? []).forEach((o) => { if (o.price != null) next[o.minutes] = o.price.toFixed(2); });
    setPrices(next);
  }, [prefs.lesson_lengths, touched]);

  const priceOf = (m: number): number | null => {
    const n = parseFloat((prices[m] ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null;
  };
  const toggle = (m: number) => {
    const on = lengths.some((o) => o.minutes === m);
    if (on) { save({ lesson_lengths: lengths.filter((o) => o.minutes !== m) }); return; }
    if (lengths.length >= MAX_LENGTHS) return;
    save({ lesson_lengths: [...lengths, { minutes: m, price: priceOf(m) }].sort((a, b) => a.minutes - b.minutes) });
  };
  const savePrices = () => {
    setTouched(false);
    save({ lesson_lengths: lengths.map((o) => ({ minutes: o.minutes, price: priceOf(o.minutes) })) });
  };

  return (
    <Card style={{ gap: 10 }} testID="lesson-lengths-card">
      <Text style={styles.title}>Lesson lengths</Text>
      <Text style={styles.hint}>
        Pick the lengths Add Lesson offers. Give a length a total price, or leave it blank to use your hourly rate times the length. Nothing picked means 1, 1½, 2 and 3 hrs.
      </Text>
      <View style={styles.row}>
        {LENGTH_CHOICES.map((m) => {
          const on = lengths.some((o) => o.minutes === m);
          return (
            <TouchableOpacity key={m} style={[styles.chip, on && styles.chipActive]} onPress={() => toggle(m)} testID={`length-pref-${m}`}>
              <Text style={[styles.chipText, on && styles.chipTextActive]}>{lengthLabel(m)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {lengths.map((o) => (
        <View key={o.minutes} style={styles.priceRow}>
          <Text style={styles.priceLabel}>{lengthLabel(o.minutes)}</Text>
          <Text style={styles.pound}>£</Text>
          <TextInput
            style={styles.priceInput}
            value={prices[o.minutes] ?? ''}
            onChangeText={(v) => { setTouched(true); setPrices({ ...prices, [o.minutes]: v.replace(/[^0-9.]/g, '') }); }}
            placeholder="from hourly rate"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="decimal-pad"
            testID={`length-price-${o.minutes}`}
          />
        </View>
      ))}
      {lengths.length > 0 && (
        <TouchableOpacity style={styles.saveBtn} onPress={savePrices} testID="length-prices-save">
          <Text style={styles.saveBtnText}>Save prices</Text>
        </TouchableOpacity>
      )}
      {!!error && <Text style={[styles.hint, { color: theme.colors.danger }]} testID="lesson-lengths-error">{error}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 12.5, color: theme.colors.textMuted },
  label: { fontSize: 12.5, fontWeight: '700', color: theme.colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minWidth: 62, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 12.5, fontWeight: '600', color: theme.colors.text, textAlign: 'center' },
  chipTextActive: { color: '#fff' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priceLabel: { width: 70, fontSize: 13.5, fontWeight: '600', color: theme.colors.text },
  pound: { fontSize: 15, color: theme.colors.textMuted },
  priceInput: { flex: 1, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 10, fontSize: 14, color: theme.colors.text },
  saveBtn: { minHeight: 42, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
