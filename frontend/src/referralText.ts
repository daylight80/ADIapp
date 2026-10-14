// The wording on the referral banner. The yearly limit comes from the backend
// (REFERRAL_MAX_REWARDS_PER_YEAR in server.py); 2 is only what's shown before it has loaded.
export type ReferralStage = 'signed_up' | 'subscribed' | 'rewarded' | 'capped';
export type ReferralListItem = { name: string; stage: ReferralStage; date?: string | null };
export type ReferralSummary = {
  pending: number;
  rewarded_this_year: number;
  capped: number;
  cap_per_year: number;
  referrals?: ReferralListItem[];
};
export type ReferralStatus = { eligible: boolean; eligible_from?: string | null };

const DEFAULT_CAP = 2;

export function referralSubtitle(summary: ReferralSummary | null | undefined): string {
  const cap = summary?.cap_per_year ?? DEFAULT_CAP;
  if (summary && summary.rewarded_this_year >= cap) {
    return `You've earned all ${cap} free months for this year. Anyone who subscribes while you're at the limit won't earn you another.`;
  }
  if (summary && (summary.pending > 0 || summary.rewarded_this_year > 0)) {
    return `${summary.pending} pending · ${summary.rewarded_this_year} of ${cap} free months earned this year`;
  }
  return `Share your code — your free month comes once they've been subscribed for a month (up to ${cap} a year).`;
}

const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** One line of "who you've referred": what stage they're at, with the date that stage refers to. */
export function referralItemLabel(item: ReferralListItem): string {
  const when = formatDate(item.date);
  switch (item.stage) {
    case 'rewarded': return when ? `Free month earned ${when}` : 'Free month earned';
    case 'capped': return 'No free month: you were at your yearly limit';
    case 'subscribed': return when ? `Subscribed · your free month is released on ${when}` : 'Subscribed · your free month follows';
    default: return when ? `Signed up ${when} · not subscribed yet` : 'Signed up · not subscribed yet';
  }
}

/** Shown instead of the banner while referring is still locked (never as the banner itself). */
export function referralUnlockNote(status: ReferralStatus | null | undefined): string | null {
  if (!status || status.eligible || !status.eligible_from) return null;
  return `Referrals unlock on ${formatDate(status.eligible_from)}, once you've been subscribed for a month.`;
}
