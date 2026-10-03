// Validation for the instructor's own details form (Profile screen). Kept apart
// from the component so the rules can be tested.

export type DetailsInput = { fullName: string; adiNumber: string; googleReviewUrl: string };

/** Returns what to tell the instructor, or null when the details can be saved. */
export function validateInstructorDetails(input: DetailsInput): string | null {
  if (!input.fullName.trim()) return 'Please enter your name.';
  if (!input.adiNumber.trim()) return 'Please enter your ADI or PDI number.';
  // Same rule as school-profile-screen's Google review field: both feed the
  // "Request a Google review" text a student gets after passing.
  const review = input.googleReviewUrl.trim();
  if (review && !/^https?:\/\//i.test(review)) return 'The Google review link should start with https://';
  return null;
}
