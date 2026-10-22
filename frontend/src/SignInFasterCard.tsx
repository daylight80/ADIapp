import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SocialButtons } from './SocialButtons';
import { enabledProviders, linkedProviders, providerLabel, type SocialProvider } from './socialAuth';

/** Pupil home: offer to link Google or Apple so they can sign in faster next time. Hidden once nothing is left to link. */
export function SignInFasterCard() {
  const configured = enabledProviders();
  const [linked, setLinked] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => { linkedProviders().then(setLinked); }, []);
  useEffect(() => { if (configured.length) refresh(); }, [configured.length, refresh]);

  if (!configured.length || linked === null) return null;
  const done = configured.filter((p) => linked.includes(p));
  const left = configured.filter((p) => !linked.includes(p));
  if (!left.length && !done.length) return null;

  const names = (list: SocialProvider[]) => list.map(providerLabel).join(' and ');

  return (
    <View style={s.card} testID="v2-student-signin-faster">
      <Text style={s.title}>Sign in faster</Text>
      {done.length > 0 && <Text style={s.body}>Linked: {names(done)}. You can use it on the sign-in screen.</Text>}
      {left.length > 0 && (
        <>
          <Text style={s.body}>Link your {names(left)} account and skip typing a password next time.</Text>
          <View style={{ marginTop: 10 }}>
            <SocialButtons mode="link" skip={linked} onError={setError} onDone={refresh} />
          </View>
        </>
      )}
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E4DED2', padding: 16, marginBottom: 14 },
  title: { fontSize: 16, fontWeight: '700', color: '#111' },
  body: { fontSize: 14, lineHeight: 20, color: '#555', marginTop: 4 },
  error: { fontSize: 13, color: '#B42318', marginTop: 8 },
});
