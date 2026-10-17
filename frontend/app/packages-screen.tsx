import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
  Alert, TextInput, Switch, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Plus, Pencil, Trash2, PoundSterling } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import {
  listLessonPackages, createLessonPackage, updateLessonPackage, deleteLessonPackage,
  LessonPackage,
  getInstructorHourlyRate, updateInstructorHourlyRate, getPupilRateCounts, applyDefaultRateToMyPupils,
} from '../src/supabaseDb';
import { bump } from '../src/useSupabaseData';
import {
  parseRate, rateChangeOffer, rateChangeQuestion, appliedMessage, packagesNeedingPrice, RATE_CHANGE_NOTE,
  type RateChangeOffer,
} from '../src/pricing';

type Form = {
  id?: string;
  name: string;
  hours: string;
  price: string;
  description: string;
  topic_tag: string;
  active: boolean;
};
const blankForm: Form = { name: '', hours: '', price: '', description: '', topic_tag: '', active: true };

export default function PackagesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<LessonPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hourly rate
  const [rate, setRate] = useState<string>('');
  const [savedRate, setSavedRate] = useState<number | null>(null);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateDirty, setRateDirty] = useState(false);
  // After a rate change: offer to move existing pupils to it.
  const [offer, setOffer] = useState<RateChangeOffer | null>(null);
  const [applying, setApplying] = useState(false);
  // Shown on the page, not as an Alert: Alert.alert does nothing in a browser, so on the web app
  // "Saved" and every error here used to be invisible.
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Form sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<Form>(blankForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [pkgs, hr] = await Promise.all([
        listLessonPackages(),
        getInstructorHourlyRate(),
      ]);
      setItems(pkgs);
      setSavedRate(hr);
      if (!rateDirty) setRate(String(hr));
    } catch (e: any) {
      setError(e?.message || 'Could not load packages.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rateDirty]);

  useEffect(() => { refresh(); }, [refresh]);
  const onRefresh = () => { setRefreshing(true); refresh(); };

  const saveRate = async () => {
    const n = parseRate(rate);
    if (n == null) {
      setNotice({ ok: false, text: 'Enter your default hourly rate in pounds, for example 40 or 37.50.' });
      return;
    }
    setRateBusy(true);
    setNotice(null);
    setOffer(null);
    try {
      const old = savedRate ?? n;
      await updateInstructorHourlyRate(n);
      setRate(n.toFixed(2));
      setRateDirty(false);
      setSavedRate(n);
      setNotice({ ok: true, text: `Default hourly rate set to £${n.toFixed(2)}. New pupils will start on it.` });
      try { setOffer(rateChangeOffer(old, n, await getPupilRateCounts())); } catch { /* the rate is saved; the offer is a bonus */ }
    } catch (e: any) {
      setNotice({ ok: false, text: e?.message || 'Could not save. Try again in a moment.' });
    } finally {
      setRateBusy(false);
    }
  };

  const applyRate = async (everyone: boolean) => {
    if (!offer) return;
    setApplying(true);
    setNotice(null);
    try {
      const changed = await applyDefaultRateToMyPupils(offer.newRate, everyone ? undefined : offer.oldRate);
      setNotice({ ok: true, text: appliedMessage(changed, offer.newRate) });
      bump();
      try { setOffer(rateChangeOffer(offer.newRate, offer.newRate, await getPupilRateCounts())); } catch { setOffer(null); }
    } catch (e: any) {
      setNotice({ ok: false, text: e?.message || 'Could not update your pupils. Try again in a moment.' });
    } finally {
      setApplying(false);
    }
  };

  const openNew = () => { setForm(blankForm); setFormError(null); setSheetOpen(true); };
  const openEdit = (p: LessonPackage) => {
    setFormError(null);
    setForm({
      id: p.id,
      name: p.name,
      hours: String(p.hours),
      price: p.price != null ? String(p.price) : '',
      description: p.description || '',
      topic_tag: p.topic_tag || '',
      active: p.active,
    });
    setSheetOpen(true);
  };

  const save = async () => {
    const hours = Number(form.hours);
    if (!form.name.trim() || !hours || hours <= 0) {
      setFormError('Please enter a name and a positive number of hours.');
      return;
    }
    const price = form.price.trim() === '' ? null : Number(form.price);
    if (price != null && (isNaN(price) || price < 0)) {
      setFormError('Leave the price blank, or enter it in pounds, for example 380.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      if (form.id) {
        await updateLessonPackage(form.id, {
          name: form.name, hours, price,
          description: form.description || null,
          topic_tag: form.topic_tag || null,
          active: form.active,
        });
      } else {
        await createLessonPackage({
          name: form.name, hours, price,
          description: form.description || null,
          topic_tag: form.topic_tag || null,
          active: form.active,
        });
      }
      setSheetOpen(false);
      setForm(blankForm);
      refresh();
    } catch (e: any) {
      setFormError(e?.message || 'Could not save the package.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (p: LessonPackage) => {
    const exec = async () => {
      try { await deleteLessonPackage(p.id); refresh(); }
      catch (e: any) {
        // Alert.alert is a silent no-op on web, so surface the failure there too.
        if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(`Delete failed: ${e?.message || 'Try again.'}`);
        else Alert.alert('Delete failed', e?.message);
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Delete "${p.name}"?`)) exec();
      return;
    }
    Alert.alert('Delete package', `Delete "${p.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: exec },
    ]);
  };

  const toggleActive = async (p: LessonPackage) => {
    try { await updateLessonPackage(p.id, { active: !p.active }); refresh(); }
    catch (e: any) { setNotice({ ok: false, text: e?.message || 'Could not change that package. Try again.' }); }
  };

  const grouped = useMemo(() => {
    const incomplete = packagesNeedingPrice(items);
    const ready = items.filter((p) => p.price != null);
    return { incomplete, ready };
  }, [items]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Pricing & packages</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        testID="packages-list"
      >
        {error ? (
          <Card style={{ borderColor: theme.colors.danger, borderWidth: 1 }}>
            <Text style={{ color: theme.colors.danger }}>{error}</Text>
          </Card>
        ) : null}

        {!!notice && (
          <Card
            style={{ borderWidth: 1, borderColor: notice.ok ? '#10B981' : theme.colors.danger, backgroundColor: notice.ok ? '#ECFDF5' : '#FEF2F2' }}
            testID="pricing-notice"
          >
            <Text style={{ color: notice.ok ? '#047857' : theme.colors.danger, fontWeight: '600', lineHeight: 19 }}>{notice.text}</Text>
          </Card>
        )}

        {/* Hourly rate */}
        <Card style={styles.rateCard}>
          <Text style={styles.cardTitle}>Default hourly rate</Text>
          <Text style={styles.cardSub}>
            New pupils start on this rate, and so does the diary&apos;s billable figure. You can still set a different rate for any pupil on their profile.
          </Text>
          <View style={styles.rateRow}>
            <PoundSterling size={18} color={theme.colors.textMuted} />
            <TextInput
              style={styles.rateInput}
              value={rate}
              onChangeText={(t) => { setRate(t.replace(/[^0-9.]/g, '')); setRateDirty(true); }}
              keyboardType="decimal-pad"
              placeholder="36.00"
              testID="input-rate"
            />
            <TouchableOpacity
              style={[styles.rateSaveBtn, (!rateDirty || rateBusy) && { opacity: 0.5 }]}
              onPress={saveRate}
              disabled={!rateDirty || rateBusy}
              testID="btn-save-rate"
            >
              {rateBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.rateSaveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </Card>

        {offer && (
          <Card style={{ gap: 10, borderWidth: 1, borderColor: theme.colors.primary }} testID="rate-apply-card">
            <Text style={styles.cardTitle}>Update your pupils?</Text>
            <Text style={styles.cardSub} testID="rate-apply-question">{rateChangeQuestion(offer)}</Text>
            {offer.onOld > 0 && (
              <TouchableOpacity
                style={[styles.rateSaveBtn, { alignSelf: 'stretch', alignItems: 'center' }, applying && { opacity: 0.5 }]}
                onPress={() => applyRate(false)}
                disabled={applying}
                testID="btn-apply-old"
              >
                <Text style={styles.rateSaveText}>
                  {`Move the ${offer.onOld} on £${offer.oldRate.toFixed(2)} to £${offer.newRate.toFixed(2)}`}
                </Text>
              </TouchableOpacity>
            )}
            {offer.onOther > 0 && (
              <TouchableOpacity
                style={[styles.rateSecondaryBtn, applying && { opacity: 0.5 }]}
                onPress={() => applyRate(true)}
                disabled={applying}
                testID="btn-apply-all"
              >
                <Text style={styles.rateSecondaryText}>{`Move all ${offer.total} to £${offer.newRate.toFixed(2)}`}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setOffer(null)} disabled={applying} testID="btn-apply-skip">
              <Text style={styles.skipText}>Leave them as they are</Text>
            </TouchableOpacity>
            <Text style={styles.cardSub}>{RATE_CHANGE_NOTE}</Text>
          </Card>
        )}

        {/* Packages */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Lesson packages</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openNew} testID="btn-add-package">
            <Plus size={16} color="#fff" />
            <Text style={styles.addBtnText}>New</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.cardSub} testID="packages-hint">
          When you add hours to a pupil&apos;s wallet you can choose one of these packages, and the hours and price are recorded as the package.
        </Text>

        {grouped.incomplete.length > 0 && (
          <Card style={[styles.warnCard, { marginBottom: 12 }]}>
            <Text style={styles.warnTitle}>{grouped.incomplete.length} package{grouped.incomplete.length === 1 ? '' : 's'} need pricing</Text>
            <Text style={styles.warnSub}>
              Tap a package below to set its price. A package without a price can&apos;t be chosen yet when you add hours to a pupil&apos;s wallet.
            </Text>
          </Card>
        )}

        {items.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 28 }}>
            <Text style={styles.emptyTitle}>No packages yet</Text>
            <Text style={styles.emptySub}>Tap &quot;New&quot; to add your first package.</Text>
          </Card>
        ) : (
          items.map((p) => (
            <Card key={p.id} style={[styles.pkgCard, !p.active && { opacity: 0.55 }]} testID={`pkg-${p.id}`}>
              <View style={styles.pkgHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgName}>{p.name}</Text>
                  <Text style={styles.pkgMeta}>
                    {p.hours} hr{p.hours === 1 ? '' : 's'}
                    {p.topic_tag ? ` · ${p.topic_tag}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {p.price != null ? (
                    <>
                      <Text style={styles.pkgPrice}>£{p.price.toFixed(2)}</Text>
                      <Text style={styles.pkgPerHr}>£{(p.price / p.hours).toFixed(2)}/hr</Text>
                    </>
                  ) : (
                    <Text style={styles.pkgNoPrice}>Set price</Text>
                  )}
                </View>
              </View>
              {p.description ? <Text style={styles.pkgDesc}>{p.description}</Text> : null}
              <View style={styles.pkgActions}>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Active</Text>
                  <Switch
                    value={p.active}
                    onValueChange={() => toggleActive(p)}
                    trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                    testID={`switch-active-${p.id}`}
                  />
                </View>
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={() => openEdit(p)} style={styles.iconAction} testID={`btn-edit-${p.id}`}>
                  <Pencil size={16} color={theme.colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete(p)} style={styles.iconAction} testID={`btn-delete-${p.id}`}>
                  <Trash2 size={16} color={theme.colors.danger} />
                </TouchableOpacity>
              </View>
            </Card>
          ))
        )}
        <View style={{ height: 60 }} />
      </ScrollView>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => { setSheetOpen(false); setForm(blankForm); }}
        title={form.id ? 'Edit package' : 'New package'}
        testID="sheet-package"
      >
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={form.name}
          onChangeText={(t) => setForm({ ...form, name: t })}
          placeholder="e.g. Pass Plus"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-name"
        />

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Hours</Text>
            <TextInput
              style={styles.input}
              value={form.hours}
              onChangeText={(t) => setForm({ ...form, hours: t.replace(/[^0-9.]/g, '') })}
              placeholder="6"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              testID="input-hours"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Price £ (optional)</Text>
            <TextInput
              style={styles.input}
              value={form.price}
              onChangeText={(t) => setForm({ ...form, price: t.replace(/[^0-9.]/g, '') })}
              placeholder="240.00"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              testID="input-price"
            />
          </View>
        </View>

        <Text style={styles.label}>Topic tag (optional)</Text>
        <TextInput
          style={styles.input}
          value={form.topic_tag}
          onChangeText={(t) => setForm({ ...form, topic_tag: t })}
          placeholder="Pass Plus, Refresher, Motorway…"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-topic-tag"
        />

        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          style={[styles.input, { height: 60 }]}
          value={form.description}
          onChangeText={(t) => setForm({ ...form, description: t })}
          placeholder="A short note for yourself"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          textAlignVertical="top"
          testID="input-description"
        />

        <View style={styles.switchRowSheet}>
          <Text style={styles.label}>Active</Text>
          <Switch
            value={form.active}
            onValueChange={(v) => setForm({ ...form, active: v })}
            trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
            testID="switch-form-active"
          />
        </View>

        {!!formError && (
          <Text style={{ color: theme.colors.danger, fontSize: 13, lineHeight: 18, marginTop: 8 }} testID="package-form-error">{formError}</Text>
        )}

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
          testID="btn-save-package"
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{form.id ? 'Save changes' : 'Create package'}</Text>}
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, justifyContent: 'space-between' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },
  scroll: { padding: 16, gap: 12, paddingBottom: 60 },

  rateCard: { gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: theme.colors.text },
  cardSub: { fontSize: 12, color: theme.colors.textMuted, lineHeight: 16 },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, paddingHorizontal: 12, height: 46 },
  rateInput: { flex: 1, fontSize: 15, color: theme.colors.text },
  rateSaveBtn: { backgroundColor: theme.colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  rateSaveText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  rateSecondaryBtn: { alignSelf: 'stretch', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.primary },
  rateSecondaryText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },
  skipText: { color: theme.colors.textMuted, fontWeight: '600', fontSize: 13, textAlign: 'center' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text, flex: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.primary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  warnCard: { backgroundColor: theme.colors.lockedBg, borderColor: theme.colors.lockedBorder, borderWidth: 1, gap: 4 },
  warnTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  warnSub: { fontSize: 12, color: theme.colors.textMuted, lineHeight: 16 },

  pkgCard: { gap: 8 },
  pkgHeader: { flexDirection: 'row', alignItems: 'center' },
  pkgName: { fontSize: 15, fontWeight: '800', color: theme.colors.text },
  pkgMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  pkgPrice: { fontSize: 17, fontWeight: '800', color: theme.colors.primary },
  pkgPerHr: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  pkgNoPrice: { fontSize: 12, fontWeight: '700', color: theme.colors.accent },
  pkgDesc: { fontSize: 12, color: theme.colors.textMuted, fontStyle: 'italic' },
  pkgActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 8 },
  iconAction: { padding: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  switchLabel: { fontSize: 12, color: theme.colors.textMuted, fontWeight: '600' },
  switchRowSheet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },

  emptyTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  emptySub: { fontSize: 13, color: theme.colors.textMuted },

  label: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: theme.colors.background, color: theme.colors.text },
  row2: { flexDirection: 'row', gap: 10 },
  saveBtn: { marginTop: 16, height: 50, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
