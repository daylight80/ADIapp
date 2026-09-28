import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { LEGAL_LAST_UPDATED, type LegalSection } from './legalContent';

/**
 * Shared layout for the Terms of Service and Privacy Policy screens. Uses the
 * sign-in screen's warm-paper palette and fonts, since these pages are reached
 * from it. Both routes are in _layout's PUBLIC_ROUTES so they open for people
 * who are not signed in yet (they're linked from the register form).
 */
const C = {
  surface: '#F5F2EC',
  card: '#FFFFFF',
  border: '#E4DED2',
  text: '#0F172A',
  textMuted: '#8A8172',
  textMuted2: '#64748B',
  primary: '#00539F',
};

type Props = {
  title: string;
  intro: string;
  sections: LegalSection[];
  /** The sibling document, offered at the bottom ("Also read our ..."). */
  other: { label: string; route: string };
  testID?: string;
};

export function LegalPage({ title, intro, sections, other, testID }: Props) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  // These pages can be opened straight from a link with no history behind
  // them, where router.back() would do nothing — fall back to sign-in.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/sign-up-login-screen');
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']} testID={testID}>
      <View style={[s.header, isTablet && s.narrow]}>
        <TouchableOpacity onPress={goBack} style={s.backBtn} testID="btn-back" accessibilityLabel="Go back">
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{title}</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={[s.scroll, isTablet && s.narrow]}>
        <Text style={s.h1}>{title}</Text>
        <Text style={s.updated}>Last updated {LEGAL_LAST_UPDATED}</Text>
        <Text style={s.intro} selectable>{intro}</Text>

        {sections.map((sec) => {
          // Numbered headings ("1. Who we are") are main sections; the
          // unnumbered ones are sub-headings within the section above.
          const isMain = /^\d+\./.test(sec.heading);
          return (
            <View key={sec.heading} style={s.section}>
              <Text style={isMain ? s.h2 : s.h3}>{sec.heading}</Text>
              {sec.body?.map((p, i) => (
                <Text key={`p${i}`} style={s.p} selectable>{p}</Text>
              ))}
              {sec.bullets?.map((b, i) => (
                <View key={`b${i}`} style={s.bulletRow}>
                  <Text style={s.bulletDot}>{'•'}</Text>
                  <Text style={s.bulletText} selectable>{b}</Text>
                </View>
              ))}
            </View>
          );
        })}

        <View style={s.footerCard}>
          <TouchableOpacity onPress={() => router.push(other.route as any)} testID="legal-link-other">
            <Text style={s.footerLink}>Also read our {other.label}</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  narrow: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Barlow_700Bold', fontSize: 16, color: C.text },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },

  h1: { fontFamily: 'Archivo_800ExtraBold', fontSize: 30, letterSpacing: -0.8, color: C.text },
  updated: { fontFamily: 'Barlow_600SemiBold', fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.textMuted, marginTop: 6 },
  intro: { fontFamily: 'Barlow_400Regular', fontSize: 15.5, lineHeight: 23, color: C.textMuted2, marginTop: 16 },

  section: { marginTop: 26 },
  h2: { fontFamily: 'Archivo_700Bold', fontSize: 18, letterSpacing: -0.3, color: C.text, marginBottom: 8 },
  h3: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: C.text, marginBottom: 6, marginTop: 4 },
  p: { fontFamily: 'Barlow_400Regular', fontSize: 15, lineHeight: 23, color: C.text, marginBottom: 10 },
  bulletRow: { flexDirection: 'row', gap: 10, paddingRight: 8, marginBottom: 6 },
  bulletDot: { fontFamily: 'Barlow_700Bold', fontSize: 15, lineHeight: 23, color: C.primary },
  bulletText: { flex: 1, fontFamily: 'Barlow_400Regular', fontSize: 15, lineHeight: 23, color: C.text },

  footerCard: { marginTop: 34, paddingTop: 18, borderTopWidth: 1, borderTopColor: C.border },
  footerLink: { fontFamily: 'Barlow_600SemiBold', fontSize: 14.5, color: C.primary },
});
