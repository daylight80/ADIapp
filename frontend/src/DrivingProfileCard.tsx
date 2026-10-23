import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from './theme';
import type { DrivingProfile } from './drivingProfile';

/** Instructor-only summary on the pupil's Overview: focus, recurring issues, last practice note, what is left to meet. */
export function DrivingProfileCard({ profile }: { profile: DrivingProfile }) {
  const { focus, issues, practice, toMeet } = profile;
  if (!focus && !issues.length && !practice && !toMeet.length) return null;
  return (
    <View style={s.card} testID="driving-profile">
      <Text style={s.title}>Driving profile</Text>
      {!!focus && <Text style={s.line} testID="profile-focus"><Text style={s.label}>Focus: </Text>{focus}</Text>}
      {issues.length > 0 && (
        <View testID="profile-issues">
          <Text style={s.label}>Recurring issues</Text>
          {issues.map((i) => <Text key={i} style={s.line}>{'•'} {i}</Text>)}
        </View>
      )}
      {!!practice && <Text style={s.line} testID="profile-practice"><Text style={s.label}>Last notes, needs practice: </Text>{practice}</Text>}
      {toMeet.length > 0 && <Text style={s.line} testID="profile-to-meet"><Text style={s.label}>Still to meet: </Text>{toMeet.join(', ')}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 12, padding: 14, gap: 6, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  label: { fontWeight: '700', color: theme.colors.text },
  line: { fontSize: 13.5, lineHeight: 19, color: theme.colors.text },
});
