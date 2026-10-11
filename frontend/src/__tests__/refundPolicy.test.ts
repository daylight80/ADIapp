import { REFUND_POLICIES, DEFAULT_REFUND_POLICY, resolveRefundPolicy, refundOption } from '../refundPolicy';
import { standardSections, buildAgreement, agreementPlainText } from '../agreementTerms';

describe('refund policy options', () => {
  it('offers the four policies the database allows, once each', () => {
    expect(REFUND_POLICIES.map((p) => p.key)).toEqual(['non_refundable', 'refund_14_days', 'refund_any_time', 'credit_only']);
  });

  it('defaults to the policy the agreement used before schools could choose', () => {
    expect(DEFAULT_REFUND_POLICY).toBe('non_refundable');
  });

  it('falls back to the default for anything unknown or not set', () => {
    for (const v of [null, undefined, '', 'nonsense']) expect(resolveRefundPolicy(v)).toBe('non_refundable');
    expect(resolveRefundPolicy('credit_only')).toBe('credit_only');
  });

  it('gives every option its own wording', () => {
    const sentences = REFUND_POLICIES.map((p) => p.sentence);
    expect(new Set(sentences).size).toBe(4);
    expect(refundOption('refund_14_days').sentence).toMatch(/within 14 days/);
    expect(refundOption('refund_any_time').sentence).toMatch(/at any time/);
    expect(refundOption('credit_only').sentence).toMatch(/not refunded as money/);
  });
});

describe('the full agreement uses the policy from the school', () => {
  it('shows the choice in the text kept with the signature', () => {
    const text = agreementPlainText(buildAgreement({ instructor_name: 'A B', refund_policy: 'credit_only' }));
    expect(text).toContain(refundOption('credit_only').sentence);
    expect(text).not.toContain(refundOption('non_refundable').sentence);
  });

  it('gives every option a label and a description for the instructor choosing it', () => {
    for (const p of REFUND_POLICIES) {
      expect(p.label.length).toBeGreaterThan(5);
      expect(p.description.length).toBeGreaterThan(20);
    }
    expect(refundOption('refund_14_days').label).toBe('Refund within 14 days');
  });
});

describe('the agreement shows the school\'s refund policy', () => {
  const payments = (policy?: string | null) =>
    standardSections(policy).find((s) => s.heading === 'Payments, prepaid hours & refunds')!.body;

  it.each(REFUND_POLICIES)('uses the wording for $key', ({ key, sentence }) => {
    expect(payments(key)).toContain(sentence);
  });

  it('shows only the chosen policy', () => {
    expect(payments('credit_only')).not.toContain('non-refundable');
    expect(payments('refund_any_time')).not.toContain('within 14 days');
  });

  it('uses the default when the school has not chosen', () => {
    expect(payments(undefined)).toContain(refundOption('non_refundable').sentence);
  });

  it('always refunds or credits a paid lesson that is not delivered', () => {
    for (const p of REFUND_POLICIES) expect(payments(p.key)).toMatch(/not delivered, it will be refunded or credited/);
  });
});
