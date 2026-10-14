import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Gift } from 'lucide-react-native';
import { redeemGiftVoucher } from './supabaseDb';
import { bump } from './useSupabaseData';
import { formatVoucherCodeInput, looksLikeVoucherCode, redeemErrorMessage, redeemSuccessMessage } from './voucher';

const C = { border: '#E4DED2', text: '#0F172A', muted: '#6B6356', primary: '#00539F', danger: '#B91C1C', success: '#047857' };

/**
 * "Redeem a voucher" on the pupil's own Wallet. The pupil types the code from their gift voucher and the
 * hours are added to their wallet straight away. All the checking happens in the database (see
 * redeemGiftVoucher), so this only shows what came back.
 */
export function RedeemVoucherCard() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const redeem = async () => {
    if (busy || !looksLikeVoucherCode(code)) return;
    setBusy(true);
    setResult(null);
    try {
      const { hours, balance } = await redeemGiftVoucher(code);
      setResult({ ok: true, text: redeemSuccessMessage(hours, balance) });
      setCode('');
      bump(); // refreshes the hours shown on this screen
    } catch (e) {
      setResult({ ok: false, text: redeemErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const ready = looksLikeVoucherCode(code) && !busy;

  return (
    <View style={styles.card} testID="redeem-voucher-card">
      <View style={styles.titleRow}>
        <Gift size={18} color={C.primary} />
        <Text style={styles.title}>Have a gift voucher?</Text>
      </View>
      <Text style={styles.sub}>Enter the code from your voucher to add the hours to your wallet.</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(t) => { setCode(formatVoucherCodeInput(t)); setResult(null); }}
        placeholder="XXXX-XXXX-XXXX"
        placeholderTextColor="#A39A89"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={14}
        editable={!busy}
        onSubmitEditing={redeem}
        testID="input-voucher-code"
      />
      <TouchableOpacity style={[styles.btn, !ready && { opacity: 0.45 }]} onPress={redeem} disabled={!ready} testID="btn-redeem-voucher">
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Redeem voucher</Text>}
      </TouchableOpacity>
      {!!result && (
        <Text style={[styles.result, { color: result.ok ? C.success : C.danger }]} testID="redeem-voucher-result">{result.text}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 14, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: C.text },
  sub: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, lineHeight: 18, color: C.muted },
  input: { height: 46, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, letterSpacing: 2, color: C.text, backgroundColor: '#FBF9F4' },
  btn: { height: 46, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 15 },
  result: { fontFamily: 'Barlow_500Medium', fontSize: 13, lineHeight: 19 },
});
