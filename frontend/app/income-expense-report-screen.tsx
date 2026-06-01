import React, { useMemo, useState } from 'react';
import {
  SafeAreaView, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Download, PoundSterling, TrendingUp, TrendingDown, FileSpreadsheet } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { BottomNav } from '../src/BottomNav';
import { DateField } from '../src/DateTimeFields';
import { supabase } from '../src/supabaseClient';
import { listReceipts, type ExpenseReceipt } from '../src/supabaseDb';
import { rowsToCsv, csvAmount, isoYmd, downloadOrShareCsv, type CsvRow } from '../src/csvExport';

// ---- Date helpers ---------------------------------------------------------
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

type IncomeRow = {
  date: string;       // YYYY-MM-DD
  student: string;
  topic: string;
  status: 'Completed' | 'Cancelled';
  amount: number;
  note: string;
};

/**
 * Date-range Income / Expense report.
 *
 *  - Income:    Completed lessons (amount_paid) + Cancelled lessons with
 *               a recorded cancellation_charge > 0 (Migration 011).
 *  - Expenses:  expense_receipts rows in range (Migration 008).
 *
 * Generates a single combined CSV that's easy to open in Excel / Google
 * Sheets and hand to an accountant.
 */
export default function IncomeExpenseReportScreen() {
  const router = useRouter();
  const today = new Date();
  const [from, setFrom] = useState<string>(isoYmd(startOfMonth(today)));
  const [to, setTo] = useState<string>(isoYmd(endOfMonth(today)));
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [income, setIncome] = useState<IncomeRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseReceipt[]>([]);

  const totals = useMemo(() => {
    const inc = income.reduce((s, r) => s + r.amount, 0);
    const exp = expenses.reduce((s, e) => s + Number(e.amount_total || 0), 0);
    return { income: inc, expenses: exp, net: inc - exp };
  }, [income, expenses]);

  const fetchData = async () => {
    if (!from || !to) { setError('Pick both From and To dates.'); return; }
    if (from > to) { setError('From date must be on or before To date.'); return; }
    setBusy(true);
    setError(null);
    try {
      // Resolve instructor scope (RLS still applies on top of this).
      const { data: ses } = await supabase.auth.getSession();
      const uid = ses.session?.user?.id;
      if (!uid) throw new Error('Not signed in');
      const { data: instr, error: ierr } = await supabase
        .from('instructors')
        .select('id, school_id')
        .eq('auth_user_id', uid)
        .maybeSingle();
      if (ierr || !instr) throw new Error('No instructor profile linked');

      // 1) Income — lessons.
      const fromIso = `${from}T00:00:00`;
      const toIso = `${to}T23:59:59`;
      const { data: lessons, error: lerr } = await supabase
        .from('lessons')
        .select('id, start_time, topic, status, amount_paid, cancellation_charge, cancellation_note, students(full_name)')
        .eq('instructor_id', instr.id)
        .gte('start_time', fromIso)
        .lte('start_time', toIso)
        .in('status', ['Completed', 'Cancelled'])
        .order('start_time', { ascending: true });
      if (lerr) throw lerr;

      const incomeRows: IncomeRow[] = [];
      for (const L of (lessons || []) as any[]) {
        const d = (L.start_time || '').slice(0, 10);
        const stu = (L.students && L.students.full_name) || 'Student';
        const topic = L.topic || 'Driving lesson';
        if (L.status === 'Completed') {
          const amt = Number(L.amount_paid || 0);
          if (amt > 0) {
            incomeRows.push({ date: d, student: stu, topic, status: 'Completed', amount: amt, note: '' });
          }
        } else if (L.status === 'Cancelled') {
          const charge = Number(L.cancellation_charge || 0);
          if (charge > 0) {
            incomeRows.push({
              date: d,
              student: stu,
              topic,
              status: 'Cancelled',
              amount: charge,
              note: L.cancellation_note || 'Cancellation charge',
            });
          }
        }
      }
      setIncome(incomeRows);

      // 2) Expenses — expense_receipts.
      let allReceipts: ExpenseReceipt[] = [];
      let receiptsWarning: string | null = null;
      try {
        allReceipts = await listReceipts();
      } catch (e: any) {
        // Continue with income only — surface a non-blocking warning.
        const m = String(e?.message || '');
        if (/Migration 008|schema cache|expense_receipts/i.test(m)) {
          receiptsWarning = 'Expense Receipts (Migration 008) not applied — Income figures only.';
        } else {
          receiptsWarning = `Could not load expenses — Income figures only. (${m})`;
        }
      }
      const fromYmd = from;
      const toYmd = to;
      const filteredExp = allReceipts.filter((r) => {
        const d = (r.occurred_at || '').slice(0, 10);
        return d >= fromYmd && d <= toYmd;
      });
      setExpenses(filteredExp);
      if (receiptsWarning) setError(receiptsWarning);

      setPreviewing(true);
    } catch (e: any) {
      setError(e?.message || 'Could not load report data.');
      setIncome([]);
      setExpenses([]);
      setPreviewing(false);
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = async () => {
    setError(null);
    try {
      const rows: CsvRow[] = [];
      // Header / context block
      rows.push(['ADI Pro — Income & Expense Report']);
      rows.push(['From', from, 'To', to]);
      rows.push([]);
      // INCOME
      rows.push(['INCOME']);
      rows.push(['Date', 'Student', 'Lesson topic', 'Status', 'Amount (£)', 'Note']);
      for (const r of income) {
        rows.push([r.date, r.student, r.topic, r.status, csvAmount(r.amount), r.note]);
      }
      rows.push(['', '', '', 'Total income (£)', csvAmount(totals.income), '']);
      rows.push([]);
      // EXPENSES
      rows.push(['EXPENSES']);
      rows.push(['Date', 'Vendor', 'Category', 'Amount (£)', 'VAT (£)', 'Notes']);
      for (const e of expenses) {
        rows.push([
          e.occurred_at,
          e.vendor || '',
          e.category,
          csvAmount(e.amount_total),
          csvAmount(e.vat_amount ?? 0),
          e.notes || '',
        ]);
      }
      rows.push(['', '', 'Total expenses (£)', csvAmount(totals.expenses), '', '']);
      rows.push([]);
      // SUMMARY
      rows.push(['SUMMARY']);
      rows.push(['Total income (£)', csvAmount(totals.income)]);
      rows.push(['Total expenses (£)', csvAmount(totals.expenses)]);
      rows.push(['Net (£)', csvAmount(totals.net)]);

      const csv = rowsToCsv(rows);
      const fname = `adi-pro-income-expense_${from}_to_${to}.csv`;
      await downloadOrShareCsv(fname, csv);
    } catch (e: any) {
      setError(e?.message || 'Could not export CSV.');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="btn-back" style={styles.iconBtn}>
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Income & expenses</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}>
        <Card style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <FileSpreadsheet size={16} color={theme.colors.primary} />
            <Text style={styles.intro}>Generate a CSV for any date range.</Text>
          </View>
          <Text style={styles.subIntro}>
            Income = Completed lessons (amount paid) + Cancelled lessons with a retained charge.
            Expenses come from receipts captured via the Receipt Scanner.
          </Text>
        </Card>

        <Card style={{ gap: 12 }}>
          <Text style={styles.sectionLabel}>Date range</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.subLabel}>From</Text>
              <DateField value={from} onChange={setFrom} testID="input-from" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.subLabel}>To</Text>
              <DateField value={to} onChange={setTo} testID="input-to" />
            </View>
          </View>
          {/* Quick-pick chips */}
          <View style={styles.chipRow}>
            <PresetChip label="This month" onPress={() => {
              setFrom(isoYmd(startOfMonth(today)));
              setTo(isoYmd(endOfMonth(today)));
            }} />
            <PresetChip label="Last month" onPress={() => {
              const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
              setFrom(isoYmd(startOfMonth(prev)));
              setTo(isoYmd(endOfMonth(prev)));
            }} />
            <PresetChip label="This year" onPress={() => {
              setFrom(`${today.getFullYear()}-01-01`);
              setTo(`${today.getFullYear()}-12-31`);
            }} />
            <PresetChip label="Tax year" onPress={() => {
              // UK personal tax year: 6 April → 5 April
              const y = today.getMonth() < 3 || (today.getMonth() === 3 && today.getDate() < 6)
                ? today.getFullYear() - 1
                : today.getFullYear();
              setFrom(`${y}-04-06`);
              setTo(`${y + 1}-04-05`);
            }} />
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={fetchData}
            disabled={busy}
            testID="btn-generate"
          >
            {busy ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.primaryBtnText}>Generate report</Text>
            )}
          </TouchableOpacity>

          {error ? <Text style={styles.errText}>{error}</Text> : null}
        </Card>

        {previewing && (
          <>
            {/* Totals summary */}
            <Card style={{ gap: 10 }}>
              <Text style={styles.sectionLabel}>Summary</Text>
              <TotalRow icon={<TrendingUp size={16} color={theme.colors.success} />} label="Income" value={totals.income} positive />
              <TotalRow icon={<TrendingDown size={16} color={theme.colors.danger} />} label="Expenses" value={totals.expenses} />
              <View style={styles.netDivider} />
              <TotalRow icon={<PoundSterling size={16} color={theme.colors.primary} />} label="Net" value={totals.net} highlight positive={totals.net >= 0} />
            </Card>

            {/* Preview list — first 8 rows of each */}
            <Card style={{ gap: 6 }}>
              <Text style={styles.sectionLabel}>Income — {income.length} {income.length === 1 ? 'entry' : 'entries'}</Text>
              {income.length === 0 ? (
                <Text style={styles.empty}>No income in this range.</Text>
              ) : (
                income.slice(0, 8).map((r, i) => (
                  <View key={`inc-${i}`} style={styles.previewRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewName} numberOfLines={1}>{r.student}</Text>
                      <Text style={styles.previewMeta} numberOfLines={1}>
                        {r.date} · {r.topic}{r.status === 'Cancelled' ? ' · Cancellation' : ''}
                      </Text>
                    </View>
                    <Text style={styles.previewAmount}>£{r.amount.toFixed(2)}</Text>
                  </View>
                ))
              )}
              {income.length > 8 && (
                <Text style={styles.moreLine}>… and {income.length - 8} more in the CSV</Text>
              )}
            </Card>

            <Card style={{ gap: 6 }}>
              <Text style={styles.sectionLabel}>Expenses — {expenses.length} {expenses.length === 1 ? 'entry' : 'entries'}</Text>
              {expenses.length === 0 ? (
                <Text style={styles.empty}>No expense receipts in this range.</Text>
              ) : (
                expenses.slice(0, 8).map((e) => (
                  <View key={e.id} style={styles.previewRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewName} numberOfLines={1}>{e.vendor || 'Receipt'}</Text>
                      <Text style={styles.previewMeta} numberOfLines={1}>
                        {e.occurred_at} · {e.category}
                      </Text>
                    </View>
                    <Text style={styles.previewAmount}>£{Number(e.amount_total).toFixed(2)}</Text>
                  </View>
                ))
              )}
              {expenses.length > 8 && (
                <Text style={styles.moreLine}>… and {expenses.length - 8} more in the CSV</Text>
              )}
            </Card>

            <TouchableOpacity style={styles.downloadBtn} onPress={downloadCsv} testID="btn-download">
              <Download size={18} color="#fff" />
              <Text style={styles.downloadText}>Download CSV</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <BottomNav />
    </SafeAreaView>
  );
}

function PresetChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress} testID={`chip-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      <Text style={styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );
}

function TotalRow({
  label, value, icon, highlight, positive,
}: { label: string; value: number; icon: React.ReactNode; highlight?: boolean; positive?: boolean }) {
  return (
    <View style={[styles.totalRow, highlight && styles.totalRowHighlight]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon}
        <Text style={[styles.totalLabel, highlight && styles.totalLabelHighlight]}>{label}</Text>
      </View>
      <Text style={[
        styles.totalValue,
        highlight && styles.totalValueHighlight,
        positive === false && { color: theme.colors.danger },
      ]}>
        £{value.toFixed(2)}
      </Text>
    </View>
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
  subIntro: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 2 },
  sectionLabel: { fontSize: 12, fontWeight: '800', color: theme.colors.textMuted, letterSpacing: 0.5 },
  subLabel: { fontSize: 11, fontWeight: '700', color: theme.colors.textMuted, marginBottom: 4, letterSpacing: 0.4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background,
  },
  chipText: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
  primaryBtn: {
    height: 48, borderRadius: 12, backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
  errText: { color: theme.colors.danger, fontSize: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalRowHighlight: { paddingTop: 6 },
  totalLabel: { fontSize: 13, color: theme.colors.text, fontWeight: '600' },
  totalLabelHighlight: { fontSize: 14, fontWeight: '800' },
  totalValue: { fontSize: 14, color: theme.colors.text, fontWeight: '700' },
  totalValueHighlight: { fontSize: 18, fontWeight: '800', color: theme.colors.primary },
  netDivider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 2 },
  previewRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6, gap: 12,
  },
  previewName: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
  previewMeta: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  previewAmount: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  moreLine: { fontSize: 11, color: theme.colors.textMuted, fontStyle: 'italic', marginTop: 4 },
  empty: { color: theme.colors.textMuted, fontSize: 12, paddingVertical: 4 },
  downloadBtn: {
    height: 52, borderRadius: 12, backgroundColor: theme.colors.success,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    marginTop: 4,
  },
  downloadText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
