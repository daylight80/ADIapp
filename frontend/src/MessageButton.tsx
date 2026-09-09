import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { MessageSquare } from 'lucide-react-native';
import { theme } from './theme';
import { openSmsComposer } from './tools';

type Props = {
  phone: string;
  variant?: 'pill' | 'icon';
  label?: string;
  body?: string;
  testID?: string;
  style?: any;
  textStyle?: any;
};

/**
 * Small, reusable "Message" quick action (9 Sept 2026), per Grant directly
 * — paired with OpenInMapsButton as the two quick-action buttons the
 * design calls for on a lesson card, mirroring that component's exact
 * shape/API (pill vs icon variant, style/textStyle overrides, same
 * disabled-when-nothing-to-act-on convention) so the two sit consistently
 * side by side wherever they're used together.
 *
 * Opens the device's native SMS composer via a deep link — no message
 * content is sent from here directly, matching openSmsComposer's existing
 * behaviour used elsewhere in the app (student-crm-screen's invite flow).
 */
export function MessageButton({ phone, variant = 'pill', label = 'Message', body = '', testID, style, textStyle }: Props) {
  const trimmed = (phone || '').trim();
  const disabled = trimmed.length < 5;

  const onPress = async () => {
    if (disabled) {
      Alert.alert('No phone number', 'There is no phone number on file to message.');
      return;
    }
    await openSmsComposer(trimmed, body);
  };

  if (variant === 'icon') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        style={[styles.iconBtn, disabled && styles.disabled]}
        testID={testID || 'btn-message'}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${trimmed || 'no phone number'}`}
        hitSlop={8}
      >
        <MessageSquare size={14} color={disabled ? theme.colors.textMuted : theme.colors.primary} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.pill, disabled && styles.disabled, style]}
      testID={testID || 'btn-message'}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${trimmed || 'no phone number'}`}
    >
      <MessageSquare size={13} color={disabled ? theme.colors.textMuted : theme.colors.primary} />
      <Text style={[styles.pillText, disabled && styles.disabledText, textStyle]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
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
});
