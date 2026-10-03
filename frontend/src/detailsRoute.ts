// "My details" is one place for an instructor to see their own details. Solo
// instructors (Starter/Growth/Pro) are their own school owner and can edit them;
// Franchise instructors only see what their school owner has set. These used to be
// two separately named links ("My Details" on Home, "My instructor profile" in
// Profile) that looked like duplicates; both now go through here.
import { isFranchiseTier } from './tiers';

export const MY_DETAILS_EDITABLE_ROUTE = '/my-details-screen';
export const MY_DETAILS_VIEW_ROUTE = '/instructor-profile-screen';

export function myDetailsRoute(tier: string | null | undefined): string {
  return isFranchiseTier(tier) ? MY_DETAILS_VIEW_ROUTE : MY_DETAILS_EDITABLE_ROUTE;
}
