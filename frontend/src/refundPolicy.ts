// A school's refund policy for prepaid hours and block bookings, shown in the Pupil
// Agreement. The DVSA code of practice (section 10) requires terms of business to
// include a refund policy but not what it is, so each school chooses (Migration 054).

export type RefundPolicyKey = 'non_refundable' | 'refund_14_days' | 'refund_any_time' | 'credit_only';

export const DEFAULT_REFUND_POLICY: RefundPolicyKey = 'non_refundable';

export type RefundPolicyOption = {
  key: RefundPolicyKey;
  label: string;
  /** Shown to the instructor when choosing. */
  description: string;
  /** What the pupil reads in the agreement. */
  sentence: string;
};

const TRANSFER = "can be transferred to another pupil with your instructor's agreement";

export const REFUND_POLICIES: RefundPolicyOption[] = [
  {
    key: 'non_refundable',
    label: 'Non-refundable, transferable',
    description: 'Prepaid hours are not refunded once paid, but can be passed to another pupil.',
    sentence: `Block bookings and prepaid hours are non-refundable once paid, but ${TRANSFER}.`,
  },
  {
    key: 'refund_14_days',
    label: 'Refund within 14 days',
    description: 'Unused hours can be refunded if asked for within 14 days of paying; after that they stay as credit.',
    sentence:
      'Unused prepaid hours can be refunded if you ask within 14 days of paying, less any lessons you have already had. ' +
      `After 14 days they stay on your account as credit, which ${TRANSFER}.`,
  },
  {
    key: 'refund_any_time',
    label: 'Refund unused hours any time',
    description: 'Unused hours can be refunded on request at any time, less lessons taken and any cancellation charges.',
    sentence:
      'Unused prepaid hours can be refunded on request at any time, less any lessons you have already had and any cancellation charges.',
  },
  {
    key: 'credit_only',
    label: 'Credit only, no cash refunds',
    description: 'Prepaid hours are never refunded as money, but stay on the pupil\'s account and can be passed on.',
    sentence:
      'Prepaid hours are not refunded as money, but any unused hours stay on your account as credit for future lessons and ' +
      `${TRANSFER}.`,
  },
];

/** Anything unknown (or not set yet) falls back to the default. */
export function resolveRefundPolicy(value: string | null | undefined): RefundPolicyKey {
  return REFUND_POLICIES.some((p) => p.key === value) ? (value as RefundPolicyKey) : DEFAULT_REFUND_POLICY;
}

export function refundOption(value: string | null | undefined): RefundPolicyOption {
  const key = resolveRefundPolicy(value);
  return REFUND_POLICIES.find((p) => p.key === key)!;
}

/** A lesson that was paid for but not given is always refunded or credited, whatever the policy. */
export const NOT_DELIVERED_SENTENCE = 'If a lesson you have paid for is not delivered, it will be refunded or credited to you.';
