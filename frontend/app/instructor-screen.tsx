import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { BottomNav } from '../src/BottomNav';
import { StudentInstructorCard } from '../src/StudentInstructorCard';
import { getMyInstructorCard } from '../src/supabaseDb';
import type { InstructorCardData } from '../src/instructorCard';

/**
 * The pupil's Instructor tab: name, ADI number, contact details, the car to look for at
 * pickup, an "I'm running late" text and the DVSA complaints link.
 */
export default function InstructorScreen() {
  const { user } = useAuth();
  const [card, setCard] = useState<InstructorCardData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyInstructorCard()
      .then((c) => { if (!cancelled) setCard(c); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [user?.id]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Instructor</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <StudentInstructorCard instructor={card} loadFailed={loadFailed} pupilName={user?.name} />
      </ScrollView>
      <BottomNav role="student" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: 16 },
  title: { ...theme.font.h1 },
  scroll: { padding: 16, gap: 14, paddingBottom: 96 },
});
