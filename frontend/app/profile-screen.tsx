import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut, Mail, Phone, MapPin, Award, Calendar, Crown } from 'lucide-react-native';
import { theme } from '../src/theme';
import { useAuth } from '../src/AuthContext';
import { mockDb } from '../src/mockDb';
import { Card, Badge, StatusBadge } from '../src/ui';
import { BottomNav } from '../src/BottomNav';
import { useRouter } from 'expo-router';
import { isPro } from '../src/proPlan';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const role = user?.role || 'student';
  const student = user?.email ? mockDb.getStudentByEmail(user.email) : undefined;
  const pro = isPro(user?.subscription_status);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <View style={styles.row}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.name || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} testID="profile-name">{user?.name || 'User'}</Text>
              <Text style={styles.email}>{user?.email}</Text>
              <View style={{ marginTop: 6 }}>
                <Badge label={role === 'instructor' ? 'Instructor' : 'Student'} />
              </View>
            </View>
          </View>
        </Card>

        {student && (
          <>
            <Card style={{ gap: 10 }}>
              <Text style={styles.cardTitle}>Contact details</Text>
              <Row icon={<Mail size={16} color={theme.colors.textMuted} />} text={student.email} />
              <Row icon={<Phone size={16} color={theme.colors.textMuted} />} text={student.phone} />
              <Row icon={<MapPin size={16} color={theme.colors.textMuted} />} text={`${student.address}, ${student.postcode}`} />
            </Card>

            <Card style={{ gap: 10 }}>
              <Text style={styles.cardTitle}>Learning status</Text>
              <Row icon={<Award size={16} color={theme.colors.accent} />} text={`Progress: ${student.progress}%`} />
              <Row icon={<Calendar size={16} color={theme.colors.primary} />} text={`Lessons completed: ${student.lessons_count}`} />
              <View style={{ flexDirection: 'row' }}>
                <StatusBadge status={student.status} />
              </View>
            </Card>
          </>
        )}

        <TouchableOpacity
          style={[styles.proCta, pro && styles.proCtaActive]}
          onPress={() => router.push('/pricing-screen')}
          testID="btn-pricing"
        >
          <Crown size={18} color="#fff" />
          <Text style={styles.proCtaText}>{pro ? 'Manage Pro plan' : 'Upgrade to Pro'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={signOut} testID="btn-signout">
          <LogOut size={18} color="#fff" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>

      <BottomNav role={role} />
    </SafeAreaView>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.contactRow}>
      {icon}
      <Text style={styles.contactText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: 16 },
  title: { ...theme.font.h1 },
  scroll: { padding: 16, gap: 14, paddingBottom: 96 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 22 },
  name: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  email: { ...theme.font.caption, marginTop: 2 },
  cardTitle: { ...theme.font.h3 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contactText: { color: theme.colors.text, fontSize: 14 },
  logoutBtn: {
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  logoutText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  proCta: {
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  proCtaActive: { backgroundColor: theme.colors.primary },
  proCtaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
