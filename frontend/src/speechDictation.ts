// Dictation in the web app. A desktop browser has no phone keyboard with a microphone key, so the summary sheet gets
// a Dictate button that uses the browser's own speech recognition (Chrome, Edge and Safari have it; Firefox does not).
// The words come back as text; the browser (not us) handles the audio. On a phone the keyboard's microphone key is
// used instead, so this stays off there.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

type RecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null;
};
type RecognitionCtor = new () => RecognitionLike;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (Platform.OS !== 'web') return null;
  const w: any = typeof window !== 'undefined' ? window : undefined;
  return (w && (w.SpeechRecognition || w.webkitSpeechRecognition)) || null;
}

/** The text so far: what was already in the box, then the confirmed words, then the words still being worked out. */
export function mergeTranscript(base: string, finalText: string, interim: string): string {
  const spoken = `${finalText}${interim}`.replace(/\s+/g, ' ').trim();
  if (!spoken) return base;
  const head = base.replace(/\s+$/, '');
  return head ? `${head} ${spoken}` : spoken;
}

/** A plain-English reason for a speech recognition error code. */
export function speechErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return "The microphone is blocked. Allow it with the icon in your browser's address bar, then try again.";
    case 'audio-capture':
      return "No microphone was found. Check one is plugged in and not in use by another program.";
    case 'no-speech':
      return "Didn't catch anything. Click Dictate and try again, speaking a little closer to the microphone.";
    case 'network':
      return "Couldn't reach the browser's speech service. Check your connection, or type it instead.";
    case 'aborted':
      return '';
    default:
      return "Dictation stopped unexpectedly. You can try again, or type it instead.";
  }
}

/**
 * A Dictate button's logic. `start(base)` begins listening and calls `onText` with the box's new contents as words
 * arrive (the base text plus what was said). `stop()` ends it. `supported` is false on phones and in browsers
 * without speech recognition.
 */
export function useSpeechDictation(onText: (text: string) => void) {
  const Ctor = getRecognitionCtor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* already stopped */ } }, []);

  const start = useCallback((base: string) => {
    if (!Ctor) return;
    setError(null);
    let rec: RecognitionLike;
    try { rec = new Ctor(); } catch { setError(speechErrorMessage(undefined)); return; }
    rec.lang = 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    let finals = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        const t: string = r[0]?.transcript ?? '';
        if (r.isFinal) finals += `${t} `; else interim += t;
      }
      onTextRef.current(mergeTranscript(base, finals, interim));
    };
    rec.onerror = (e: any) => { const m = speechErrorMessage(e?.error); if (m) setError(m); };
    rec.onend = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setError(speechErrorMessage(undefined)); recRef.current = null; }
  }, [Ctor]);

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch { /* already stopped */ } }, []);

  return { supported: !!Ctor, listening, error, start, stop };
}
