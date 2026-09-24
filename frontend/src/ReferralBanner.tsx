import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Gift, X } from 'lucide-react-native';
import { supabase } from './supabaseClient';

/**
 * "Refer a driving instructor, get 1 month free" (23 Sept 2026), per
 * Grant directly. Per his own answers to the design questions this
 * needed: the reward only actually triggers once the referred
 * instructor's school becomes a paying subscriber (server.py's Stripe
 * webhook), only the referrer is rewarded, and it's capped at
 * REFERRAL_MAX_REWARDS_PER_YEAR (server.py) rewarded referrals per
 * rolling 12 months. This component is purely the share surface — it
 * doesn't know or need to know any of that reward logic itself, only
 * the caller's own code/link and a summary count to show.
 *
 * Dismissible and remembers it (AsyncStorage) — a promotional banner
 * that keeps coming back every app launch after being closed once would
 * just train people to ignore it.
 */

const DISMISSED_KEY = 'referral_banner_dismissed_v1';

type Summary = { pending: number; rewarded_this_year: number; capped: number; cap_per_year: number };

async function authedGet(path: string): Promise<any> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const base = (process as any).env?.EXPO_PUBLIC_BACKEND_URL || '';
  const resp = await fetch(`${base.replace(/\/+$/, '')}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Request failed (HTTP ${resp.status})`);
  return resp.json();
}

export function ReferralBanner() {
  const [dismissed, setDismissed] = useState<boolean | null>(null); // null = not checked yet, avoids a one-frame flash
  const [code, setCode] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DISMISSED_KEY)
      .then((v) => { if (!cancelled) setDismissed(v === 'true'); })
      .catch(() => { if (!cancelled) setDismissed(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (dismissed !== false) return; // only fetch once we know it's genuinely showing
    let cancelled = false;
    Promise.all([authedGet('/referrals/my-code'), authedGet('/referrals/summary')])
      .then(([codeRes, summaryRes]) => {
        if (cancelled) return;
        setCode(codeRes.code);
        setShareLink(codeRes.share_link);
        setSummary(summaryRes);
      })
      .catch(() => { /* silently do nothing — a promotional banner failing to load isn't worth an error state */ });
    return () => { cancelled = true; };
  }, [dismissed]);

  const dismiss = () => {
    setDismissed(true);
    AsyncStorage.setItem(DISMISSED_KEY, 'true').catch(() => {});
  };

  const onShare = async () => {
    if (!code) return;
    setSharing(true);
    try {
      await Share.share({
        message: `Come join me on ADI Pro — the app I use to run my driving lessons. Sign up with my code ${code} and you'll help me get a free month: ${shareLink}`,
      });
    } catch {
      // Share sheet being dismissed/cancelled throws — nothing to show for that.
    } finally {
      setSharing(false);
    }
  };

  if (dismissed !== false || !code) return null;

  const hasActivity = !!summary && (summary.pending > 0 || summary.rewarded_this_year > 0);

  return (
    <View style={s.card} testID="referral-banner">
      <TouchableOpacity style={s.closeBtn} onPress={dismiss} testID="referral-banner-dismiss">
        <X size={16} color="#fff" />
      </TouchableOpacity>
      <Gift size={22} color="#fff" />
      <Text style={s.title}>Refer a driving instructor, get 1 month free</Text>
      <Text style={s.sub}>
        {hasActivity
          ? `${summary!.pending} pending · ${summary!.rewarded_this_year} earned this year (cap ${summary!.cap_per_year})`
          : 'Share your code — you\'re rewarded once they subscribe.'}
      </Text>
      <TouchableOpacity style={s.shareBtn} onPress={onShare} disabled={sharing} testID="referral-banner-share">
        {sharing ? <ActivityIndicator color="#fff" /> : <Text style={s.shareBtnText}>Share my code · {code}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 12, backgroundColor: '#00539F', borderRadius: 18, padding: 16, gap: 6 },
  closeBtn: { position: 'absolute', top: 10, right: 10, padding: 4, zIndex: 1 },
  title: { fontFamily: 'Barlow_700Bold', fontSize: 15.5, color: '#fff', paddingRight: 24 },
  sub: { fontFamily: 'Barlow_500Medium', fontSize: 12.5, color: 'rgba(255,255,255,0.85)' },
  shareBtn: { marginTop: 8, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 10, height: 42, alignItems: 'center', justifyContent: 'center' },
  shareBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 14, color: '#fff' },
});
