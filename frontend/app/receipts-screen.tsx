import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
  TextInput, Platform, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Camera, ImagePlus, Plus, Trash2, Download, Receipt as ReceiptIcon } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '../src/theme';
import { Card, Badge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import { supabase } from '../src/supabaseClient';
import {
  listReceipts, createReceipt, deleteReceipt, uploadReceiptImage,
  RECEIPT_CATEGORIES, ExpenseReceipt, ReceiptCategory,
} from '../src/supabaseDb';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type ScanResult = {
  vendor?: string | null;
  occurred_at?: string | null;
  amount_total?: number | null;
  vat_amount?: number | null;
  category?: ReceiptCategory | null;
};

export default function ReceiptsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ExpenseReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ReceiptCategory | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  // Add-receipt sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [form, setForm] = useState<{
    vendor: string; occurred_at: string; amount_total: string;
    vat_amount: string; category: ReceiptCategory; notes: string;
  }>({
    vendor: '', occurred_at: new Date().toISOString().slice(0, 10),
    amount_total: '', vat_amount: '', category: 'fuel', notes: '',
  });

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const rows = await listReceipts();
      setItems(rows);
    } catch (e: any) {
      setError(e?.message || 'Could not load receipts.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  const onRefresh = () => { setRefreshing(true); refresh(); };

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((r) => r.category === filter)),
    [items, filter],
  );

  const totals = useMemo(() => {
    const sum = filtered.reduce((s, r) => s + r.amount_total, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const monthIso = monthStart.toISOString().slice(0, 10);
    const monthSum = filtered
      .filter((r) => r.occurred_at >= monthIso)
      .reduce((s, r) => s + r.amount_total, 0);
    return { sum, monthSum, count: filtered.length };
  }, [filtered]);

  const resetSheet = () => {
    setImageBase64(null); setImagePreview(null); setImageMime('image/jpeg');
    setForm({
      vendor: '', occurred_at: new Date().toISOString().slice(0, 10),
      amount_total: '', vat_amount: '', category: 'fuel', notes: '',
    });
  };

  const pickFromCamera = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Camera access is required to scan receipts.'); return; }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true, quality: 0.7, allowsEditing: true,
      });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        setImageBase64(a.base64 || null);
        setImageMime(a.mimeType || 'image/jpeg');
        setImagePreview(a.uri);
        if (a.base64) runOcr(a.base64, a.mimeType || 'image/jpeg');
      }
    } catch (e: any) {
      Alert.alert('Camera unavailable', e?.message || 'Could not open the camera.');
    }
  };

  const pickFromGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true, quality: 0.7, allowsEditing: true,
      });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        setImageBase64(a.base64 || null);
        setImageMime(a.mimeType || 'image/jpeg');
        setImagePreview(a.uri);
        if (a.base64) runOcr(a.base64, a.mimeType || 'image/jpeg');
      }
    } catch (e: any) {
      Alert.alert('Picker error', e?.message || 'Could not open the gallery.');
    }
  };

  const runOcr = async (b64: string, mime: string) => {
    setScanning(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const resp = await fetch(`${BACKEND}/api/receipts/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image_base64: b64, mime_type: mime }),
      });
      const json = (await resp.json()) as ScanResult & { status?: string; detail?: string };
      if (!resp.ok) throw new Error((json as any)?.detail || `OCR failed (HTTP ${resp.status})`);
      setForm((prev) => ({
        vendor: json.vendor || prev.vendor,
        occurred_at: json.occurred_at || prev.occurred_at,
        amount_total: json.amount_total != null ? String(json.amount_total) : prev.amount_total,
        vat_amount: json.vat_amount != null ? String(json.vat_amount) : prev.vat_amount,
        category: (json.category as ReceiptCategory) || prev.category,
        notes: prev.notes,
      }));
    } catch (e: any) {
      Alert.alert('OCR failed', e?.message || 'Could not read the receipt. You can still enter the details manually.');
    } finally {
      setScanning(false);
    }
  };

  const saveReceipt = async () => {
    const amount = Number(form.amount_total);
    if (!amount || amount <= 0) { Alert.alert('Amount required', 'Please enter the receipt total in pounds.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.occurred_at)) { Alert.alert('Invalid date', 'Use YYYY-MM-DD format for the receipt date.'); return; }
    setSaving(true);
    try {
      let storagePath: string | null = null;
      if (imageBase64) {
        try {
          storagePath = await uploadReceiptImage(imageBase64, imageMime);
        } catch (uploadErr: any) {
          // Non-fatal — save the row anyway, just without the image.
          console.warn('[receipts] upload failed', uploadErr?.message);
        }
      }
      await createReceipt({
        category: form.category,
        vendor: form.vendor || null,
        occurred_at: form.occurred_at,
        amount_total: amount,
        vat_amount: form.vat_amount ? Number(form.vat_amount) : null,
        storage_path: storagePath,
        notes: form.notes || null,
      });
      setSheetOpen(false);
      resetSheet();
      refresh();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save the receipt.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (r: ExpenseReceipt) => {
    const exec = async () => {
      try { await deleteReceipt(r.id, r.storage_path); refresh(); }
      catch (e: any) { Alert.alert('Delete failed', e?.message || 'Could not delete.'); }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Delete ${r.vendor || 'this receipt'}?`)) exec();
      return;
    }
    Alert.alert('Delete receipt', `Delete ${r.vendor || 'this receipt'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: exec },
    ]);
  };

  const exportCsv = async () => {
    const rows = filtered;
    if (rows.length === 0) { Alert.alert('Nothing to export', 'No receipts in the current view.'); return; }
    const header = 'date,category,vendor,amount_gbp,vat_gbp,notes';
    const lines = rows.map((r) => [
      r.occurred_at, r.category,
      (r.vendor || '').replace(/[",\n]/g, ' '),
      r.amount_total.toFixed(2),
      r.vat_amount != null ? r.vat_amount.toFixed(2) : '',
      (r.notes || '').replace(/[",\n]/g, ' '),
    ].join(','));
    const csv = [header, ...lines].join('\n');

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `receipts-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      return;
    }
    try {
      const path = `${FileSystem.cacheDirectory}receipts-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export receipts' });
      } else {
        Alert.alert('Saved', `CSV saved to ${path}`);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not export CSV.');
    }
  };

  const catLabel = (k: ReceiptCategory) =>
    RECEIPT_CATEGORIES.find((c) => c.key === k)?.label || k;
  const catEmoji = (k: ReceiptCategory) =>
    RECEIPT_CATEGORIES.find((c) => c.key === k)?.emoji || '📄';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Receipts</Text>
        <TouchableOpacity onPress={exportCsv} style={styles.iconBtn} testID="btn-export-csv">
          <Download size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Totals */}
      <View style={styles.totalsRow}>
        <Card style={styles.totalCard}>
          <Text style={styles.totalLabel}>This month</Text>
          <Text style={styles.totalValue}>£{totals.monthSum.toFixed(2)}</Text>
        </Card>
        <Card style={styles.totalCard}>
          <Text style={styles.totalLabel}>{filter === 'all' ? 'All time' : catLabel(filter)}</Text>
          <Text style={styles.totalValue}>£{totals.sum.toFixed(2)}</Text>
          <Text style={styles.totalSub}>{totals.count} receipt{totals.count === 1 ? '' : 's'}</Text>
        </Card>
      </View>

      {/* Category filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        {RECEIPT_CATEGORIES.map((c) => (
          <FilterChip key={c.key} label={`${c.emoji} ${c.label}`} active={filter === c.key} onPress={() => setFilter(c.key)} />
        ))}
      </ScrollView>

      {/* List */}
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        testID="receipts-list"
      >
        {loading ? (
          <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 32 }} />
        ) : error ? (
          <Card><Text style={styles.errorText}>{error}</Text></Card>
        ) : filtered.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 32 }}>
            <ReceiptIcon size={42} color={theme.colors.textMuted} />
            <Text style={styles.emptyTitle}>No receipts yet</Text>
            <Text style={styles.emptySub}>
              Tap the + button to scan a fuel, maintenance or car-wash receipt.
            </Text>
          </Card>
        ) : (
          filtered.map((r) => (
            <Card key={r.id} style={styles.itemCard} testID={`receipt-${r.id}`}>
              <View style={styles.itemRow}>
                <Text style={styles.emoji}>{catEmoji(r.category)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vendor} numberOfLines={1}>{r.vendor || catLabel(r.category)}</Text>
                  <Text style={styles.subRow}>
                    {new Date(r.occurred_at).toLocaleDateString('en-GB')} · {catLabel(r.category)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.amount}>£{r.amount_total.toFixed(2)}</Text>
                  {r.vat_amount != null && (
                    <Text style={styles.vat}>VAT £{r.vat_amount.toFixed(2)}</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => confirmDelete(r)} style={styles.delBtn} testID={`btn-delete-${r.id}`}>
                  <Trash2 size={18} color={theme.colors.danger} />
                </TouchableOpacity>
              </View>
              {r.notes ? <Text style={styles.note}>{r.notes}</Text> : null}
            </Card>
          ))
        )}
        <View style={{ height: 96 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => { resetSheet(); setSheetOpen(true); }}
        testID="btn-add-receipt"
      >
        <Plus size={26} color="#fff" />
      </TouchableOpacity>

      {/* Add-receipt bottom sheet */}
      <BottomSheet
        visible={sheetOpen}
        onClose={() => { setSheetOpen(false); resetSheet(); }}
        title="New receipt"
        testID="sheet-add-receipt"
      >
        {/* Image actions */}
        <View style={styles.imgActions}>
          <TouchableOpacity style={[styles.imgBtn, { backgroundColor: theme.colors.primary }]} onPress={pickFromCamera} testID="btn-scan-camera">
            <Camera size={18} color="#fff" />
            <Text style={styles.imgBtnText}>Scan with camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.imgBtn, { backgroundColor: theme.colors.accent }]} onPress={pickFromGallery} testID="btn-scan-gallery">
            <ImagePlus size={18} color="#fff" />
            <Text style={styles.imgBtnText}>From gallery</Text>
          </TouchableOpacity>
        </View>

        {scanning && (
          <View style={styles.scanRow}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.scanText}>Reading receipt…</Text>
          </View>
        )}

        {imagePreview && (
          <Image source={{ uri: imagePreview }} style={styles.preview} resizeMode="contain" />
        )}

        {/* Form */}
        <Text style={styles.label}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
          {RECEIPT_CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[styles.catChip, form.category === c.key && styles.catChipActive]}
              onPress={() => setForm({ ...form, category: c.key })}
              testID={`cat-${c.key}`}
            >
              <Text style={[styles.catChipText, form.category === c.key && { color: '#fff' }]}>
                {c.emoji} {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.label}>Vendor</Text>
        <TextInput
          style={styles.input}
          value={form.vendor}
          onChangeText={(t) => setForm({ ...form, vendor: t })}
          placeholder="Shell, Halfords, Kwik Fit…"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-vendor"
        />

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              value={form.occurred_at}
              onChangeText={(t) => setForm({ ...form, occurred_at: t })}
              placeholder="2025-06-12"
              placeholderTextColor={theme.colors.textMuted}
              testID="input-date"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Total £</Text>
            <TextInput
              style={styles.input}
              value={form.amount_total}
              onChangeText={(t) => setForm({ ...form, amount_total: t.replace(/[^0-9.]/g, '') })}
              placeholder="45.20"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              testID="input-amount"
            />
          </View>
        </View>

        <Text style={styles.label}>VAT (optional)</Text>
        <TextInput
          style={styles.input}
          value={form.vat_amount}
          onChangeText={(t) => setForm({ ...form, vat_amount: t.replace(/[^0-9.]/g, '') })}
          placeholder="7.54"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="decimal-pad"
          testID="input-vat"
        />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, { height: 70 }]}
          value={form.notes}
          onChangeText={(t) => setForm({ ...form, notes: t })}
          placeholder="Optional notes — e.g. ‘Service interval 12k miles’"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          textAlignVertical="top"
          testID="input-notes"
        />

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={saveReceipt}
          disabled={saving}
          testID="btn-save-receipt"
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save receipt</Text>}
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]}>
      <Text style={[styles.filterText, active && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },

  totalsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 6 },
  totalCard: { flex: 1, gap: 2, paddingVertical: 14 },
  totalLabel: { ...theme.font.caption, color: theme.colors.textMuted },
  totalValue: { fontSize: 20, fontWeight: '800', color: theme.colors.text },
  totalSub: { fontSize: 11, color: theme.colors.textMuted },

  filterRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  filterChip: { backgroundColor: theme.colors.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: theme.colors.border },
  filterChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  filterText: { fontSize: 13, color: theme.colors.text },

  list: { padding: 16, gap: 10, paddingBottom: 80 },
  itemCard: { gap: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emoji: { fontSize: 24 },
  vendor: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  subRow: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '800', color: theme.colors.primary },
  vat: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  delBtn: { padding: 6 },
  note: { fontSize: 13, color: theme.colors.textMuted, fontStyle: 'italic' },
  errorText: { color: theme.colors.danger, fontSize: 13 },

  emptyTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  emptySub: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center', paddingHorizontal: 16 },

  fab: { position: 'absolute', bottom: 24, right: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },

  // Sheet
  imgActions: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  imgBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 10 },
  imgBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  scanText: { color: theme.colors.primary, fontWeight: '600', fontSize: 13 },
  preview: { width: '100%', height: 160, borderRadius: 10, marginBottom: 8, backgroundColor: theme.colors.surface },
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: theme.colors.background, color: theme.colors.text },
  row2: { flexDirection: 'row', gap: 10 },
  catRow: { gap: 8, paddingVertical: 4 },
  catChip: { backgroundColor: theme.colors.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border },
  catChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  catChipText: { fontSize: 13, color: theme.colors.text },
  saveBtn: { marginTop: 16, height: 50, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
