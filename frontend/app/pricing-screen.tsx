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
import { ArrowLeft, Check, Crown, Sparkles } from 'lucide-react-native';
import { theme } from '../src/theme';
import { api } from '../src/api';
import { useAuth } from '../src/AuthContext';
import { isPro, PRO_FEATURES, PRO_PRICE_GBP } from '../src/proPlan';
import { Card } from '../src/ui';

export default function PricingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { user, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Handle return from Stripe Checkout (success_url contains ?status=success&session_id=...)
  useEffect(() => {
    const status = params.status as string | undefined;
    const sessionId = params.session_id as string | undefined;
    if (status === 'success' && sessionId) {
      (async () => {
        try {
          const res = await api.post('/billing/verify-session', { session_id: sessionId });
          if (res.data?.verified || res.data?.subscription_status === 'pro') {
            setSuccess('Welcome to Pro! Your subscription is active.');
          }
          await refreshUser();
        } catch (e: any) {
          setError(e?.response?.data?.detail || 'Could not verify subscription');
        }
      })();
    } else if (status === 'cancelled') {
      setError('Checkout was cancelled. You can try again anytime.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.status, params.session_id]);

  const subscribed = isPro(user?.subscription_status);

  const startCheckout = async () => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await api.post('/billing/create-checkout-session', {});
      const url = res.data?.url as string;
      if (!url) throw new Error('No checkout URL returned');
      if (Platform.OS === 'web') {
        // Open in same tab so return URL re-enters the app
        if (typeof window !== 'undefined') window.location.href = url;
      } else {
        const result = await WebBrowser.openAuthSessionAsync(url, undefined);
        // After the user returns, refresh subscription status
        await refreshUser();
        if (result.type === 'success') {
          setSuccess('Checkout complete. Verifying subscription...');
        }
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to start checkout');
    } finally {
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
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
      setBusy(false);
    }
  };

  const devCancel = async () => {
    Alert.alert('Cancel subscription (dev)?', 'This will revert you to the Free tier locally.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revert to Free',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.post('/billing/cancel-mock');
            await refreshUser();
            setSuccess('Reverted to Free tier.');
          } catch {}
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
          <View style={styles.crownWrap}>
            <Sparkles size={28} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Choose your plan</Text>
          <Text style={styles.heroSub}>Cancel anytime. UK VAT included.</Text>
        </View>

        {/* Free tier card */}
        <Card style={[styles.planCard, !subscribed && styles.planCardActive]} testID="plan-free">
          <View style={styles.planHeader}>
            <Text style={styles.planName}>Free</Text>
            {!subscribed && <View style={styles.activeChip}><Text style={styles.activeChipText}>Current plan</Text></View>}
          </View>
          <Text style={styles.planPrice}>£0<Text style={styles.planUnit}>/month</Text></Text>
          <View style={styles.bullets}>
            <Bullet text="Up to 5 students" />
            <Bullet text="Lesson diary & DVSA competency tracking" />
            <Bullet text="DL25 mock test & report" />
            <Bullet text="KPI dashboard" />
          </View>
        </Card>

        {/* Pro card */}
        <Card style={[styles.planCard, styles.proCard, subscribed && styles.planCardActive]} testID="plan-pro">
          <View style={styles.proRibbon}>
            <Crown size={14} color="#fff" />
            <Text style={styles.proRibbonText}>Most popular</Text>
          </View>
          <View style={styles.planHeader}>
            <Text style={[styles.planName, { color: theme.colors.accent }]}>Pro</Text>
            {subscribed && <View style={[styles.activeChip, { backgroundColor: theme.colors.success }]}><Text style={styles.activeChipText}>Active</Text></View>}
          </View>
          <Text style={styles.planPrice}>
            £{PRO_PRICE_GBP}<Text style={styles.planUnit}>/month</Text>
          </Text>
          <View style={styles.bullets}>
            {PRO_FEATURES.map((f) => <Bullet key={f} text={f} />)}
          </View>

          {!subscribed ? (
            <TouchableOpacity
              style={[styles.cta, busy && styles.ctaDisabled]}
              onPress={startCheckout}
              disabled={busy}
              testID="btn-subscribe"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Subscribe — £{PRO_PRICE_GBP}/mo</Text>}
            </TouchableOpacity>
          ) : (
            <View style={{ gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={styles.cta} onPress={openPortal} disabled={busy} testID="btn-manage">
                <Text style={styles.ctaText}>Manage billing</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.devCancel} onPress={devCancel} testID="btn-dev-cancel">
                <Text style={styles.devCancelText}>Revert to Free (dev)</Text>
              </TouchableOpacity>
            </View>
          )}
        </Card>

        {error && (
          <View style={styles.errorBox} testID="pricing-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {success && (
          <View style={styles.successBox} testID="pricing-success">
            <Text style={styles.successText}>{success}</Text>
          </View>
        )}

        <Text style={styles.legal}>
          You'll be charged £{PRO_PRICE_GBP} every month until cancelled. Powered by Stripe. UK card supported.
        </Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2 },
  scroll: { padding: 16, gap: 16, paddingBottom: 32 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  crownWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 24, fontWeight: '800', color: theme.colors.text },
  heroSub: { color: theme.colors.textMuted },
  planCard: { gap: 8, position: 'relative' },
  planCardActive: { borderColor: theme.colors.primary, borderWidth: 2 },
  proCard: { borderColor: theme.colors.accent, borderWidth: 2, paddingTop: 30 },
  proRibbon: {
    position: 'absolute',
    top: -1,
    right: 16,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  proRibbonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planName: { fontSize: 22, fontWeight: '800', color: theme.colors.primary },
  activeChip: { backgroundColor: theme.colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  activeChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  planPrice: { fontSize: 32, fontWeight: '800', color: theme.colors.text },
  planUnit: { fontSize: 14, color: theme.colors.textMuted, fontWeight: '500' },
  bullets: { gap: 10, marginTop: 8 },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletCheck: { width: 18, height: 18, borderRadius: 9, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' },
  bulletText: { fontSize: 14, color: theme.colors.text, flex: 1 },
  cta: {
    backgroundColor: theme.colors.accent,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  devCancel: { padding: 12, alignItems: 'center' },
  devCancelText: { color: theme.colors.textMuted, fontSize: 13 },
  errorBox: { backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10 },
  errorText: { color: theme.colors.danger, fontSize: 14 },
  successBox: { backgroundColor: '#D1FAE5', padding: 12, borderRadius: 10 },
  successText: { color: theme.colors.success, fontSize: 14, fontWeight: '600' },
  legal: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', marginTop: 8 },
});
