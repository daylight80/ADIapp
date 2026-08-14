import { Platform, Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabaseClient';
import {
  listLessonsForStudent, listCompetencies, listReflectiveLogs, listBadges,
  listBlockBookings, listTestOutcomesForStudent, listMockTestAttempts,
  listVehicles, listReceipts, listTestOutcomesForInstructor,
} from './supabaseDb';

/**
 * Self-service "download my data" — the app's own Terms & Conditions
 * promise this ("you may request your data... at any time"), so this
 * gathers everything reasonably considered the requesting person's own
 * personal data into one JSON file, using the same tables their own
 * screens already read from (so this is always consistent with what
 * they can already see in the app, never more, never less).
 *
 * Deliberately NOT a full raw database dump — e.g. a student's export
 * doesn't include other students' data, an instructor's export doesn't
 * include Stripe secrets or other instructors' figures.
 */
export async function exportMyDataJson(
  role: 'student' | 'instructor',
  studentId?: string,
  instructorId?: string,
): Promise<{ ok: boolean; fileName: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const authUser = sessionData.session?.user;
  if (!authUser) throw new Error('Not signed in');

  const exportObj: Record<string, any> = {
    exported_at: new Date().toISOString(),
    data_subject: role,
    account_email: authUser.email,
  };

  if (role === 'student') {
    if (!studentId) throw new Error('No student profile linked to this account');
    const { data: profile } = await supabase.from('students').select('*').eq('id', studentId).maybeSingle();
    const [lessons, competencies, reflectiveLogs, badges, blockBookings, testOutcomes, mockAttempts] = await Promise.all([
      listLessonsForStudent(studentId).catch(() => []),
      listCompetencies(studentId).catch(() => []),
      listReflectiveLogs(studentId).catch(() => []),
      listBadges(studentId).catch(() => []),
      listBlockBookings(studentId).catch(() => []),
      listTestOutcomesForStudent(studentId).catch(() => []),
      listMockTestAttempts(studentId).catch(() => []),
    ]);
    exportObj.profile = profile;
    exportObj.lessons = lessons;
    exportObj.competency_progress = competencies;
    exportObj.reflective_logs = reflectiveLogs;
    exportObj.badges = badges;
    exportObj.block_bookings = blockBookings;
    exportObj.dvsa_test_outcomes = testOutcomes;
    exportObj.dl25_mock_test_attempts = mockAttempts;
  } else {
    if (!instructorId) throw new Error('No instructor profile linked to this account');
    const { data: profile } = await supabase.from('instructors').select('*').eq('id', instructorId).maybeSingle();
    const [vehicles, receipts, testOutcomes] = await Promise.all([
      listVehicles().catch(() => []),
      listReceipts().catch(() => []),
      listTestOutcomesForInstructor().catch(() => []),
    ]);
    exportObj.profile = profile;
    exportObj.vehicles = vehicles;
    exportObj.expense_receipts = receipts;
    exportObj.student_test_outcomes_logged = testOutcomes;
  }

  const json = JSON.stringify(exportObj, null, 2);
  const fileName = `drivehub-my-data-${new Date().toISOString().slice(0, 10)}.json`;

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') throw new Error('Web export needs a browser context.');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true, fileName };
  }

  const path = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Export my data' });
  } else {
    Alert.alert('Data saved', `Saved to ${path}`);
  }
  return { ok: true, fileName };
}
