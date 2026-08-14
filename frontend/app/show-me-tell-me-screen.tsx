import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, LayoutAnimation, Platform, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ChevronDown, ChevronUp, Wrench, Car } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card, Badge } from '../src/ui';
import { TELL_ME_QUESTIONS, SHOW_ME_QUESTIONS, type ShowMeTellMeQuestion } from '../src/showMeTellMe';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Section = 'tell' | 'show';

export default function ShowMeTellMeScreen() {
  const router = useRouter();
  const [section, setSection] = useState<Section>('tell');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const list = section === 'tell' ? TELL_ME_QUESTIONS : SHOW_ME_QUESTIONS;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Show Me, Tell Me</Text>
        <View style={{ width: 38 }} />
      </View>

      <Text style={styles.subtitle}>
        The examiner asks one 'tell me' question before you drive off, and one 'show me' question while
        driving — picked at random from these {TELL_ME_QUESTIONS.length + SHOW_ME_QUESTIONS.length} official DVSA questions.
      </Text>

      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, section === 'tell' && styles.toggleBtnActive]}
          onPress={() => { setSection('tell'); setExpandedId(null); }}
          testID="tab-tell-me"
        >
          <Wrench size={16} color={section === 'tell' ? '#fff' : theme.colors.text} />
          <Text style={[styles.toggleText, section === 'tell' && styles.toggleTextActive]}>
            Tell me ({TELL_ME_QUESTIONS.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, section === 'show' && styles.toggleBtnActive]}
          onPress={() => { setSection('show'); setExpandedId(null); }}
          testID="tab-show-me"
        >
          <Car size={16} color={section === 'show' ? '#fff' : theme.colors.text} />
          <Text style={[styles.toggleText, section === 'show' && styles.toggleTextActive]}>
            Show me ({SHOW_ME_QUESTIONS.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 10 }}>
        {list.map((q: ShowMeTellMeQuestion, i: number) => {
          const expanded = expandedId === q.id;
          return (
            <TouchableOpacity key={q.id} onPress={() => toggle(q.id)} activeOpacity={0.7} testID={`qa-${q.id}`}>
              <Card style={{ gap: 8 }}>
                <View style={styles.qRow}>
                  <View style={styles.qNumber}>
                    <Text style={styles.qNumberText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.qText}>{q.question}</Text>
                  {expanded ? (
                    <ChevronUp size={18} color={theme.colors.textMuted} />
                  ) : (
                    <ChevronDown size={18} color={theme.colors.textMuted} />
                  )}
                </View>
                {q.requiresBonnetOpen && !expanded && (
                  <Badge label="Open the bonnet" bg={theme.colors.lockedBg} color={theme.colors.accent} />
                )}
                {expanded && (
                  <View style={styles.answerBox}>
                    {q.requiresBonnetOpen && (
                      <Badge label="Open the bonnet" bg={theme.colors.lockedBg} color={theme.colors.accent} />
                    )}
                    <Text style={styles.answerText}>{q.answer}</Text>
                  </View>
                )}
              </Card>
            </TouchableOpacity>
          );
        })}
        <Text style={styles.footnote}>
          Source: gov.uk "Car 'show me, tell me' vehicle safety questions" — Driver and Vehicle Standards
          Agency. An incorrect answer counts as one minor fault, not an automatic failure — unless the
          examiner has to intervene during a "show me" demonstration.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  iconBtn: { padding: 8, borderRadius: 8, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { ...theme.font.h2, flex: 1, textAlign: 'center' },
  subtitle: { fontSize: 13, color: theme.colors.textMuted, paddingHorizontal: 16, paddingBottom: 8, lineHeight: 18 },
  toggleRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  toggleBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  toggleText: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
  toggleTextActive: { color: '#fff' },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qNumber: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  qNumberText: { fontSize: 12, fontWeight: '800', color: theme.colors.primary },
  qText: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.colors.text, lineHeight: 19 },
  answerBox: { gap: 8, paddingLeft: 36, paddingTop: 2 },
  answerText: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 19 },
  footnote: { fontSize: 11, color: theme.colors.textMuted, textAlign: 'center', paddingVertical: 12, lineHeight: 16 },
});
