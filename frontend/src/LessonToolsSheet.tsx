import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, ScrollView } from 'react-native';
import {
  X,
  Navigation,
  MessageSquare,
  Check,
  Eye,
  Activity,
  FileCheck,
  Megaphone,
} from 'lucide-react-native';
import { theme } from './theme';
import { Lesson, Student, mockDb } from './mockDb';
import { openNavigation, openSmsComposer } from './tools';
import { fireInstantNotification } from './notifications';
import { Badge } from './ui';

type Props = {
  visible: boolean;
  onClose: () => void;
  lesson: Lesson | null;
  onChanged?: () => void;
};

export function LessonToolsSheet({ visible, onClose, lesson, onChanged }: Props) {
  const [precheck, setPrecheck] = useState<{ eye: boolean; fit: boolean; lic: boolean }>({ eye: false, fit: false, lic: false });
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  if (!lesson) return null;
  const student = mockDb.getStudent(lesson.student_id);
  if (!student) return null;

  const allChecks = precheck.eye && precheck.fit && precheck.lic;

  const onArrived = async () => {
    const body = `Hi ${student.name.split(' ')[0]}, I've arrived for your ${lesson.start_time} lesson. See you in a moment! — Your instructor.`;
    const ok = await openSmsComposer(student.phone, body);
    if (ok) {
      await fireInstantNotification('Arrival message sent', `Notified ${student.name}`);
      onClose();
    }
  };

  const completePrecheck = () => {
    if (!allChecks) {
      Alert.alert('Complete all checks', 'All three pre-lesson checks must be confirmed before the lesson starts.');
      return;
    }
    mockDb.updateLesson(lesson.id, { pre_check_completed_at: new Date().toISOString() });
    Alert.alert('Pre-lesson check complete', 'Logged with timestamp. Drive safe!');
    onChanged?.();
  };

  const cancelLesson = () => {
    Alert.alert('Cancel this lesson?', 'You can broadcast the freed slot to other students.', [
      { text: 'Keep lesson', style: 'cancel' },
      {
        text: 'Cancel & broadcast',
        style: 'destructive',
        onPress: () => {
          mockDb.updateLesson(lesson.id, { status: 'Cancelled' });
          setBroadcastOpen(true);
          onChanged?.();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{student.name}</Text>
              <Text style={styles.sub}>
                {lesson.start_time}-{lesson.end_time} · {lesson.topic}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} testID="lesson-tools-close">
              <X size={22} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 560 }}>
            <View style={styles.badgeRow}>
              <Badge label={lesson.status} />
              <Badge label={`${lesson.duration_hours}h`} />
              {lesson.travel_minutes && <Badge label={`${lesson.travel_minutes}m travel`} bg="#FFF7ED" color={theme.colors.accent} />}
              {lesson.pre_check_completed_at && <Badge label="Pre-check ✓" bg="#D1FAE5" color={theme.colors.success} />}
            </View>

            {/* Navigation */}
            <Text style={styles.section}>Navigate to pickup</Text>
            <Text style={styles.address}>
              {lesson.pickup_address || `${student.address}, ${student.postcode}`}
            </Text>
            <View style={styles.navRow}>
              <NavBtn
                label="Google"
                onPress={() => openNavigation('google', lesson.pickup_address || `${student.address}, ${student.postcode}`)}
                testID="nav-google"
              />
              <NavBtn
                label="Waze"
                onPress={() => openNavigation('waze', lesson.pickup_address || `${student.address}, ${student.postcode}`)}
                testID="nav-waze"
              />
              <NavBtn
                label="Apple"
                onPress={() => openNavigation('apple', lesson.pickup_address || `${student.address}, ${student.postcode}`)}
                testID="nav-apple"
              />
            </View>

            {/* I'm Here */}
            <TouchableOpacity style={styles.imHereBtn} onPress={onArrived} testID="btn-im-here">
              <MessageSquare size={18} color="#fff" />
              <Text style={styles.imHereText}>I've arrived — Text {student.name.split(' ')[0]}</Text>
            </TouchableOpacity>

            {/* Pre-lesson check */}
            <Text style={styles.section}>Pre-lesson check</Text>
            <CheckRow
              icon={<Eye size={18} color={precheck.eye ? '#fff' : theme.colors.text} />}
              label="Eyesight: number plate readable at 20m"
              checked={precheck.eye}
              onToggle={() => setPrecheck((p) => ({ ...p, eye: !p.eye }))}
              testID="precheck-eye"
            />
            <CheckRow
              icon={<Activity size={18} color={precheck.fit ? '#fff' : theme.colors.text} />}
              label="Fit to drive (no alcohol, medication, fatigue)"
              checked={precheck.fit}
              onToggle={() => setPrecheck((p) => ({ ...p, fit: !p.fit }))}
              testID="precheck-fit"
            />
            <CheckRow
              icon={<FileCheck size={18} color={precheck.lic ? '#fff' : theme.colors.text} />}
              label="Valid provisional/full driving licence in hand"
              checked={precheck.lic}
              onToggle={() => setPrecheck((p) => ({ ...p, lic: !p.lic }))}
              testID="precheck-lic"
            />
            <TouchableOpacity
              style={[styles.confirmBtn, !allChecks && styles.btnDisabled]}
              onPress={completePrecheck}
              disabled={!allChecks}
              testID="btn-confirm-precheck"
            >
              <Check size={18} color="#fff" />
              <Text style={styles.confirmText}>Confirm pre-check</Text>
            </TouchableOpacity>

            {/* Cancel + broadcast */}
            <TouchableOpacity style={styles.cancelBtn} onPress={cancelLesson} testID="btn-cancel-lesson">
              <Megaphone size={18} color={theme.colors.danger} />
              <Text style={styles.cancelText}>Cancel lesson & broadcast gap</Text>
            </TouchableOpacity>

            <View style={{ height: 12 }} />
          </ScrollView>
        </View>
      </View>

      <GapBroadcastModal
        visible={broadcastOpen}
        onClose={() => {
          setBroadcastOpen(false);
          onClose();
        }}
        lesson={lesson}
      />
    </Modal>
  );
}

function NavBtn({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity style={styles.navBtn} onPress={onPress} testID={testID}>
      <Navigation size={16} color={theme.colors.primary} />
      <Text style={styles.navBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function CheckRow({ icon, label, checked, onToggle, testID }: any) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onToggle} testID={testID} activeOpacity={0.7}>
      <View style={[styles.checkIcon, checked && styles.checkIconActive]}>{icon}</View>
      <Text style={styles.checkLabel}>{label}</Text>
      {checked && <Check size={18} color={theme.colors.success} />}
    </TouchableOpacity>
  );
}

function GapBroadcastModal({ visible, onClose, lesson }: { visible: boolean; onClose: () => void; lesson: Lesson | null }) {
  const [sent, setSent] = useState(false);
  if (!lesson) return null;
  const students = mockDb.listStudents().filter((s) => s.status !== 'New' && s.id !== lesson.student_id);

  const broadcast = async () => {
    await fireInstantNotification(
      'Slot broadcast sent',
      `${students.length} active students notified about the ${lesson.start_time} gap.`
    );
    setSent(true);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} testID="gap-broadcast-modal">
          <Megaphone size={32} color={theme.colors.accent} />
          <Text style={styles.modalTitle}>Broadcast the gap</Text>
          <Text style={styles.modalSub}>
            Notify {students.length} active students of the freed{' '}
            {new Date(lesson.date).toLocaleDateString('en-GB')} {lesson.start_time}-{lesson.end_time} slot.
          </Text>
          {!sent ? (
            <TouchableOpacity style={styles.modalCta} onPress={broadcast} testID="btn-broadcast">
              <Text style={styles.modalCtaText}>Broadcast to {students.length} students</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.sentRow}>
              <Check size={18} color={theme.colors.success} />
              <Text style={styles.sentText}>Broadcast sent. First to respond wins the slot.</Text>
            </View>
          )}
          <TouchableOpacity onPress={onClose} testID="gap-close">
            <Text style={styles.modalClose}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24, paddingTop: 12 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 4, backgroundColor: theme.colors.border, marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  sub: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  section: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginTop: 8, marginBottom: 8 },
  address: { fontSize: 14, color: theme.colors.text, marginBottom: 10 },
  navRow: { flexDirection: 'row', gap: 8 },
  navBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: theme.colors.primary, borderRadius: 10, paddingVertical: 12 },
  navBtnText: { color: theme.colors.primary, fontWeight: '700', fontSize: 13 },
  imHereBtn: { marginTop: 12, backgroundColor: theme.colors.accent, height: 50, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  imHereText: { color: '#fff', fontWeight: '700' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  checkIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background },
  checkIconActive: { backgroundColor: theme.colors.success },
  checkLabel: { fontSize: 13, color: theme.colors.text, flex: 1 },
  confirmBtn: { marginTop: 10, backgroundColor: theme.colors.primary, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnDisabled: { opacity: 0.4 },
  confirmText: { color: '#fff', fontWeight: '700' },
  cancelBtn: { marginTop: 14, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: theme.colors.danger },
  cancelText: { color: theme.colors.danger, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 400, backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, alignItems: 'center', gap: 10 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.text },
  modalSub: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center' },
  modalCta: { backgroundColor: theme.colors.accent, height: 50, borderRadius: 12, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  modalCtaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#D1FAE5', padding: 12, borderRadius: 10, alignSelf: 'stretch' },
  sentText: { color: theme.colors.success, fontWeight: '600', flex: 1, fontSize: 13 },
  modalClose: { color: theme.colors.textMuted, marginTop: 8, fontWeight: '600' },
});
