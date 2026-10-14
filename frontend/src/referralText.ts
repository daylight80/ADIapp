// The line under "Refer a driving instructor, get 1 month free". The yearly limit comes from the
// backend (REFERRAL_MAX_REWARDS_PER_YEAR in server.py); 2 is only what's shown before it has loaded.
export type ReferralSummary = { pending: number; rewarded_this_year: number; capped: number; cap_per_year: number };

const DEFAULT_CAP = 2;

export function referralSubtitle(summary: ReferralSummary | null | undefined): string {
  const cap = summary?.cap_per_year ?? DEFAULT_CAP;
  if (summary && summary.rewarded_this_year >= cap) {
    return `You've earned all ${cap} free months for this year. Anyone who subscribes while you're at the limit won't earn you another.`;
  }
  if (summary && (summary.pending > 0 || summary.rewarded_this_year > 0)) {
    return `${summary.pending} pending · ${summary.rewarded_this_year} of ${cap} free months earned this year`;
  }
  return `Share your code — you're rewarded once they subscribe (up to ${cap} free months a year).`;
}
