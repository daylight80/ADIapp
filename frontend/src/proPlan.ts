// Pro tier constants and helpers
export const FREE_STUDENT_LIMIT = 5;
export const PRO_PRICE_GBP = 9.99;

export const PRO_FEATURES = [
  'Unlimited students (Free tier: 5)',
  'Generate & download PDF invoices',
  'Lesson reminder push notifications',
  'New student & payment alerts',
  'Priority email support',
];

export function isPro(status?: string | null): boolean {
  return status === 'pro';
}

export function canAddStudent(status: string | null | undefined, currentCount: number): boolean {
  if (isPro(status)) return true;
  return currentCount < FREE_STUDENT_LIMIT;
}
