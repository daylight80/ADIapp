import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ArrowLeft, Check, Crown, Sparkles, Users, User as UserIcon, Car, Building2 } from 'lucide-react-native';
import { theme } from '../src/theme';
import { api } from '../src/api';
import { useAuth } from '../src/AuthContext';
import { TIERS, Tier, TierSpec, loadSchoolUsage, SchoolUsage, tierById } from '../src/tiers';
import { Card } from '../src/ui';

export default function PricingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { refreshUser } = useAuth();

  const [busyTier, setBusyTier] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [usage, setUsage] = useState<SchoolUsage | null>(null);
  const [refreshing, setRefreshing] = useState(true);

  const reload = async () => {
    setRefreshing(true);
    try {
      setUsage(await loadSchoolUsage());
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => { reload(); }, []);

  // Returning from Stripe Checkout
  useEffect(() => {
    const status = params.status as string | undefined;
    const sessionId = params.session_id as string | undefined;
    if (status === 'success' && sessionId) {
      (async () => {
        try {
          await api.post('/billing/verify-session', { session_id: sessionId });
          setSuccess('Subscription active. Welcome to your new tier!');
          await refreshUser();
          await reload();
        } catch (e: any) {
          setError(e?.response?.data?.detail || 'Could not verify subscription');
        }
      })();
    } else if (status === 'cancelled') {
      setError('Checkout was cancelled. You can try again anytime.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.status, params.session_id]);

  const currentTier: Tier = (usage?.tier as Tier) || 'starter';

  const startCheckout = async (tier: Tier) => {
    if (tier === 'starter') {
      // Downgrading to free — open portal so user can cancel cleanly
      return openPortal();
    }
    setError(null);
    setSuccess(null);
    setBusyTier(tier);
    try {
      const res = await api.post('/billing/create-checkout-session', { tier });
      const url = res.data?.url as string;
      if (!url) throw new Error('No checkout URL returned');
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') window.location.href = url;
      } else {
        await WebBrowser.openAuthSessionAsync(url, undefined);
        await refreshUser();
        await reload();
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to start checkout');
    } finally {
      setBusyTier(null);
    }
  };

  const openPortal = async () => {
    setBusyTier(currentTier);
    setError(null);
    try {
      const res = await api.post('/billing/create-portal-session');
      const url = res.data?.url as string;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = url;
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to open billing portal');
    } finally {
      setBusyTier(null);
    }
  };

  const showDevReset = () => {
    Alert.alert('Reset tier (dev)?', 'Revert this school to the free Starter tier locally.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset to Starter',
        style: 'destructive',
        onPress: async () => {
          try { await api.post('/billing/cancel-mock'); await refreshUser(); await reload(); }
          catch {}
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Pricing</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <Sparkles size={28} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Pick the right tier for your school</Text>
          <Text style={styles.heroSub}>UK GBP · Cancel anytime · UK VAT included.</Text>
        </View>

        {usage && (
          <Card style={styles.usageCard} testID="usage-card">
            <Text style={styles.usageHeading}>Current usage</Text>
            <View style={styles.usageRow}>
              <UsageStat label="Active students" value={`${usage.active_students}${usage.student_limit ? ` / ${usage.student_limit}` : ' / Unlimited'}`} />
              <UsageStat label="Instructors" value={`${usage.instructor_count}${usage.instructor_limit ? ` / ${usage.instructor_limit}` : ' / Unlimited'}`} />
            </View>
            <Text style={styles.usageTier}>Tier · <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{tierById(currentTier).name}</Text></Text>
          </Card>
        )}

        {refreshing && !usage && <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 12 }} />}

        {TIERS.map((t) => (
          <TierCard
            key={t.id}
            spec={t}
            isCurrent={t.id === currentTier}
            busy={busyTier === t.id}
            onSubscribe={() => startCheckout(t.id)}
            onManage={openPortal}
          />
        ))}

        {error && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
        )}
        {success && (
          <View style={styles.successBox}><Text style={styles.successText}>{success}</Text></View>
        )}

        <Text style={styles.legal}>
          Powered by Stripe. Subscriptions renew monthly until cancelled. Franchise tier bills £10 per
          additional instructor — quantities update automatically when you add or remove team members.
        </Text>

        {currentTier !== 'starter' && (
          <TouchableOpacity style={styles.devReset} onPress={showDevReset} testID="btn-dev-reset">
            <Text style={styles.devResetText}>Reset to Starter (dev)</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.usageStat}>
      <Text style={styles.usageStatValue}>{value}</Text>
      <Text style={styles.usageStatLabel}>{label}</Text>
    </View>
  );
}

function TierCard({
  spec,
  isCurrent,
  busy,
  onSubscribe,
  onManage,
}: {
  spec: TierSpec;
  isCurrent: boolean;
  busy: boolean;
  onSubscribe: () => void;
  onManage: () => void;
}) {
  const Icon =
    spec.id === 'starter' ? UserIcon :
    spec.id === 'growth'  ? Users :
    spec.id === 'pro'     ? Crown :
    Building2;

  const accent =
    spec.id === 'pro'       ? theme.colors.accent :
    spec.id === 'franchise' ? theme.colors.primary :
    theme.colors.primary;

  const priceMain = spec.price_gbp === 0 ? '£0' : `£${spec.price_gbp.toFixed(2)}`;

  return (
    <Card style={[styles.planCard, isCurrent && { borderColor: accent, borderWidth: 2 }] as any} testID={`plan-${spec.id}`}>
      {spec.recommended && (
        <View style={styles.ribbon}>
          <Crown size={14} color="#fff" />
          <Text style={styles.ribbonText}>Most popular</Text>
        </View>
      )}
      <View style={styles.planHeader}>
        <View style={styles.planTitleRow}>
          <View style={[styles.planBadge, { backgroundColor: accent }]}>
            <Icon size={16} color="#fff" />
          </View>
          <Text style={[styles.planName, { color: accent }]}>{spec.name}</Text>
        </View>
        {isCurrent && (
          <View style={[styles.activeChip, { backgroundColor: theme.colors.success }]}>
            <Text style={styles.activeChipText}>Current</Text>
          </View>
        )}
      </View>

      <Text style={styles.planBlurb}>{spec.blurb}</Text>

      <View style={styles.priceRow}>
        <Text style={styles.planPrice}>{priceMain}</Text>
        {spec.price_gbp > 0 && <Text style={styles.planUnit}>/month</Text>}
      </View>
      {spec.per_seat_gbp ? (
        <Text style={styles.seatNote}>+ £{spec.per_seat_gbp.toFixed(2)} per additional instructor</Text>
      ) : null}

      {/* Limits row */}
      <View style={styles.limitsRow}>
        <Limit
          icon={<UserIcon size={14} color={theme.colors.textMuted} />}
          text={spec.student_limit ? `${spec.student_limit} students` : 'Unlimited students'}
        />
        <Limit
          icon={<Car size={14} color={theme.colors.textMuted} />}
          text={spec.instructor_limit ? `${spec.instructor_limit} instructor` : 'Unlimited instructors'}
        />
      </View>

      <View style={styles.bullets}>
        {spec.features.map((f) => <Bullet key={f} text={f} />)}
      </View>

      {/* CTA */}
      {isCurrent ? (
        spec.id === 'starter' ? (
          <View style={styles.currentNote}>
            <Text style={styles.currentNoteText}>This is your active free tier.</Text>
          </View>
        ) : (
          <TouchableOpacity style={[styles.cta, { backgroundColor: accent }]} onPress={onManage} disabled={busy} testID={`btn-manage-${spec.id}`}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Manage subscription</Text>}
          </TouchableOpacity>
        )
      ) : (
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: accent }, busy && styles.ctaDisabled]}
          onPress={onSubscribe}
          disabled={busy}
          testID={`btn-subscribe-${spec.id}`}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {spec.id === 'starter' ? 'Downgrade to Starter' : `Upgrade — £${spec.price_gbp.toFixed(2)}/mo`}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </Card>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.bulletCheck}><Check size={12} color="#fff" /></View>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function Limit({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.limitPill}>
      {icon}
      <Text style={styles.limitText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  scroll: { padding: 16, gap: 16, paddingBottom: 32 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 22, fontWeight: '800', color: theme.colors.text, textAlign: 'center' },
  heroSub: { color: theme.colors.textMuted, fontSize: 13, textAlign: 'center' },

  usageCard: { gap: 8 },
  usageHeading: { fontSize: 13, color: theme.colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  usageRow: { flexDirection: 'row', gap: 12 },
  usageStat: { flex: 1, backgroundColor: theme.colors.primaryLight, padding: 10, borderRadius: 10, alignItems: 'center' },
  usageStatValue: { fontWeight: '700', fontSize: 16, color: theme.colors.primary },
  usageStatLabel: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
  usageTier: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center', marginTop: 4 },

  planCard: { gap: 6, position: 'relative', paddingTop: 16 },
  planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planBadge: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  planName: { fontSize: 20, fontWeight: '800' },
  planBlurb: { color: theme.colors.textMuted, fontSize: 13 },
  ribbon: {
    position: 'absolute',
    top: -1,
    right: 16,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ribbonText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  activeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  activeChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 },
  planPrice: { fontSize: 28, fontWeight: '800', color: theme.colors.text },
  planUnit: { fontSize: 14, color: theme.colors.textMuted, fontWeight: '500' },
  seatNote: { fontSize: 12, color: theme.colors.accent, fontWeight: '600' },
  limitsRow: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  limitPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  limitText: { fontSize: 11, color: theme.colors.textMuted, fontWeight: '600' },
  bullets: { gap: 8, marginTop: 10 },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletCheck: { width: 18, height: 18, borderRadius: 9, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' },
  bulletText: { fontSize: 13, color: theme.colors.text, flex: 1 },
  cta: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  currentNote: { padding: 12, alignItems: 'center', marginTop: 8, backgroundColor: theme.colors.background, borderRadius: 10 },
  currentNoteText: { color: theme.colors.textMuted, fontSize: 12 },
  errorBox: { backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10 },
  errorText: { color: theme.colors.danger, fontSize: 14 },
  successBox: { backgroundColor: '#D1FAE5', padding: 12, borderRadius: 10 },
  successText: { color: theme.colors.success, fontSize: 14, fontWeight: '600' },
  legal: { fontSize: 11, color: theme.colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  devReset: { padding: 12, alignItems: 'center' },
  devResetText: { color: theme.colors.textMuted, fontSize: 12 },
});
