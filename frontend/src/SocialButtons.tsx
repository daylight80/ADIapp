import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { enabledProviders, providerLabel, startSocial, type SocialProvider } from './socialAuth';

type Props = {
  mode: 'signin' | 'link';
  /** Hide providers already linked (link mode). */
  skip?: string[];
  onError: (message: string) => void;
  onDone?: () => void;
};

/** "Continue with Google / Apple" buttons. Renders nothing until a provider has been switched on. */
export function SocialButtons({ mode, skip = [], onError, onDone }: Props) {
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const providers = enabledProviders().filter((p) => !skip.includes(p));
  if (!providers.length) return null;

  const press = async (p: SocialProvider) => {
    setBusy(p);
    const r = await startSocial(mode, p);
    setBusy(null);
    if (!r.ok && !r.cancelled && r.error) onError(r.error);
    if (r.ok && !r.pending) onDone?.();
  };

  return (
    <View style={s.wrap}>
      {providers.map((p) => (
        <TouchableOpacity
          key={p}
          style={[s.btn, p === 'apple' && s.apple, busy !== null && { opacity: 0.6 }]}
          onPress={() => press(p)}
          disabled={busy !== null}
          accessibilityRole="button"
          testID={`social-${mode}-${p}`}
        >
          {busy === p
            ? <ActivityIndicator color={p === 'apple' ? '#fff' : '#111'} />
            : <Text style={[s.text, p === 'apple' && { color: '#fff' }]}>
                {mode === 'link' ? `Link ${providerLabel(p)}` : `Continue with ${providerLabel(p)}`}
              </Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  btn: {
    minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: '#D5CEBF', backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14,
  },
  apple: { backgroundColor: '#000', borderColor: '#000' },
  text: { fontSize: 15.5, fontWeight: '700', color: '#111' },
});
