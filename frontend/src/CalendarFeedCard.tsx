import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import {
  CalendarSync, Copy, RefreshCcw, Power, ExternalLink, CircleCheck,
} from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { copyToClipboard } from './tools';
import { calendarApi, absoluteFeedUrl, CalendarStatus } from './calendarFeed';

/**
 * Per-instructor iCal feed control surface.
 *
 * UX states:
 *   - "loading"   — initial GET /status
 *   - "disabled"  — feature off; show "Enable diary sharing" CTA
 *   - "enabled"   — show full URL + Copy / Regenerate / Disable / How-to
 *
 * The token is generated server-side; we never persist it locally. Calling
 * Regenerate immediately invalidates any previously-shared URL.
 */
export function CalendarFeedCard() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const s = await calendarApi.status();
      setStatus(s);
    } catch (e: any) {
      setError(e?.message || 'Could not load calendar feed status.');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAction = async (
    label: string,
    fn: () => Promise<CalendarStatus>,
    confirmFirst?: { title: string; body: string }
  ) => {
    if (confirmFirst) {
      const yes = await new Promise<boolean>((resolve) => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          // Web — use native confirm so Playwright can drive it.
          resolve(window.confirm(`${confirmFirst.title}\n\n${confirmFirst.body}`));
        } else {
          Alert.alert(confirmFirst.title, confirmFirst.body, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', style: 'destructive', onPress: () => resolve(true) },
          ]);
        }
      });
      if (!yes) return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await fn();
      setStatus(s);
    } catch (e: any) {
      setError(e?.message || `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  const onCopy = () => {
    const url = status ? absoluteFeedUrl(status) : null;
    if (!url) return;
    const ok = copyToClipboard(url);
    if (ok) {
      setCopiedAt(Date.now());
      setTimeout(() => setCopiedAt(null), 2400);
    } else {
      Alert.alert('Feed URL', url);
    }
  };

  // ---- Render --------------------------------------------------------------

  if (!status) {
    return (
      <Card style={{ gap: 10 }} testID="card-calendar-feed">
        <Header />
        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.hint}>Loading…</Text>
          </View>
        )}
      </Card>
    );
  }

  const url = absoluteFeedUrl(status);

  return (
    <Card style={{ gap: 10 }} testID="card-calendar-feed">
      <Header />
      {!status.enabled ? (
        <>
          <Text style={styles.hint}>
            Subscribe to your ADI Pro diary in Apple Calendar, Google Calendar or Outlook.
            Lessons appear as “Driving lesson — Student name”. The link stays in sync — new
            lessons show up automatically.
          </Text>
          <TouchableOpacity
            style={[styles.cta, busy && styles.btnDisabled]}
            onPress={() => runAction('Enable', calendarApi.enable)}
            disabled={busy}
            testID="btn-calendar-enable"
          >
            {busy
              ? <ActivityIndicator color="#fff" />
              : (
                <>
                  <CalendarSync size={16} color="#fff" />
                  <Text style={styles.ctaText}>Enable diary sharing</Text>
                </>
              )}
          </TouchableOpacity>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </>
      ) : (
        <>
          <Text style={styles.hint}>
            Paste this URL into Apple Calendar / Google Calendar / Outlook as a new
            subscribed calendar. Treat it like a password — anyone with the link can
            see your lesson times.
          </Text>

          <View style={styles.urlRow}>
            <Text style={styles.urlText} numberOfLines={2} selectable testID="text-feed-url">
              {url}
            </Text>
            <TouchableOpacity
              style={[styles.iconBtn, copiedAt && styles.iconBtnSuccess]}
              onPress={onCopy}
              testID="btn-copy-feed"
              accessibilityLabel="Copy feed URL"
            >
              {copiedAt
                ? <CircleCheck size={16} color="#fff" />
                : <Copy size={16} color="#fff" />}
            </TouchableOpacity>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.secondaryBtn, busy && styles.btnDisabled]}
              onPress={() => runAction('Regenerate', calendarApi.regenerate, {
                title: 'Regenerate calendar URL?',
                body: 'The current link will stop working immediately. Anyone subscribed to it will need the new URL.',
              })}
              disabled={busy}
              testID="btn-calendar-regenerate"
            >
              <RefreshCcw size={14} color={theme.colors.primary} />
              <Text style={styles.secondaryText}>Regenerate</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dangerBtn, busy && styles.btnDisabled]}
              onPress={() => runAction('Disable', calendarApi.disable, {
                title: 'Disable diary sharing?',
                body: 'The feed will stop working for all subscribed calendars. You can turn it back on any time.',
              })}
              disabled={busy}
              testID="btn-calendar-disable"
            >
              <Power size={14} color="#fff" />
              <Text style={styles.dangerText}>Disable</Text>
            </TouchableOpacity>
          </View>

          {/* How-to */}
          <View style={styles.howToBox} testID="calendar-howto">
            <View style={styles.howToRow}>
              <ExternalLink size={13} color={theme.colors.textMuted} />
              <Text style={styles.howToTitle}>How to subscribe</Text>
            </View>
            <Text style={styles.howToLine}>
              • <Text style={styles.howToStrong}>Google Calendar:</Text> Other calendars → + → From URL → paste.
            </Text>
            <Text style={styles.howToLine}>
              • <Text style={styles.howToStrong}>Apple Calendar (iOS):</Text> Calendars → Add Calendar → Add Subscription Calendar → paste.
            </Text>
            <Text style={styles.howToLine}>
              • <Text style={styles.howToStrong}>Outlook:</Text> Add calendar → Subscribe from web → paste.
            </Text>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </>
      )}
    </Card>
  );
}

function Header() {
  return (
    <View style={styles.headerRow}>
      <CalendarSync size={18} color={theme.colors.primary} />
      <Text style={styles.cardTitle}>Calendar feed (.ics)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  cta: {
    height: 46,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.background,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 8,
    marginTop: 4,
  },
  urlText: { flex: 1, fontSize: 12, color: theme.colors.text, fontFamily: 'monospace' as any },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnSuccess: { backgroundColor: theme.colors.success },
  actionsRow: { flexDirection: 'row', gap: 8 },
  secondaryBtn: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface,
  },
  secondaryText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },
  dangerBtn: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: theme.colors.danger,
  },
  dangerText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  howToBox: {
    marginTop: 4,
    padding: 10,
    borderRadius: 10,
    backgroundColor: theme.colors.primaryLight,
    gap: 4,
  },
  howToRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  howToTitle: { fontSize: 12, fontWeight: '800', color: theme.colors.primary, letterSpacing: 0.4 },
  howToLine: { fontSize: 12, color: theme.colors.text, lineHeight: 18 },
  howToStrong: { fontWeight: '700', color: theme.colors.text },
  errorText: { color: theme.colors.danger, fontSize: 12, marginTop: 4 },
});
