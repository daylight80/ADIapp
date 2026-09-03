import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri, useAuthRequest, ResponseType } from 'expo-auth-session';
import { ArrowLeft, CloudUpload, CheckCircle2 } from 'lucide-react-native';
import { theme } from '../src/theme';
import { Card } from '../src/ui';
import { supabase } from '../src/supabaseClient';

WebBrowser.maybeCompleteAuthSession();

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Google Drive full-business backup (2 Sept 2026), per Grant's three
// direct choices: full school scope (built server-side — see
// v2_school_backup in server.py), full Google sign-in + direct upload
// (no manual "save to Drive" step via the share sheet), export-only for
// now — restore is a deliberately separate, later decision given the
// real data-integrity risk of merging/overwriting existing data.
//
// SETUP REQUIRED BEFORE THIS CAN WORK — none of this is something Claude
// can do on Grant's behalf, since it needs his own Google account:
//   1. Create a project at console.cloud.google.com (or reuse one)
//   2. Enable the "Google Drive API" for that project
//   3. Configure the OAuth consent screen (External, app name, support
//      email — Testing mode is fine while this is only used by Grant)
//   4. Credentials -> Create Credentials -> OAuth client ID -> Android
//      (and/or iOS) -> package name uk.co.drivingschoolsolutions.adipro
//      -> for Android, also needs the SHA-1 fingerprint from the EAS
//      build credentials (eas credentials)
//   5. Set the resulting client ID as EXPO_PUBLIC_GOOGLE_CLIENT_ID in
//      eas.json's env blocks (same place SUPABASE_URL etc. already live)
//   6. Run `npx expo install expo-auth-session expo-crypto` from
//      frontend/, then a new EAS build — these are new native modules,
//      not yet part of the current dev-client build
//
// The drive.file scope (not full Drive access) means Google only grants
// this app access to files it creates itself, never the rest of the
// user's Drive — deliberately the least-privileged scope that still
// does the job, and easier to get through Google's own consent-screen
// review than a broader scope would be.
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

export default function BackupScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);

  const [request, , promptAsync] = useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      redirectUri: makeRedirectUri({ scheme: 'adipro' }),
      responseType: ResponseType.Token,
    },
    discovery,
  );

  const handleBackup = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not available on web yet', 'Google Drive backup currently only works on the mobile app.');
      return;
    }
    if (!GOOGLE_CLIENT_ID) {
      Alert.alert('Not set up yet', 'Google Drive backup needs a one-time setup step first — see the notes on this screen for what\u2019s needed.');
      return;
    }
    setBusy(true);
    try {
      const authResult = await promptAsync();
      if (authResult.type !== 'success' || !authResult.authentication?.accessToken) {
        if (authResult.type !== 'cancel' && authResult.type !== 'dismiss') {
          Alert.alert('Google sign-in failed', 'Please try again.');
        }
        return;
      }
      const accessToken = authResult.authentication.accessToken;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const resp = await fetch(`${BACKEND}/api/v2/school/backup`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const backupJson = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((backupJson as any)?.detail || `Could not gather backup data (HTTP ${resp.status})`);

      const fileName = `adi-pro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const boundary = 'adiProBackupBoundary';
      const metadata = { name: fileName, mimeType: 'application/json' };
      const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        `${JSON.stringify(backupJson)}\r\n` +
        `--${boundary}--`;

      const uploadResp = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      if (!uploadResp.ok) {
        const errText = await uploadResp.text().catch(() => '');
        throw new Error(`Google Drive upload failed (HTTP ${uploadResp.status}): ${errText.slice(0, 200)}`);
      }

      setLastBackupAt(new Date().toLocaleString('en-GB'));
      Alert.alert('Backup complete', `Saved to your Google Drive as ${fileName}.`);
    } catch (e: any) {
      Alert.alert('Backup failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="btn-back">
          <ArrowLeft size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Google Drive backup</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.body}>
        <Card style={{ gap: 8 }}>
          <Text style={styles.cardTitle}>Full school backup</Text>
          <Text style={styles.hint}>
            Every instructor, student, lesson, receipt, vehicle and block booking at your school, saved as one file
            to your own Google Drive. Export only, for now — nothing here changes any data in the app.
          </Text>
        </Card>

        <TouchableOpacity
          style={[styles.backupBtn, busy && { opacity: 0.6 }]}
          onPress={handleBackup}
          disabled={busy || !request}
          testID="btn-backup-drive"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <CloudUpload size={18} color="#fff" />
              <Text style={styles.backupBtnText}>Back up to Google Drive</Text>
            </>
          )}
        </TouchableOpacity>

        {lastBackupAt && (
          <View style={styles.lastRow}>
            <CheckCircle2 size={15} color={theme.colors.primary} />
            <Text style={styles.lastText}>Last backup: {lastBackupAt}</Text>
          </View>
        )}

        {!GOOGLE_CLIENT_ID && (
          <Text style={styles.setupHint}>
            Not set up yet — this needs a one-time Google Cloud Console step before it can work. See the code
            comments on this screen for exactly what's needed.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  body: { padding: 16, gap: 14 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  hint: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 19 },
  backupBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: 13, backgroundColor: theme.colors.primary,
  },
  backupBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  lastText: { fontSize: 12.5, color: theme.colors.textMuted },
  setupHint: { fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 17 },
});
