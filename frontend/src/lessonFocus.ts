// Lesson notes carry two things worth carrying forward: what needs more practice, and the goal for the next lesson.
// They are answers to the instructor's own questions (the defaults are "What needs more practice?" and "Goal for
// next lesson"), so they are found by what the question says. Pure logic, tested in lessonFocus.test.ts.
import type { LessonNoteQuestion } from './supabaseDb';

type Q = Pick<LessonNoteQuestion, 'id' | 'question_text'>;
type Answers = Record<string, string | null | undefined>;

/** A question asking for the goal or focus of the next lesson. Checked first, since "goal for next lesson" is a goal. */
export function isGoalQuestion(text: string | null | undefined): boolean {
  return /\bgoals?\b|next (lesson|time)|focus for/i.test(text || '');
}

/** A question asking what needs more practice or work. */
export function isPracticeQuestion(text: string | null | undefined): boolean {
  return !isGoalQuestion(text) && /practi[cs]e|work on|improv|struggl|weak/i.test(text || '');
}

const clean = (v: string | null | undefined) => (v || '').replace(/\s+/g, ' ').trim();

/** The practice and goal answers from one lesson's notes, or null for whichever wasn't answered. */
export function pickFocus(questions: Q[], answers: Answers): { practice: string | null; goal: string | null } {
  const found = (match: (t: string) => boolean) => {
    const parts = questions.filter((q) => match(q.question_text)).map((q) => clean(answers[q.id])).filter(Boolean);
    return parts.length ? parts.join(' ') : null;
  };
  return { practice: found(isPracticeQuestion), goal: found(isGoalQuestion) };
}

/** True when the question's answer will be shown to the pupil (the goal), so the instructor writes it with that in mind. */
export const answerIsSeenByPupil = isGoalQuestion;

/**
 * The saved notes as a starting point for a pupil summary: "What went well this lesson: ...", one line per answered
 * question, in the instructor's question order. Empty when nothing was answered.
 */
export function notesToDictation(questions: Q[], answers: Answers): string {
  return questions
    .map((q) => {
      const a = clean(answers[q.id]);
      return a ? `${q.question_text.replace(/[?:\s]+$/, '')}: ${a}` : '';
    })
    .filter(Boolean)
    .join('\n');
}
