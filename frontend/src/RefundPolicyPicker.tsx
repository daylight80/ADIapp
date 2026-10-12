import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { theme } from './theme';
import { Card } from './ui';
import { getMyRefundPolicy, updateMySchoolProfile } from './supabaseDb';
import { REFUND_POLICIES, resolveRefundPolicy, refundOption, type RefundPolicyKey } from './refundPolicy';

/**
 * Choose the refund policy your pupils' agreement states for prepaid hours and
 * block bookings. Saves as soon as you pick one. Lives on School Profile, which solo
 * instructors (their own school's owner) and Franchise owners can both open.
 */
export function RefundPolicyPicker() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policy, setPolicy] = useState<RefundPolicyKey>(resolveRefundPolicy(null));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    getMyRefundPolicy()
      .then((p) => { if (active) setPolicy(resolveRefundPolicy(p)); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const pick = async (key: RefundPolicyKey) => {
    if (key === policy || saving) return;
    const previous = policy;
    setPolicy(key);
    setSaving(true);
    setMessage(null);
    try {
      await updateMySchoolProfile({ refund_policy: key });
      setMessage({ ok: true, text: 'Saved. New pupils will see this in their agreement.' });
    } catch (e: any) {
      setPolicy(previous);
      setMessage({ ok: false, text: e?.message || 'Could not save. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 10 }} testID="refund-policy-card">
      <Text style={styles.title}>Refund policy</Text>
      <Text style={styles.hint}>
        What your pupils&apos; agreement says about unused prepaid hours. The new DVSA code of practice requires a refund policy in your terms.
      </Text>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : (
        REFUND_POLICIES.map((opt) => {
          const selected = opt.key === policy;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.option, selected && styles.optionSelected, saving && { opacity: 0.7 }]}
              onPress={() => pick(opt.key)}
              disabled={saving}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`refund-policy-${opt.key}`}
            >
              <View style={[styles.radio, selected && styles.radioSelected]}>{selected && <View style={styles.radioDot} />}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionLabel}>{opt.label}</Text>
                <Text style={styles.optionDesc}>{opt.description}</Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}
      {!loading && (
        <Text style={styles.preview} testID="refund-policy-preview">
          {`Pupils will read: "${refundOption(policy).sentence}"`}
        </Text>
      )}
      {message && (
        <Text style={[styles.message, { color: message.ok ? theme.colors.success : theme.colors.danger }]} testID="refund-policy-message">
          {message.text}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 12.5, color: theme.colors.textMuted, lineHeight: 18 },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border },
  optionSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.background },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioSelected: { borderColor: theme.colors.primary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary },
  optionLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  optionDesc: { fontSize: 12.5, color: theme.colors.textMuted, marginTop: 1, lineHeight: 17 },
  preview: { fontSize: 12.5, color: theme.colors.textMuted, lineHeight: 18, fontStyle: 'italic' },
  message: { fontSize: 13, fontWeight: '600' },
});
