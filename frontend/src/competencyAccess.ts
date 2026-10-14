// Who may change a competency level. A competency is the instructor's assessment of a pupil,
// and pupils only have read access to it in the database (dvsa_self_read, no update policy),
// so the edit pencil is for instructors only. Showing it to a pupil let them open the editor
// and then fail with "Cannot coerce the result to a single JSON object" on Save.
export function canEditCompetency(role: string | null | undefined, isLive: boolean): boolean {
  return role === 'instructor' && isLive;
}
