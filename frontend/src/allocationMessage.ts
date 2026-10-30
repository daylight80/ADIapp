/** What an owner can send themselves, by text or WhatsApp, when pupils are moved to an instructor. */
export function allocationMessage(instructorName: string, pupils: string[], ownerName?: string | null): string {
  const first = (instructorName || '').trim().split(' ')[0] || 'there';
  const who = pupils.length === 1 ? pupils[0] : `${pupils.length} pupils (${pupils.join(', ')})`;
  const sign = ownerName?.trim() ? ` Thanks, ${ownerName.trim().split(' ')[0]}` : '';
  return `Hi ${first}, I've allocated ${who} to you. Please contact them to arrange the first lesson. Their details are on their profile in the DualControl app.${sign}`;
}
