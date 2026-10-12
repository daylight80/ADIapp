// Validation for the Profile details form and the School Profile review link. Kept
// apart from the screens so the rules can be tested.

export type DetailsInput = { fullName: string; adiNumber: string };

/** Returns what to tell the instructor, or null when the details can be saved. */
export function validateInstructorDetails(input: DetailsInput): string | null {
  if (!input.fullName.trim()) return 'Please enter your name.';
  if (!input.adiNumber.trim()) return 'Please enter your ADI or PDI number.';
  return null;
}

/**
 * The Google review link (School Profile) feeds the "Request a Google review" text a
 * student gets after passing. Blank is fine; anything else must be a web address.
 */
export function validateReviewUrl(url: string): string | null {
  const review = url.trim();
  if (review && !/^https?:\/\//i.test(review)) return 'The Google review link should start with https://';
  return null;
}
