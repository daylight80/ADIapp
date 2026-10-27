import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { shouldShowIntro, readIntroLastShown, markIntroShown, INTRO_MAX_MS } from './introSchedule';

const SOURCE = require('../assets/video/app-open.mp4');

/** Plays the intro full screen when the app opens, at most once every 24 hours. Tap Skip to leave early. */
export function IntroVideoGate() {
  // 'checking' keeps a black cover up for the moment it takes to read the last-shown time, so the app never flashes first.
  const [state, setState] = useState<'checking' | 'playing' | 'done'>('checking');
  useEffect(() => {
    let alive = true;
    readIntroLastShown().then((last) => {
      if (!alive) return;
      if (shouldShowIntro(last, Date.now())) {
        markIntroShown(); // counted as shown once it starts, so an app killed mid-clip does not replay it
        setState('playing');
      } else {
        setState('done');
      }
    });
    return () => { alive = false; };
  }, []);
  if (state === 'done') return null;
  if (state === 'checking') return <View style={s.cover} pointerEvents="auto" testID="intro-checking" />;
  return <IntroPlayer onDone={() => setState('done')} />;
}

function IntroPlayer({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = false;
    p.play();
  });
  const finish = useCallback(() => onDone(), [onDone]);
  useEffect(() => {
    const ended = player.addListener('playToEnd', finish);
    const status = player.addListener('statusChange', (e: { status?: string }) => { if (e?.status === 'error') finish(); });
    const timer = setTimeout(finish, INTRO_MAX_MS);
    return () => { ended.remove(); status.remove(); clearTimeout(timer); };
  }, [player, finish]);
  return (
    <View style={s.cover} testID="intro-video">
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsFullscreen={false} />
      <TouchableOpacity
        style={[s.skip, { top: insets.top + 12 }]}
        onPress={finish}
        accessibilityRole="button"
        accessibilityLabel="Skip the intro"
        testID="btn-skip-intro"
      >
        <Text style={s.skipText}>Skip</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 1000, elevation: 1000 },
  skip: { position: 'absolute', right: 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)' },
  skipText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
