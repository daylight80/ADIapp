import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

// The network and database calls are mocked; the pure helpers are the real ones.
const mockDraft = jest.fn();
const mockApprove = jest.fn();
const mockWithdraw = jest.fn();
const mockSaved = jest.fn();
const mockNotesStart = jest.fn();
jest.mock('../lessonSummary', () => ({
  ...jest.requireActual('../lessonSummary'),
  draftSummary: (...a: unknown[]) => mockDraft(...a),
  approveSummary: (...a: unknown[]) => mockApprove(...a),
  withdrawSummary: (...a: unknown[]) => mockWithdraw(...a),
  fetchSavedSummary: (...a: unknown[]) => mockSaved(...a),
  fetchNotesAsDictation: (...a: unknown[]) => mockNotesStart(...a),
}));
jest.mock('../supabaseClient', () => ({ supabase: {} }));

import { LessonSummarySheet } from '../LessonSummarySheet';
import { PupilSummariesCard } from '../PupilSummariesCard';
import { dictationReady, approvalReady, sentMessage, MIN_DICTATION_CHARS, SUMMARY_NOTE_PUPIL } from '../lessonSummary';

const SPOKEN = 'Good lesson on roundabouts, still hesitant at the exits.';

describe('helpers', () => {
  it('needs a couple of sentences before it will draft', () => {
    expect(dictationReady('too short')).toBe(false);
    expect(dictationReady('x'.repeat(MIN_DICTATION_CHARS))).toBe(true);
    expect(dictationReady('   ' + 'x'.repeat(MIN_DICTATION_CHARS - 1) + '   ')).toBe(false);
    expect(dictationReady('x'.repeat(4001))).toBe(false);
  });
  it('needs a summary to approve, but the plan can be empty', () => {
    expect(approvalReady('', 'plan')).toBe(false);
    expect(approvalReady('  ', '')).toBe(false);
    expect(approvalReady('Nice work', '')).toBe(true);
    expect(approvalReady('a'.repeat(1501), '')).toBe(false);
    expect(approvalReady('ok', 'p'.repeat(1001))).toBe(false);
  });
  it('says how it went out', () => {
    expect(sentMessage('Maisie', { notified: 'push', updated: false })).toMatch(/notified in the app/);
    expect(sentMessage('Maisie', { notified: 'email', updated: false })).toMatch(/by email/);
    expect(sentMessage('Maisie', { notified: null, updated: false })).toMatch(/couldn't notify Maisie/);
    expect(sentMessage('Maisie', { notified: null, updated: true })).toMatch(/^Updated/);
  });
});

describe('the summary sheet', () => {
  beforeEach(() => {
    mockDraft.mockReset().mockResolvedValue({ summary: 'You did well on roundabouts.', next_plan: 'Practise exits.' });
    mockApprove.mockReset().mockResolvedValue({ ok: true, notified: 'push', updated: false });
    mockWithdraw.mockReset().mockResolvedValue({ ok: true });
    mockSaved.mockReset().mockResolvedValue(null);
    mockNotesStart.mockReset().mockResolvedValue('');
  });
  const open = async () => render(<LessonSummarySheet visible onClose={jest.fn()} lessonId="les-1" studentName="Maisie Harmer" />);

  it('tells the instructor to use the keyboard microphone and promises nothing is sent until approved', async () => {
    await open();
    expect(screen.getByTestId('summary-hint')).toHaveTextContent(/microphone on your keyboard/);
    expect(screen.getByText(/Nothing is sent to Maisie until you approve it/)).toBeTruthy();
  });

  it('will not draft until enough has been said, then drafts from the trimmed words and shows the draft to edit', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('input-dictation'), 'short');
    await fireEvent.press(screen.getByTestId('btn-write-summary'));
    expect(mockDraft).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('input-dictation'), `  ${SPOKEN}  `);
    await fireEvent.press(screen.getByTestId('btn-write-summary'));
    await waitFor(() => expect(mockDraft).toHaveBeenCalledWith('les-1', SPOKEN));
    await waitFor(() => expect(screen.getByTestId('input-summary').props.value).toBe('You did well on roundabouts.'));
    expect(screen.getByTestId('input-next-plan').props.value).toBe('Practise exits.');
    expect(mockApprove).not.toHaveBeenCalled(); // nothing is sent by drafting
  });

  it('sends exactly what the instructor edited, then says how it went', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('input-dictation'), SPOKEN);
    await fireEvent.press(screen.getByTestId('btn-write-summary'));
    await waitFor(() => expect(screen.getByTestId('input-summary')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('input-summary'), '  My own wording.  ');
    await fireEvent.changeText(screen.getByTestId('input-next-plan'), 'Parking next.');
    expect(screen.getByTestId('btn-approve-summary')).toHaveTextContent('Approve & send to Maisie');
    await fireEvent.press(screen.getByTestId('btn-approve-summary'));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('les-1', 'My own wording.', 'Parking next.'));
    await waitFor(() => expect(screen.getByTestId('summary-sent')).toHaveTextContent('Sent. Maisie has been notified in the app.'));
  });

  it('will not approve an empty summary', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('input-dictation'), SPOKEN);
    await fireEvent.press(screen.getByTestId('btn-write-summary'));
    await waitFor(() => expect(screen.getByTestId('input-summary')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('input-summary'), '   ');
    await fireEvent.press(screen.getByTestId('btn-approve-summary'));
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('shows the reason when drafting fails and keeps what was dictated', async () => {
    mockDraft.mockRejectedValueOnce(new Error('Lesson summaries are part of the Pro plan.'));
    await open();
    await fireEvent.changeText(screen.getByTestId('input-dictation'), SPOKEN);
    await fireEvent.press(screen.getByTestId('btn-write-summary'));
    await waitFor(() => expect(screen.getByTestId('summary-error')).toHaveTextContent(/Pro plan/));
    expect(screen.getByTestId('input-dictation').props.value).toBe(SPOKEN);
  });

  it('lets the instructor go back and write it again', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('input-dictation'), SPOKEN);
    await fireEvent.press(screen.getByTestId('btn-write-summary'));
    await waitFor(() => expect(screen.getByTestId('btn-redo-dictation')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('btn-redo-dictation'));
    expect(screen.getByTestId('input-dictation').props.value).toBe(SPOKEN);
  });

  it('starts the box from the lesson notes when there are some, and says so', async () => {
    mockNotesStart.mockResolvedValue('What went well this lesson: Smooth steering' + String.fromCharCode(10) + 'Goal for next lesson: Test route');
    await render(<LessonSummarySheet visible onClose={jest.fn()} lessonId="les-1" studentName="Maisie Harmer" instructorId="instr-1" />);
    await waitFor(() => expect(screen.getByTestId('input-dictation').props.value).toMatch(/Smooth steering/));
    expect(mockNotesStart).toHaveBeenCalledWith('les-1', 'instr-1');
    expect(screen.getByTestId('from-notes-hint')).toHaveTextContent(/Started from your lesson notes/);
    // the instructor can add to it, and the draft is made from what is in the box
    await fireEvent.changeText(screen.getByTestId('input-dictation'), 'Smooth steering. Test route next. Also nervous at exits.');
    await fireEvent.press(screen.getByTestId('btn-write-summary'));
    await waitFor(() => expect(mockDraft).toHaveBeenCalledWith('les-1', 'Smooth steering. Test route next. Also nervous at exits.'));
  });

  it('starts blank when there are no notes, and does not look for notes without an instructor id', async () => {
    await render(<LessonSummarySheet visible onClose={jest.fn()} lessonId="les-1" studentName="Maisie Harmer" instructorId="instr-1" />);
    await waitFor(() => expect(mockNotesStart).toHaveBeenCalled());
    expect(screen.getByTestId('input-dictation').props.value).toBe('');
    expect(screen.queryByTestId('from-notes-hint')).toBeNull();
    mockNotesStart.mockClear();
    await render(<LessonSummarySheet visible onClose={jest.fn()} lessonId="les-2" studentName="Pat Jones" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockNotesStart).not.toHaveBeenCalled();
  });

  it('does not overwrite a summary that was already sent with the notes', async () => {
    mockSaved.mockResolvedValue({ summary: 'Already sent text.', next_plan: null, approved_at: 'a', notified_at: 'b' });
    mockNotesStart.mockResolvedValue('Some notes');
    await render(<LessonSummarySheet visible onClose={jest.fn()} lessonId="les-1" studentName="Maisie Harmer" instructorId="instr-1" />);
    await waitFor(() => expect(screen.getByTestId('text-summary')).toHaveTextContent('Already sent text.'));
    expect(mockNotesStart).not.toHaveBeenCalled();
  });

  it('reopens a summary that was already sent as read only: shown, can be removed, cannot be edited or updated', async () => {
    mockSaved.mockResolvedValue({ summary: 'Already sent text.', next_plan: 'Old plan.', approved_at: '2026-10-22T10:00:00Z', notified_at: '2026-10-22T10:00:01Z' });
    await open();
    await waitFor(() => expect(screen.getByTestId('text-summary')).toHaveTextContent('Already sent text.'));
    expect(screen.getByTestId('text-next-plan')).toHaveTextContent('Old plan.');
    expect(screen.queryByTestId('input-summary')).toBeNull();
    expect(screen.queryByTestId('input-next-plan')).toBeNull();
    expect(screen.queryByTestId('btn-approve-summary')).toBeNull();
    expect(screen.getByTestId('btn-remove-summary')).toBeTruthy();
  });

  it('leaves out the plan heading when a sent summary has no plan', async () => {
    mockSaved.mockResolvedValue({ summary: 'Short one.', next_plan: null, approved_at: 'a', notified_at: 'b' });
    await open();
    await waitFor(() => expect(screen.getByTestId('text-summary')).toBeTruthy());
    expect(screen.queryByTestId('text-next-plan')).toBeNull();
  });
});

describe('the pupil card', () => {
  const item = (id: string, summary: string, plan: string | null = null) => ({
    id, lesson_id: `l-${id}`, summary, next_plan: plan, approved_at: '2026-10-22T10:00:00Z',
    lesson_date: '2026-10-22T09:00:00Z', topic: 'Roundabouts', instructor_first_name: 'Jon',
  });

  it('shows nothing until there is an approved summary', async () => {
    await render(<PupilSummariesCard summaries={[]} />);
    expect(screen.queryByTestId('pupil-summaries')).toBeNull();
  });

  it('shows the latest two with the plan for next time, who wrote it, and how it was written', async () => {
    await render(<PupilSummariesCard summaries={[item('a', 'First summary', 'Parking next.'), item('b', 'Second summary'), item('c', 'Third summary')]} />);
    expect(screen.getByText('From your instructor')).toBeTruthy();
    expect(screen.getByTestId('pupil-summary-a')).toHaveTextContent(/First summary/);
    expect(screen.getByTestId('pupil-summary-a')).toHaveTextContent(/Next lesson/);
    expect(screen.getByTestId('pupil-summary-a')).toHaveTextContent(/Jon/);
    expect(screen.getByTestId('pupil-summary-b')).toBeTruthy();
    expect(screen.queryByTestId('pupil-summary-c')).toBeNull();
    expect(screen.getByText(SUMMARY_NOTE_PUPIL)).toBeTruthy();
  });
});
