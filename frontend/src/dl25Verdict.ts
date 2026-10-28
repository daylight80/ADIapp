const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The sentence under PASS or FAIL on the report. An instructor running a mock test is told what a real test would do. */
export function verdictSub(p: { passed: boolean; driving: number; serious: number; dangerous: number; instructor: boolean }): string {
  if (!p.instructor) {
    return p.passed
      ? 'Well done! You have met DVSA test standards.'
      : 'Not quite there yet. Review the faults below and keep practising.';
  }
  if (p.passed) return 'Would pass a real test: 15 or fewer driving faults, and no serious or dangerous faults.';
  const why: string[] = [];
  if (p.dangerous > 0) why.push(plural(p.dangerous, 'dangerous fault'));
  if (p.serious > 0) why.push(plural(p.serious, 'serious fault'));
  if (p.driving > 15) why.push(`${p.driving} driving faults (15 allowed)`);
  return `Would not pass a real test: ${why.join(', ')}.`;
}
