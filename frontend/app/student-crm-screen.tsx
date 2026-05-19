import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
  RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, Plus, ArrowLeft, Mail, Phone, MapPin, CalendarDays, Check, Crown, Send, Copy } from 'lucide-react-native';
import { theme } from '../src/theme';
import { mockDb, StudentStatus } from '../src/mockDb';
import { Card, ProgressBar, StatusBadge } from '../src/ui';
import { BottomSheet } from '../src/BottomSheet';
import { BottomNav } from '../src/BottomNav';
import { useAuth } from '../src/AuthContext';
import { canAddStudent, isPro, FREE_STUDENT_LIMIT } from '../src/proPlan';
import { PaywallModal } from '../src/PaywallModal';
import { fireInstantNotification } from '../src/notifications';
import { openSmsComposer, copyToClipboard } from '../src/tools';
import { api } from '../src/api';

type FilterChip = 'All' | StudentStatus;

const FILTERS: FilterChip[] = ['All', 'Active', 'Test Ready', 'New', 'Passed'];

export default function StudentCrmScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const pro = isPro(user?.subscription_status);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterChip>('All');
  const [addOpen, setAddOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [busyInvite, setBusyInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteRecipient, setInviteRecipient] = useState<{ name: string; phone: string } | null>(null);

  // Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const students = useMemo(() => mockDb.listStudents(), [reloadKey]);

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const q = search.toLowerCase();
      const matchQ = !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
      const matchF = filter === 'All' || s.status === filter;
      return matchQ && matchF;
    });
  }, [students, search, filter]);

  const counts = useMemo(() => {
    return {
      Active: students.filter((s) => s.status === 'Active').length,
      'Test Ready': students.filter((s) => s.status === 'Test Ready').length,
      New: students.filter((s) => s.status === 'New').length,
    };
  }, [students]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      setReloadKey((k) => k + 1);
      setRefreshing(false);
    }, 600);
  }, []);

  const showSnack = (msg: string) => {
    setSnack(msg);
    setTimeout(() => setSnack(null), 2500);
  };

  const submit = async () => {
    setFormError(null);
    if (!name.trim() || name.trim().length < 2) {
      setFormError('Please enter the full name');
      return;
    }
    if (!email.includes('@')) {
      setFormError('Please enter a valid email');
      return;
    }
    if (!phone.trim()) {
      setFormError('Please enter a phone number');
      return;
    }
    // Enforce limit (defensive — FAB also gates)
    if (!canAddStudent(user?.subscription_status, students.length)) {
      setAddOpen(false);
      setPaywallOpen(true);
      return;
    }

    setBusyInvite(true);
    try {
      const res = await api.post('/instructor/invite-student', {
        email: email.trim().toLowerCase(),
        name: name.trim(),
        phone: phone.trim(),
      });
      const inviteUrl = res.data.invite_url as string;
      const studentName = name.trim();
      const studentPhone = phone.trim();

      // Also add to local mockDb so the CRM list reflects the invitee immediately
      mockDb.addStudent({
        name: studentName,
        email: email.trim().toLowerCase(),
        phone: studentPhone,
        address: address.trim(),
        postcode: postcode.trim().toUpperCase(),
      });

      // Clear form
      setName('');
      setEmail('');
      setPhone('');
      setAddress('');
      setPostcode('');
      setReloadKey((k) => k + 1);
      setAddOpen(false);

      // Show invite-link sheet
      setInviteLink(inviteUrl);
      setInviteRecipient({ name: studentName, phone: studentPhone });

      if (pro) fireInstantNotification('Student invited', `${studentName} now has an invite link.`).catch(() => {});
    } catch (e: any) {
      setFormError(e?.response?.data?.detail || 'Failed to create invite');
    } finally {
      setBusyInvite(false);
    }
  };

  const handleFabPress = () => {
    if (!canAddStudent(user?.subscription_status, students.length)) {
      setPaywallOpen(true);
      return;
    }
    setAddOpen(true);
  };

  const copyInviteLink = () => {
    if (!inviteLink) return;
    const ok = copyToClipboard(inviteLink);
    showSnack(ok ? 'Invite link copied to clipboard' : 'Could not copy automatically — long-press to copy.');
  };

  const smsInviteLink = async () => {
    if (!inviteLink || !inviteRecipient) return;
    const body = `Hi ${inviteRecipient.name.split(' ')[0]}, your driving instructor has invited you to ADI Pro. Tap to sign up: ${inviteLink}`;
    await openSmsComposer(inviteRecipient.phone, body);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Students</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <Search size={18} color={theme.colors.textMuted} />
          <TextInput
            placeholder="Search by name or email"
            placeholderTextColor={theme.colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            testID="input-search"
          />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {FILTERS.map((f) => {
          const count = f === 'All' ? students.length : counts[f as Exclude<FilterChip, 'All'>];
          const active = filter === f;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(f)}
              testID={`filter-${f.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f} <Text style={[styles.chipCount, active && styles.chipCountActive]}>{count}</Text>
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!pro && (
        <TouchableOpacity
          style={styles.tierBanner}
          onPress={() => router.push('/pricing-screen')}
          testID="tier-usage-banner"
          activeOpacity={0.9}
        >
          <Crown size={16} color={theme.colors.accent} />
          <Text style={styles.tierText}>
            {students.length}/{FREE_STUDENT_LIMIT} students used (Free) ·{' '}
            <Text style={{ fontWeight: '700', color: theme.colors.primary }}>Upgrade</Text>
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item: s }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/student-lifecycle-screen', params: { id: s.id } })}
            activeOpacity={0.8}
            testID={`student-card-${s.id}`}
          >
            <Card style={styles.studentCard}>
              <View style={styles.studentTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{s.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{s.name}</Text>
                  <Text style={styles.studentEmail}>{s.email}</Text>
                </View>
                <StatusBadge status={s.status} testID={`status-${s.id}`} />
              </View>

              <View style={styles.progressRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.progressLabel}>
                    <Text style={styles.progressText}>Progress</Text>
                    <Text style={styles.progressText}>{s.progress}%</Text>
                  </View>
                  <ProgressBar progress={s.progress} />
                </View>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaText}>{s.lessons_count} lessons</Text>
                {s.next_lesson && (
                  <Text style={styles.metaText}>
                    Next: {new Date(s.next_lesson).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                )}
                {s.test_date && (
                  <Text style={[styles.metaText, { color: theme.colors.accent, fontWeight: '600' }]}>
                    Test: {new Date(s.test_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                )}
              </View>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No students match your filters.</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, !canAddStudent(user?.subscription_status, students.length) && styles.fabLocked]}
        onPress={handleFabPress}
        testID="fab-add-student"
      >
        {!canAddStudent(user?.subscription_status, students.length) ? (
          <Crown size={24} color="#fff" />
        ) : (
          <Plus size={26} color="#fff" />
        )}
      </TouchableOpacity>

      <BottomNav role="instructor" />

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason={`Free tier is limited to ${FREE_STUDENT_LIMIT} students. You currently have ${students.length}.`}
      />

      {/* Snackbar */}
      {snack && (
        <View style={styles.snackbar} testID="snackbar-success">
          <Check size={18} color="#fff" />
          <Text style={styles.snackText}>{snack}</Text>
        </View>
      )}

      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Invite New Student" testID="sheet-add-student">
        <Text style={styles.hint}>We'll generate a private invite link you can copy or send by SMS.</Text>

        <Text style={styles.label}>Full name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Charlotte Smith" placeholderTextColor={theme.colors.textMuted} testID="input-student-name" />

        <Text style={styles.label}>Email address</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="name@example.co.uk"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-student-email"
        />

        <Text style={styles.label}>Phone</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="07700 900000"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-student-phone"
        />

        <Text style={styles.label}>Address (optional)</Text>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholder="12 High Street"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-student-address"
        />

        <Text style={styles.label}>Postcode (optional)</Text>
        <TextInput
          style={styles.input}
          value={postcode}
          onChangeText={setPostcode}
          autoCapitalize="characters"
          placeholder="SW1A 1AA"
          placeholderTextColor={theme.colors.textMuted}
          testID="input-student-postcode"
        />

        {formError && <Text style={styles.error}>{formError}</Text>}

        <TouchableOpacity
          style={[styles.submitBtn, busyInvite && styles.submitBtnDisabled]}
          onPress={submit}
          disabled={busyInvite}
          testID="btn-submit-student"
        >
          <Send size={16} color="#fff" />
          <Text style={styles.submitBtnText}>{busyInvite ? 'Creating invite...' : 'Generate invite link'}</Text>
        </TouchableOpacity>
      </BottomSheet>

      {/* Invite link reveal sheet */}
      <BottomSheet
        visible={!!inviteLink}
        onClose={() => {
          setInviteLink(null);
          setInviteRecipient(null);
        }}
        title="Invite link ready"
        testID="sheet-invite-link"
      >
        {inviteLink && inviteRecipient && (
          <View style={{ gap: 14 }}>
            <Text style={styles.hint}>
              Send this link to {inviteRecipient.name}. It expires in 7 days. They'll set their own password and join your roster.
            </Text>
            <View style={styles.linkBox} testID="invite-link-value">
              <Text style={styles.linkText} numberOfLines={2}>{inviteLink}</Text>
            </View>
            <View style={styles.linkRow}>
              <TouchableOpacity style={[styles.linkBtn, { backgroundColor: theme.colors.primary }]} onPress={copyInviteLink} testID="btn-copy-invite">
                <Copy size={16} color="#fff" />
                <Text style={styles.linkBtnText}>Copy link</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.linkBtn, { backgroundColor: theme.colors.accent }]} onPress={smsInviteLink} testID="btn-sms-invite">
                <Send size={16} color="#fff" />
                <Text style={styles.linkBtnText}>Send via SMS</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  searchRow: { paddingHorizontal: 16, paddingBottom: 8 },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    height: 48,
  },
  searchInput: { flex: 1, fontSize: 15 },
  chipsRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: 6,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  chipTextActive: { color: '#fff' },
  chipCount: { color: theme.colors.textMuted },
  chipCountActive: { color: '#ffffffaa' },
  list: { padding: 16, gap: 12, paddingBottom: 120 },
  studentCard: { gap: 12, marginBottom: 12 },
  studentTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '700', color: theme.colors.primary, fontSize: 16 },
  studentName: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  studentEmail: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressText: { fontSize: 13, color: theme.colors.textMuted, fontWeight: '500' },
  metaRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  metaText: { fontSize: 13, color: theme.colors.textMuted },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: theme.colors.textMuted },
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabLocked: { backgroundColor: theme.colors.textMuted },
  tierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF7ED',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  tierText: { color: theme.colors.text, fontSize: 13, flex: 1 },
  label: { ...theme.font.caption, fontWeight: '600', marginBottom: 6, color: theme.colors.text },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 12,
    backgroundColor: theme.colors.background,
    fontSize: 15,
  },
  error: { color: theme.colors.danger, marginBottom: 8 },
  submitBtn: { backgroundColor: theme.colors.primary, height: 52, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', marginTop: 8, flexDirection: 'row', gap: 8 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { color: theme.colors.textMuted, marginBottom: 12, fontSize: 13 },
  linkBox: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, backgroundColor: theme.colors.background },
  linkText: { color: theme.colors.primary, fontWeight: '600', fontSize: 13 },
  linkRow: { flexDirection: 'row', gap: 10 },
  linkBtn: { flex: 1, height: 48, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  linkBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  snackbar: {
    position: 'absolute',
    bottom: 110,
    left: 16,
    right: 16,
    backgroundColor: theme.colors.success,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  snackText: { color: '#fff', fontWeight: '600' },
});
