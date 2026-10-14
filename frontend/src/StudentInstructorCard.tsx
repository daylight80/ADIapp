import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Phone, Mail, IdCard, Copy, Car, MessageSquare, Clock, Flag } from 'lucide-react-native';
import { theme } from './theme';
import { Card } from './ui';
import { copyToClipboard } from './tools';
import { DVSA_COMPLAINTS_URL } from './agreementTerms';
import { describeCarName, runningLateMessage, smsUrl, telUrl, type InstructorCardData } from './instructorCard';

/**
 * A pupil's own instructor, on the Instructor tab: who they are, how to reach them, and the
 * car to look for at pickup. The details come from my_instructor_card() (a pupil cannot read
 * the instructors table). This used to be a hard-coded demo instructor from mockDb.
 */
export function StudentInstructorCard({
  instructor, loadFailed, pupilName,
}: { instructor: InstructorCardData | null; loadFailed: boolean; pupilName?: string | null }) {
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!instructor) {
    return loadFailed ? (
      <Card testID="student-instructor-error">
        <Text style={styles.hint}>Couldn&apos;t load your instructor&apos;s details. Check your connection and reopen this page.</Text>
      </Card>
    ) : null;
  }

  const phone = instructor.contact_phone || '';
  const email = instructor.contact_email || '';
  const v = instructor.vehicle;
  const carLine = v ? [describeCarName(v), v.transmission].filter(Boolean).join(' · ') : '';

  const copyAdi = () => {
    if (!instructor.adi_number) return;
    copyToClipboard(instructor.adi_number);
    // On the page, not an Alert: Alert.alert does nothing in a browser.
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const runningLate = async () => {
    const body = runningLateMessage(pupilName, instructor.instructor_name);
    if (Platform.OS === 'web') {
      // A browser cannot open a texting app, so copy the message for the pupil to paste.
      copyToClipboard(body);
      setNotice('Message copied. Paste it into a text to your instructor.');
      return;
    }
    try { await Linking.openURL(smsUrl(phone, body, Platform.OS)); }
    catch { setNotice('Could not open your messages app.'); }
  };

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 12 }} testID="student-instructor-card">
        <View>
          <Text style={styles.hint}>YOUR INSTRUCTOR</Text>
          <Text style={styles.name} testID="instructor-name">{instructor.instructor_name || 'Your instructor'}</Text>
          {!!instructor.business_name && <Text style={styles.sub}>{instructor.business_name}</Text>}
        </View>

        {!!phone && (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => Linking.openURL(telUrl(phone))} testID="instructor-call">
              <Phone size={16} color="#fff" /><Text style={styles.actionText}>Call</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => Linking.openURL(smsUrl(phone, '', Platform.OS)).catch(() => setNotice('Could not open your messages app.'))}
              testID="instructor-text"
            >
              <MessageSquare size={16} color="#fff" /><Text style={styles.actionText}>Text</Text>
            </TouchableOpacity>
          </View>
        )}
        {!!phone && <Text style={styles.value} testID="instructor-phone">{phone}</Text>}

        {!!email && (
          <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(`mailto:${email}`)} testID="instructor-email">
            <Mail size={18} color={theme.colors.primary} />
            <Text style={[styles.link, { flex: 1 }]} numberOfLines={1}>{email}</Text>
          </TouchableOpacity>
        )}

        {!!phone && (
          <TouchableOpacity style={styles.lateBtn} onPress={runningLate} testID="instructor-running-late">
            <Clock size={16} color={theme.colors.primary} />
            <Text style={styles.lateText}>I&apos;m running late</Text>
          </TouchableOpacity>
        )}
        {!!notice && <Text style={styles.hint} testID="instructor-notice">{notice}</Text>}
      </Card>

      {!!v && !!(v.make_and_model || v.registration_plate) && (
        <Card style={{ gap: 8 }} testID="instructor-car-card">
          <View style={styles.row}>
            <Car size={18} color={theme.colors.primary} />
            <Text style={styles.title}>Look out for this car</Text>
          </View>
          {!!carLine && <Text style={styles.value} testID="instructor-car">{carLine}</Text>}
          {!!v.registration_plate && <Text style={styles.plate} testID="instructor-plate">{v.registration_plate}</Text>}
        </Card>
      )}

      {!!instructor.adi_number && (
        <Card style={{ gap: 10 }} testID="instructor-adi-card">
          <View style={styles.row}>
            <IdCard size={18} color={theme.colors.primary} />
            <Text style={styles.title}>Instructor&apos;s ADI number</Text>
          </View>
          <View style={styles.adiRow}>
            <Text style={styles.adiValue} testID="adi-value">{instructor.adi_number}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={copyAdi} testID="btn-copy-adi">
              <Copy size={14} color="#fff" />
              <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Paste this into the DVSA booking site to link your instructor.</Text>
        </Card>
      )}

      {!!(instructor.school_phone || instructor.school_email) && (
        <Card style={{ gap: 8 }} testID="instructor-school-card">
          <Text style={styles.title}>{instructor.business_name || 'Your driving school'}</Text>
          <Text style={styles.hint}>Contact your instructor first. Use these if you cannot reach them.</Text>
          {!!instructor.school_phone && (
            <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(telUrl(instructor.school_phone!))} testID="school-phone">
              <Phone size={18} color={theme.colors.primary} />
              <Text style={styles.link}>{instructor.school_phone}</Text>
            </TouchableOpacity>
          )}
          {!!instructor.school_email && (
            <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(`mailto:${instructor.school_email}`)} testID="school-email">
              <Mail size={18} color={theme.colors.primary} />
              <Text style={[styles.link, { flex: 1 }]} numberOfLines={1}>{instructor.school_email}</Text>
            </TouchableOpacity>
          )}
        </Card>
      )}

      <TouchableOpacity style={styles.complaint} onPress={() => Linking.openURL(DVSA_COMPLAINTS_URL)} testID="instructor-complaint">
        <Flag size={16} color={theme.colors.textMuted} />
        <Text style={styles.hint}>Need to make a complaint? See the DVSA&apos;s page.</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: theme.colors.textMuted, fontSize: 12 },
  name: { fontSize: 22, fontWeight: '700', color: theme.colors.text, marginTop: 2 },
  sub: { fontSize: 13, color: theme.colors.textMuted, marginTop: 1 },
  value: { fontSize: 15, color: theme.colors.text },
  plate: { fontSize: 20, fontWeight: '800', color: theme.colors.text, letterSpacing: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  link: { color: theme.colors.primary, fontSize: 14, fontWeight: '600' },
  title: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, backgroundColor: theme.colors.primary, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  lateBtn: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  lateText: { color: theme.colors.primary, fontWeight: '700' },
  adiRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  adiValue: { flex: 1, fontSize: 18, fontWeight: '700', color: theme.colors.primary, letterSpacing: 2 },
  copyBtn: { backgroundColor: theme.colors.primary, paddingHorizontal: 16, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  copyText: { color: '#fff', fontWeight: '700' },
  complaint: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
});
