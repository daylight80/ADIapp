import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, Platform } from 'react-native';
import { Mic, Square } from 'lucide-react-native';
import { BottomSheet } from './BottomSheet';
import { useSpeechDictation } from './speechDictation';
import { theme } from './theme';
import {
  DICTATION_HINT, WEB_DICTATION_HINT, MIN_DICTATION_CHARS, MAX_DICTATION_CHARS, MAX_SUMMARY_CHARS, MAX_PLAN_CHARS,
  dictationReady, approvalReady, sentMessage,
  draftSummary, approveSummary, withdrawSummary, fetchSavedSummary,
} from './lessonSummary';

type Stage = 'dictate' | 'review' | 'sent';

/**
 * "Write a summary for the pupil": dictate (with the phone keyboard's microphone), review and edit the draft,
 * approve. Nothing reaches the pupil until the instructor approves it. A summary already sent can be reopened,
 * edited and updated, or removed.
 */
export function LessonSummarySheet({
  visible, onClose, lessonId, studentName,
}: { visible: boolean; onClose: () => void; lessonId: string; studentName: string }) {
  const first = (studentName || 'the pupil').split(' ')[0];
  const [stage, setStage] = useState<Stage>('dictate');
  const [dictation, setDictation] = useState('');
  const [summary, setSummary] = useState('');
  const [plan, setPlan] = useState('');
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentText, setSentText] = useState('');
  // On the web there is no phone keyboard microphone, so a Dictate button uses the browser's speech recognition.
  const speech = useSpeechDictation((text) => { setDictation(text.slice(0, MAX_DICTATION_CHARS)); setError(null); });

  // Each time the sheet opens: start fresh, or open the summary that was already sent for this lesson.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setStage('dictate'); setDictation(''); setSummary(''); setPlan(''); setError(null); setSentText(''); setExisting(false);
    fetchSavedSummary(lessonId)
      .then((s) => {
        if (!alive || !s) return;
        setSummary(s.summary); setPlan(s.next_plan || ''); setExisting(true); setStage('review');
      })
      .catch(() => { /* no saved summary, or it could not be read: start with a blank one */ });
    return () => { alive = false; };
  }, [visible, lessonId]);

  // Stop listening when the sheet closes or moves on, so the microphone is never left on.
  useEffect(() => { if (!visible || stage !== 'dictate') speech.stop(); }, [visible, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const makeDraft = async () => {
    speech.stop();
    setBusy(true); setError(null);
    try {
      const d = await draftSummary(lessonId, dictation.trim());
      setSummary(d.summary); setPlan(d.next_plan || ''); setStage('review');
    } catch (e: any) {
      setError(e?.message || 'Could not write the summary. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await approveSummary(lessonId, summary.trim(), plan);
      setSentText(sentMessage(first, r));
      setStage('sent');
    } catch (e: any) {
      setError(e?.message || 'Could not send it. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    const doIt = async () => {
      setBusy(true); setError(null);
      try { await withdrawSummary(lessonId); onClose(); }
      catch (e: any) { setError(e?.message || 'Could not remove it. Please try again.'); }
      finally { setBusy(false); }
    };
    if (Platform.OS === 'web') { if (typeof window !== 'undefined' && window.confirm(`Remove this summary? ${first} will no longer see it.`)) doIt(); return; }
    Alert.alert('Remove this summary?', `${first} will no longer see it.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: doIt },
    ]);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Summary for ${first}`} testID="sheet-lesson-summary">
      {stage === 'dictate' && (
        <>
          <Text style={s.hint} testID="summary-hint">{speech.supported ? WEB_DICTATION_HINT : DICTATION_HINT}</Text>
          {speech.supported && (
            <TouchableOpacity
              style={[s.micBtn, speech.listening && s.micBtnOn]}
              onPress={() => (speech.listening ? speech.stop() : speech.start(dictation))}
              testID="btn-dictate"
              accessibilityLabel={speech.listening ? 'Stop dictating' : 'Dictate with your microphone'}
            >
              {speech.listening ? <Square size={16} color="#fff" /> : <Mic size={18} color={theme.colors.primary} />}
              <Text style={[s.micText, speech.listening && { color: '#fff' }]}>{speech.listening ? 'Listening… click to stop' : 'Dictate'}</Text>
            </TouchableOpacity>
          )}
          {!!speech.error && <Text style={s.error} testID="dictation-error">{speech.error}</Text>}
          <TextInput
            style={s.dictation}
            value={dictation}
            onChangeText={(t) => { setDictation(t); setError(null); }}
            multiline
            maxLength={MAX_DICTATION_CHARS}
            placeholder="How did the lesson go?"
            placeholderTextColor={theme.colors.textMuted}
            testID="input-dictation"
          />
          <Text style={s.count}>{dictation.trim().length}/{MAX_DICTATION_CHARS}</Text>
          {speech.supported && <Text style={s.privacy} testID="dictation-privacy">Dictation is handled by your browser (Chrome and Edge send the audio to Google or Microsoft to turn it into text). We only receive the text.</Text>}
          <Text style={s.privacy}>Only what you write here, {first}&apos;s first name and the lesson topic are used to write the draft. Nothing is sent to {first} until you approve it.</Text>
          {!!error && <Text style={s.error} testID="summary-error">{error}</Text>}
          <TouchableOpacity style={[s.primary, (!dictationReady(dictation) || busy) && s.disabled]} onPress={makeDraft} disabled={!dictationReady(dictation) || busy} testID="btn-write-summary">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>Write summary</Text>}
          </TouchableOpacity>
          {!dictationReady(dictation) && !busy && (
            <Text style={s.needMore} testID="need-more">
              {dictation.trim().length === 0
                ? `Type or dictate a couple of sentences about the lesson to continue.`
                : `A little more please: at least ${MIN_DICTATION_CHARS} characters (${dictation.trim().length} so far).`}
            </Text>
          )}
        </>
      )}

      {stage === 'review' && (
        <>
          <Text style={s.hint}>{existing ? `Already sent to ${first}. Edit it and update, or remove it.` : `Check it and change anything you like. ${first} sees it only when you send it.`}</Text>
          <Text style={s.label}>Summary</Text>
          <TextInput style={s.field} value={summary} onChangeText={(t) => { setSummary(t); setError(null); }} multiline maxLength={MAX_SUMMARY_CHARS} testID="input-summary" />
          <Text style={s.label}>Suggested plan for next lesson</Text>
          <TextInput style={s.field} value={plan} onChangeText={(t) => { setPlan(t); setError(null); }} multiline maxLength={MAX_PLAN_CHARS} placeholder="Optional" placeholderTextColor={theme.colors.textMuted} testID="input-next-plan" />
          {!!error && <Text style={s.error} testID="summary-error">{error}</Text>}
          <TouchableOpacity style={[s.primary, (!approvalReady(summary, plan) || busy) && s.disabled]} onPress={send} disabled={!approvalReady(summary, plan) || busy} testID="btn-approve-summary">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{existing ? `Update ${first}'s summary` : `Approve & send to ${first}`}</Text>}
          </TouchableOpacity>
          <View style={s.row}>
            {!existing && (
              <TouchableOpacity onPress={() => { setStage('dictate'); setError(null); }} disabled={busy} testID="btn-redo-dictation">
                <Text style={s.link}>Write it again</Text>
              </TouchableOpacity>
            )}
            {existing && (
              <TouchableOpacity onPress={remove} disabled={busy} testID="btn-remove-summary">
                <Text style={[s.link, { color: theme.colors.danger }]}>Remove summary</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      {stage === 'sent' && (
        <>
          <Text style={s.sent} testID="summary-sent">{sentText}</Text>
          <TouchableOpacity style={s.primary} onPress={onClose} testID="btn-summary-done">
            <Text style={s.primaryText}>Done</Text>
          </TouchableOpacity>
        </>
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  micBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: theme.colors.primary, marginBottom: 10, backgroundColor: theme.colors.background },
  micBtnOn: { backgroundColor: theme.colors.danger, borderColor: theme.colors.danger },
  micText: { fontSize: 14.5, fontWeight: '700', color: theme.colors.primary },
  needMore: { fontSize: 12.5, color: theme.colors.textMuted, textAlign: 'center', marginTop: 8 },
  hint: { fontSize: 13.5, lineHeight: 19, color: theme.colors.textMuted, marginBottom: 10 },
  privacy: { fontSize: 12, lineHeight: 17, color: theme.colors.textMuted, marginTop: 6 },
  label: { fontSize: 12.5, fontWeight: '700', color: theme.colors.text, marginTop: 10, marginBottom: 6 },
  dictation: { minHeight: 140, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 12, fontSize: 15, color: theme.colors.text, backgroundColor: theme.colors.background, textAlignVertical: 'top' },
  field: { minHeight: 90, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 12, fontSize: 15, color: theme.colors.text, backgroundColor: theme.colors.background, textAlignVertical: 'top' },
  count: { fontSize: 11.5, color: theme.colors.textMuted, alignSelf: 'flex-end', marginTop: 4 },
  error: { fontSize: 13, color: theme.colors.danger, marginTop: 10, lineHeight: 18 },
  primary: { marginTop: 16, height: 50, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 14, marginBottom: 6 },
  link: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },
  sent: { fontSize: 16, lineHeight: 23, color: theme.colors.text, marginTop: 8 },
});
