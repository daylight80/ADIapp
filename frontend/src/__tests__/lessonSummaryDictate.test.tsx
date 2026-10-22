import React from 'react';
import { Platform } from 'react-native';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
const mockDraft = jest.fn();
jest.mock('../lessonSummary', () => ({
  ...jest.requireActual('../lessonSummary'),
  draftSummary: (...a: unknown[]) => mockDraft(...a),
  approveSummary: jest.fn(),
  withdrawSummary: jest.fn(),
  fetchSavedSummary: jest.fn().mockResolvedValue(null),
}));
jest.mock('../supabaseClient', () => ({ supabase: {} }));

import { LessonSummarySheet } from '../LessonSummarySheet';

describe('the Dictate button in the summary sheet', () => {
  const originalOS = Platform.OS;
  let instances: any[];
  class FakeRecognition {
    onresult: any = null; onerror: any = null; onend: any = null; started = false; stopped = false;
    lang = ''; continuous = false; interimResults = false;
    constructor() { instances.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.stopped = true; }
  }
  const said = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal });
  const open = async () => render(<LessonSummarySheet visible onClose={jest.fn()} lessonId="les-1" studentName="Test Pupil" />);

  beforeEach(() => {
    instances = [];
    mockDraft.mockReset().mockResolvedValue({ summary: 'S', next_plan: 'P' });
  });
  afterEach(() => {
    (Platform as any).OS = originalOS;
    delete (global as any).window?.SpeechRecognition;
  });

  const onWeb = () => {
    (Platform as any).OS = 'web';
    (global as any).window = Object.assign((global as any).window || {}, { SpeechRecognition: FakeRecognition });
  };

  it('is offered on the web, with wording that mentions it and how the audio is handled', async () => {
    onWeb();
    await open();
    expect(screen.getByTestId('btn-dictate')).toBeTruthy();
    expect(screen.getByTestId('summary-hint')).toHaveTextContent(/Click Dictate/);
    expect(screen.getByTestId('dictation-privacy')).toHaveTextContent(/handled by your browser/);
  });

  it('is not offered on a phone, which uses the keyboard microphone instead', async () => {
    await open();
    expect(screen.queryByTestId('btn-dictate')).toBeNull();
    expect(screen.getByTestId('summary-hint')).toHaveTextContent(/microphone on your keyboard/);
  });

  it('puts the spoken words into the box, keeps what was typed, and then drafts from the lot', async () => {
    onWeb();
    await open();
    await fireEvent.changeText(screen.getByTestId('input-dictation'), 'Typed first.');
    await fireEvent.press(screen.getByTestId('btn-dictate'));
    expect(instances[0].started).toBe(true);
    expect(screen.getByTestId('btn-dictate')).toHaveTextContent(/Listening/);

    await act(async () => { instances[0].onresult({ resultIndex: 0, results: [said('Roundabouts went well', true), said(' and exits improved', false)] }); });
    expect(screen.getByTestId('input-dictation').props.value).toBe('Typed first. Roundabouts went well and exits improved');

    await fireEvent.press(screen.getByTestId('btn-write-summary'));
    await waitFor(() => expect(mockDraft).toHaveBeenCalledWith('les-1', 'Typed first. Roundabouts went well and exits improved'));
    expect(instances[0].stopped).toBe(true); // the microphone is switched off when drafting
  });

  it('shows the reason when the microphone is blocked', async () => {
    onWeb();
    await open();
    await fireEvent.press(screen.getByTestId('btn-dictate'));
    await act(async () => { instances[0].onerror({ error: 'not-allowed' }); });
    expect(screen.getByTestId('dictation-error')).toHaveTextContent(/blocked/);
  });

  it('explains why Write summary is greyed out, and counts what has been written so far', async () => {
    await open();
    expect(screen.getByTestId('need-more')).toHaveTextContent(/Type or dictate a couple of sentences/);
    await fireEvent.changeText(screen.getByTestId('input-dictation'), 'too short');
    expect(screen.getByTestId('need-more')).toHaveTextContent(/at least 15 characters \(9 so far\)/);
    await fireEvent.changeText(screen.getByTestId('input-dictation'), 'Now this is long enough to go on.');
    expect(screen.queryByTestId('need-more')).toBeNull();
  });
});
