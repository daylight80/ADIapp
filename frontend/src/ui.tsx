import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Lock, ChevronRight } from 'lucide-react-native';
import { theme } from './theme';

export function ProgressBar({ progress, color, height = 8, testID }: { progress: number; color?: string; height?: number; testID?: string }) {
  const c = color || theme.colors.primary;
  const p = Math.max(0, Math.min(100, progress));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]} testID={testID}>
      <View style={[styles.fill, { width: `${p}%`, backgroundColor: c, borderRadius: height / 2 }]} />
    </View>
  );
}

export function Badge({ label, color, bg, testID }: { label: string; color?: string; bg?: string; testID?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg || theme.colors.primaryLight }]} testID={testID}>
      <Text style={[styles.badgeText, { color: color || theme.colors.primary }]}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ status, testID }: { status: 'New' | 'Active' | 'Test Ready' | 'Passed' | 'Inactive' | 'Waitlist'; testID?: string }) {
  const map = {
    New: { bg: '#FFF7ED', color: theme.colors.accent },
    Active: { bg: '#E5F0FA', color: theme.colors.primary },
    'Test Ready': { bg: '#D1FAE5', color: theme.colors.success },
    Passed: { bg: '#DCFCE7', color: '#15803D' },
    // Lifecycle statuses added in migration 018
    Inactive: { bg: '#F1F5F9', color: theme.colors.textMuted },
    Waitlist: { bg: '#FEF3C7', color: '#B45309' },
  } as const;
  const { bg, color } = map[status] || map.New;
  return <Badge label={status} bg={bg} color={color} testID={testID} />;
}

export function Card({ children, style, testID }: { children: React.ReactNode; style?: any; testID?: string }) {
  return <View style={[styles.card, style]} testID={testID}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const isSecondary = variant === 'secondary';
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        isSecondary ? styles.btnSecondary : styles.btnPrimary,
        (disabled || loading) && styles.btnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={isSecondary ? theme.colors.primary : '#fff'} />
      ) : (
        <>
          {icon}
          <Text style={[styles.btnText, isSecondary && styles.btnTextSecondary]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// Single reusable "this needs a higher tier" component. Every locked-feature
// moment in the app should render through this rather than a hand-rolled
// card, so the paywall always looks and behaves the same way.
//
//   'banner'     — full-width row with icon, title, subtitle, chevron.
//                  For dashboard sections (KPI grid, competency tracker).
//   'card'       — centered card, no chevron. For a tab/section body that's
//                  entirely locked (e.g. the instructor's Competency tab).
//   'fullscreen' — centered block with an explicit "View plans" button. For
//                  a screen reached by direct/deep navigation that must
//                  enforce the lock itself, not just hide an entry point.
export function LockedFeature({
  variant = 'banner',
  title,
  subtitle,
  icon,
  onPress,
  testID,
}: {
  variant?: 'banner' | 'card' | 'fullscreen';
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const router = useRouter();
  const go = onPress || (() => router.push('/pricing-screen'));
  const lockIcon = icon || <Lock size={variant === 'fullscreen' ? 32 : 20} color={theme.colors.accent} />;

  if (variant === 'fullscreen') {
    return (
      <View style={styles.lockedFullscreen} testID={testID}>
        <View style={styles.lockedIconWrapLg}>{lockIcon}</View>
        <Text style={styles.lockedFullscreenTitle}>{title}</Text>
        <Text style={styles.lockedFullscreenSub}>{subtitle}</Text>
        <Button label="View plans" onPress={go} testID={testID ? `${testID}-cta` : undefined} />
      </View>
    );
  }

  if (variant === 'card') {
    return (
      <TouchableOpacity onPress={go} activeOpacity={0.85} testID={testID}>
        <Card style={styles.lockedCardBody}>
          {icon || <Lock size={28} color={theme.colors.accent} />}
          <Text style={styles.lockedCardTitle}>{title}</Text>
          <Text style={styles.lockedCardSub}>{subtitle}</Text>
        </Card>
      </TouchableOpacity>
    );
  }

  // banner (default)
  return (
    <TouchableOpacity style={styles.lockedBanner} onPress={go} activeOpacity={0.85} testID={testID}>
      <View style={styles.lockedIconWrap}>{lockIcon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.lockedBannerTitle}>{title}</Text>
        <Text style={styles.lockedBannerSub}>{subtitle}</Text>
      </View>
      <ChevronRight size={18} color={theme.colors.accent} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: theme.colors.border, overflow: 'hidden', width: '100%' },
  fill: { height: '100%' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: theme.radius.md,
    paddingHorizontal: 20,
  },
  btnPrimary: { backgroundColor: theme.colors.primary },
  btnSecondary: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnTextSecondary: { color: theme.colors.primary },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.lockedBg,
    borderWidth: 1,
    borderColor: theme.colors.lockedBorder,
  },
  lockedIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.lockedIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedBannerTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.text, marginBottom: 2 },
  lockedBannerSub: { fontSize: 12, color: theme.colors.textMuted, lineHeight: 16 },
  lockedCardBody: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  lockedCardTitle: { ...theme.font.h3 },
  lockedCardSub: { fontSize: 13, color: theme.colors.textMuted, textAlign: 'center' },
  lockedFullscreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  lockedIconWrapLg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.lockedBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  lockedFullscreenTitle: { ...theme.font.h3, marginBottom: 0 },
  lockedFullscreenSub: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', marginBottom: 8 },
});
