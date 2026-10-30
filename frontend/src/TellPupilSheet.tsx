import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { callBackend } from './backendCall';
import { openSmsComposer, openWhatsApp } from './tools';
import { moveMessage } from './moveMessage';
import { theme } from './theme';

type Props = {
  /** The move just saved, or null when there is nothing to tell. */
  moved: { lessonId: string; date: string; startTime: string; count: number; queued: boolean } | null;
  pupilName: string;
  pupilPhone?: string;
  onDone: () => void;
};

/** After a lesson moves: push to the pupil's app, or a text or WhatsApp already written. All skippable. */
export function TellPupilSheet({ moved, pupilName, pupilPhone, onDone }: Props) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushed, setPushed] = useState(false);
  const first = (pupilName || '').trim().split(' ')[0] || 'them';
  const close = () => { setNote(''); setPushed(false); onDone(); };

  const push = async () => {
    if (!moved) return;
    setBusy(true);
    try {
      const r = await callBackend<{ notified: boolean }>(`/v2/lessons/${moved.lessonId}/moved-push`, 'POST');
      setPushed(r.notified);
      setNote(r.notified ? `${first} has been sent a notification.` : `${first} has not got the app set up on a phone yet. Send a text or WhatsApp instead.`);
    } catch (e: any) {
      setNote(`Could not send the notification: ${e?.message || 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const message = moved ? moveMessage(pupilName, moved) : '';
  return (
    <BottomSheet visible={!!moved} onClose={close} title={`Tell ${first}?`} testID="sheet-tell-pupil">
      {moved && (
        <View style={{ gap: 12 }}>
          <Text style={s.text} testID="tell-saved">
            {moved.queued ? 'Saved on this device. It will sync when you are back online.' : 'The lesson has been moved.'}
          </Text>
          {moved.queued ? (
            <Text style={s.sub} testID="tell-queued">Tell {first} once it has synced, so the app shows the new time.</Text>
          ) : (
            <TouchableOpacity style={s.btn} onPress={push} disabled={busy || pushed} testID="tell-push">
              <Text style={s.btnText}>{pushed ? 'Notification sent' : busy ? 'Sending…' : `Send ${first} a notification`}</Text>
            </TouchableOpacity>
          )}
          {!!note && <Text style={s.sub} testID="tell-note">{note}</Text>}
          {pupilPhone ? (
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <TouchableOpacity style={s.btn} onPress={() => openSmsComposer(pupilPhone, message)} testID="tell-sms">
                <Text style={s.btnText}>Text {first}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btn} onPress={() => openWhatsApp(pupilPhone, message)} testID="tell-whatsapp">
                <Text style={s.btnText}>WhatsApp {first}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={s.sub} testID="tell-no-phone">No mobile number is saved for {first}, so there is nothing to text.</Text>
          )}
          <TouchableOpacity style={s.skip} onPress={close} testID="tell-done">
            <Text style={s.skipText}>{pushed ? 'Done' : 'Skip'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  text: { fontSize: 15, color: theme.colors.text },
  sub: { fontSize: 13, color: theme.colors.textMuted },
  btn: { flex: 1, backgroundColor: theme.colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  skip: { paddingVertical: 12, alignItems: 'center' },
  skipText: { color: theme.colors.textMuted, fontWeight: '600', fontSize: 14 },
});
