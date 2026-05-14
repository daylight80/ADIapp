import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { X, Check, Crown } from 'lucide-react-native';
import { theme } from './theme';
import { PRO_FEATURES, PRO_PRICE_GBP, FREE_STUDENT_LIMIT } from './proPlan';

type Props = {
  visible: boolean;
  onClose: () => void;
  reason?: string;
};

export function PaywallModal({ visible, onClose, reason }: Props) {
  const router = useRouter();

  const goToPricing = () => {
    onClose();
    router.push('/pricing-screen');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="paywall-modal">
          <TouchableOpacity style={styles.close} onPress={onClose} testID="paywall-close">
            <X size={20} color={theme.colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.crownWrap}>
            <Crown size={32} color="#fff" />
          </View>

          <Text style={styles.title}>Upgrade to Pro</Text>
          <Text style={styles.subtitle}>
            {reason || `Free tier is limited to ${FREE_STUDENT_LIMIT} students.`}
          </Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>£{PRO_PRICE_GBP}</Text>
            <Text style={styles.priceUnit}>/month</Text>
          </View>

          <ScrollView style={{ maxHeight: 200, alignSelf: 'stretch' }}>
            <View style={styles.features}>
              {PRO_FEATURES.map((f) => (
                <View key={f} style={styles.featureRow}>
                  <View style={styles.featureCheck}>
                    <Check size={12} color="#fff" />
                  </View>
                  <Text style={styles.featureText}>{f}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.upgradeBtn} onPress={goToPricing} testID="paywall-upgrade">
            <Text style={styles.upgradeText}>See pricing</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} testID="paywall-maybe-later">
            <Text style={styles.later}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  close: { position: 'absolute', top: 12, right: 12, padding: 8 },
  crownWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', marginBottom: 8 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginVertical: 8 },
  price: { fontSize: 36, fontWeight: '800', color: theme.colors.primary },
  priceUnit: { fontSize: 16, color: theme.colors.textMuted },
  features: { gap: 10, alignSelf: 'stretch', marginVertical: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { fontSize: 14, color: theme.colors.text, flex: 1 },
  upgradeBtn: {
    backgroundColor: theme.colors.accent,
    height: 52,
    borderRadius: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  upgradeText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  later: { color: theme.colors.textMuted, marginTop: 12, fontSize: 14, fontWeight: '500' },
});
