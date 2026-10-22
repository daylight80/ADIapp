import { isGoalQuestion, isPracticeQuestion, pickFocus, notesToDictation, answerIsSeenByPupil } from '../lessonFocus';

const Q = [
  { id: 'q1', question_text: 'What went well this lesson?' },
  { id: 'q2', question_text: 'What needs more practice?' },
  { id: 'q3', question_text: 'Goal for next lesson' },
];

describe('recognising the questions', () => {
  it('knows the default practice and goal questions, and keeps them apart', () => {
    expect(isPracticeQuestion('What needs more practice?')).toBe(true);
    expect(isGoalQuestion('What needs more practice?')).toBe(false);
    expect(isGoalQuestion('Goal for next lesson')).toBe(true);
    expect(isPracticeQuestion('Goal for next lesson')).toBe(false);
    expect(isPracticeQuestion('What went well this lesson?')).toBe(false);
    expect(isGoalQuestion('What went well this lesson?')).toBe(false);
  });
  it('copes with an instructor’s own wording', () => {
    expect(isGoalQuestion('Focus for next time')).toBe(true);
    expect(isGoalQuestion('Next time we should')).toBe(true);
    expect(isPracticeQuestion('What should they work on?')).toBe(true);
    expect(isPracticeQuestion('Where are they struggling?')).toBe(true);
    expect(isPracticeQuestion(null)).toBe(false);
  });
  it('says only the goal is shown to the pupil', () => {
    expect(answerIsSeenByPupil('Goal for next lesson')).toBe(true);
    expect(answerIsSeenByPupil('What needs more practice?')).toBe(false);
  });
});

describe('pickFocus', () => {
  it('takes the practice and goal answers, tidied', () => {
    expect(pickFocus(Q, { q1: 'Great', q2: '  Parallel   parking\n', q3: 'Test route' })).toEqual({ practice: 'Parallel parking', goal: 'Test route' });
  });
  it('gives null for whichever was left blank or has no question', () => {
    expect(pickFocus(Q, { q2: '  ', q3: 'Test route' })).toEqual({ practice: null, goal: 'Test route' });
    expect(pickFocus([Q[0]], { q1: 'Great' })).toEqual({ practice: null, goal: null });
    expect(pickFocus(Q, {})).toEqual({ practice: null, goal: null });
  });
});

describe('notesToDictation', () => {
  it('turns answered questions into lines in question order, skipping blanks', () => {
    expect(notesToDictation(Q, { q1: 'Smooth steering', q2: '', q3: 'Test route' })).toBe('What went well this lesson: Smooth steering\nGoal for next lesson: Test route');
  });
  it('is empty when nothing was answered', () => {
    expect(notesToDictation(Q, {})).toBe('');
    expect(notesToDictation([], { q1: 'x' })).toBe('');
  });
});
