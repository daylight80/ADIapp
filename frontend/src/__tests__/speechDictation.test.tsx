import { Platform } from 'react-native';
import { renderHook, act } from '@testing-library/react-native';
import { mergeTranscript, speechErrorMessage, getRecognitionCtor, useSpeechDictation } from '../speechDictation';

describe('mergeTranscript', () => {
  it('adds what was said after what was already in the box', () => {
    expect(mergeTranscript('Good lesson.', 'Roundabouts went well. ', 'but still hesitant')).toBe('Good lesson. Roundabouts went well. but still hesitant');
    expect(mergeTranscript('', 'Hello there ', '')).toBe('Hello there');
    expect(mergeTranscript('Typed first   ', ' spoken', '')).toBe('Typed first spoken');
  });
  it('leaves the box alone when nothing was said', () => {
    expect(mergeTranscript('keep me', '', '')).toBe('keep me');
    expect(mergeTranscript('keep me', ' ', ' ')).toBe('keep me');
  });
});

describe('speechErrorMessage', () => {
  it('explains the common failures in plain words', () => {
    expect(speechErrorMessage('not-allowed')).toMatch(/blocked.*address bar/);
    expect(speechErrorMessage('audio-capture')).toMatch(/No microphone/);
    expect(speechErrorMessage('no-speech')).toMatch(/Didn't catch/);
    expect(speechErrorMessage('network')).toMatch(/speech service/);
    expect(speechErrorMessage('something-new')).toMatch(/stopped unexpectedly/);
  });
  it('says nothing when the user simply stopped it', () => {
    expect(speechErrorMessage('aborted')).toBe('');
  });
});

describe('the dictation hook', () => {
  const originalOS = Platform.OS;
  let instances: any[];
  class FakeRecognition {
    lang = ''; continuous = false; interimResults = false;
    onresult: any = null; onerror: any = null; onend: any = null;
    started = false; stopped = false; aborted = false;
    constructor() { instances.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.aborted = true; }
  }
  const result = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal });

  beforeEach(() => {
    instances = [];
    (Platform as any).OS = 'web';
    (global as any).window = Object.assign((global as any).window || {}, { SpeechRecognition: FakeRecognition });
  });
  afterEach(() => {
    (Platform as any).OS = originalOS;
    delete (global as any).window.SpeechRecognition;
    delete (global as any).window.webkitSpeechRecognition;
  });

  it('is off on a phone and in a browser without speech recognition', () => {
    (Platform as any).OS = 'android';
    expect(getRecognitionCtor()).toBeNull();
    (Platform as any).OS = 'web';
    delete (global as any).window.SpeechRecognition;
    expect(getRecognitionCtor()).toBeNull();
    (global as any).window.webkitSpeechRecognition = FakeRecognition;
    expect(getRecognitionCtor()).toBe(FakeRecognition);
  });

  it('listens in British English and feeds words into the box as they arrive', async () => {
    const seen: string[] = [];
    const { result: hook } = await renderHook(() => useSpeechDictation((t) => seen.push(t)));
    expect(hook.current.supported).toBe(true);
    await act(async () => { hook.current.start('Typed already.'); });
    const rec = instances[0];
    expect(rec.started && rec.lang === 'en-GB' && rec.continuous && rec.interimResults).toBe(true);
    expect(hook.current.listening).toBe(true);

    await act(async () => { rec.onresult({ resultIndex: 0, results: [result('Went well', false)] }); });
    await act(async () => { rec.onresult({ resultIndex: 0, results: [result('Went well on roundabouts', true), result(' but nervous', false)] }); });
    expect(seen).toEqual(['Typed already. Went well', 'Typed already. Went well on roundabouts but nervous']);
  });

  it('stops listening when told to, and when the browser ends it', async () => {
    const { result: hook } = await renderHook(() => useSpeechDictation(() => {}));
    await act(async () => { hook.current.start(''); });
    await act(async () => { hook.current.stop(); });
    expect(instances[0].stopped).toBe(true);
    expect(hook.current.listening).toBe(false);
  });

  it('shows why it failed, and clears the message on the next try', async () => {
    const { result: hook } = await renderHook(() => useSpeechDictation(() => {}));
    await act(async () => { hook.current.start(''); });
    await act(async () => { instances[0].onerror({ error: 'not-allowed' }); });
    expect(hook.current.error).toMatch(/blocked/);
    await act(async () => { hook.current.start(''); });
    expect(hook.current.error).toBeNull();
  });
});
