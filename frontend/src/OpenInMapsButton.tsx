import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View, Alert } from 'react-native';
import { Navigation as NavIcon } from 'lucide-react-native';
import { theme } from './theme';
import { openNavigation } from './tools';
import { useInstructorProfile } from './useSupabaseData';

type Props = {
  address: string;
  variant?: 'pill' | 'icon';
  label?: string;
  testID?: string;
  /** Override the user's preferred nav app. Defaults to instructor preference (or Google). */
  navApp?: 'google' | 'waze' | 'apple';
};

/**
 * Small, reusable "Open in Maps" action.
 *
 * - `pill`  → rounded button with icon + label (default)
 * - `icon`  → compact icon-only square button
 *
 * Uses the user's preferred navigation app (set in Profile → Preferred nav app).
 * Falls back to Google Maps if no preference is stored.
 *
 * Zero API keys required — opens the user's native Maps app via deep-link.
 */
export function OpenInMapsButton({ address, variant = 'pill', label = 'Open in Maps', testID, navApp }: Props) {
  const { profile } = useInstructorProfile();
  const preferred = (navApp || profile?.preferred_nav_app || 'google') as 'google' | 'waze' | 'apple';

  const trimmed = (address || '').trim().replace(/^,+|,+$/g, '').replace(/,\s*,/g, ',').trim();
  const disabled = !trimmed || trimmed === ',' || trimmed.length < 3;

  const onPress = async () => {
    if (disabled) {
      Alert.alert('No address', 'There is no address on file to navigate to.');
      return;
    }
    await openNavigation(preferred, trimmed);
  };

  if (variant === 'icon') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        style={[styles.iconBtn, disabled && styles.disabled]}
        testID={testID || 'btn-open-maps'}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${trimmed || 'no address'}`}
        hitSlop={8}
      >
        <NavIcon size={14} color={disabled ? theme.colors.textMuted : theme.colors.primary} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.pill, disabled && styles.disabled]}
      testID={testID || 'btn-open-maps'}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${trimmed || 'no address'}`}
    >
      <NavIcon size={13} color={disabled ? theme.colors.textMuted : theme.colors.primary} />
      <Text style={[styles.pillText, disabled && styles.disabledText]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Inline row helper — renders the address text + an "Open in Maps" pill aligned to the right.
 * Useful for contact-row layouts (icon + text + action).
 */
export function AddressActionRow({ address, testID }: { address: string; testID?: string }) {
  const clean = (address || '').replace(/^,+|,+$/g, '').replace(/,\s*,/g, ',').trim();
  if (!clean) return null;
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.rowText} numberOfLines={2}>{clean}</Text>
      <OpenInMapsButton address={clean} variant="pill" testID={testID ? `${testID}-action` : undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.primaryLight,
    borderWidth: 1,
    borderColor: theme.colors.primary + '33',
    minHeight: 32,
  },
  pillText: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primaryLight,
    borderWidth: 1,
    borderColor: theme.colors.primary + '33',
  },
  disabled: {
    opacity: 0.45,
  },
  disabledText: {
    color: theme.colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowText: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 14,
  },
});
