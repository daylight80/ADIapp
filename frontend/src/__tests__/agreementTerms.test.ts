import {
  agreementPlainText, buildAgreement, detailsSection, formatRate, standardSections,
  OWN_TERMS_CHECKLIST, DVSA_COMPLAINTS_URL,
} from '../agreementTerms';

const ctx = {
  instructor_name: 'Grant Robery',
  adi_number: '1234567',
  business_name: "Grant's Driving School",
  contact_phone: '07806750559',
  contact_email: 'hello@example.co.uk',
  address: '20 Waterloo Street \nSutton \nSM14LS',
  hourly_rate: 36,
};

describe('formatRate', () => {
  it('formats a positive rate in pounds and pence, from a number or numeric string', () => {
    expect(formatRate(36)).toBe('£36.00');
    expect(formatRate('37.5')).toBe('£37.50');
  });

  it('gives nothing for a missing or unusable rate', () => {
    for (const v of [null, undefined, 0, -5, 'abc', NaN]) expect(formatRate(v as any)).toBeNull();
  });
});

describe('detailsSection (business contact details, price and duration)', () => {
  it('shows who the instructor is, how to reach them and the price per hour', () => {
    const { heading, body } = detailsSection(ctx);
    expect(heading).toBe('Your instructor and your lessons');
    expect(body).toContain('Instructor: Grant Robery (ADI number 1234567)');
    expect(body).toContain("Business: Grant's Driving School");
    expect(body).toContain('Phone: 07806750559');
    expect(body).toContain('Email: hello@example.co.uk');
    expect(body).toContain('Address: 20 Waterloo Street, Sutton, SM14LS');
    expect(body).toContain('£36.00 per hour');
    expect(body).toMatch(/length of each lesson is agreed when it is booked/);
  });

  it('leaves out contact lines that are not set instead of printing blanks', () => {
    const { body } = detailsSection({ instructor_name: 'Grant Robery', contact_phone: '  ', hourly_rate: 36 });
    expect(body).not.toMatch(/Phone|Email|Address|Business|null|undefined/);
    expect(body).toContain('Instructor: Grant Robery');
  });

  it('says the price will be given before booking when no rate is known', () => {
    const { body } = detailsSection({ instructor_name: 'Grant Robery' });
    expect(body).toMatch(/tell you the price per hour before you book/);
    expect(body).not.toContain('£');
  });
});

describe('standardSections', () => {
  const text = standardSections().map((s) => `${s.heading}\n${s.body}`).join('\n');

  it('covers cancellation, refunds, data, consent, tests and complaints', () => {
    for (const heading of ['Lessons & cancellations', 'Payments, prepaid hours & refunds', 'Your personal data (UK GDPR)',
      'Photos, video & recording', 'Driving tests', 'Complaints']) {
      expect(standardSections().map((s) => s.heading)).toContain(heading);
    }
  });

  it('keeps the existing policies: 24-hour cancellation and non-refundable block bookings', () => {
    expect(text).toMatch(/less than 24 hours/);
    expect(text).toMatch(/non-refundable once paid/);
    expect(text).toMatch(/transferred to another pupil/);
  });

  it('does not charge for lessons the instructor cancels, and refunds ones not delivered', () => {
    expect(text).toMatch(/instructor cancels a lesson, you will not be charged/);
    expect(text).toMatch(/not delivered, it will be refunded or credited/);
  });

  it('tells the pupil how to complain to DVSA', () => {
    expect(text).toContain(DVSA_COMPLAINTS_URL);
  });
});

describe('buildAgreement', () => {
  it('uses the standard wording after the details when the school has none of its own', () => {
    const a = buildAgreement(ctx);
    expect(a.usesSchoolText).toBe(false);
    expect(a.sections[0].heading).toBe('Your instructor and your lessons');
    expect(a.sections.slice(1)).toEqual(standardSections());
  });

  it("uses the school's own wording but still shows the details block first", () => {
    const a = buildAgreement({ ...ctx, custom_text: '  Our own terms.  ' });
    expect(a.usesSchoolText).toBe(true);
    expect(a.sections).toHaveLength(2);
    expect(a.sections[0].heading).toBe('Your instructor and your lessons');
    expect(a.sections[1]).toEqual({ heading: "Your school's terms", body: 'Our own terms.' });
  });

  it('treats blank school text as none', () => {
    expect(buildAgreement({ ...ctx, custom_text: '   ' }).usesSchoolText).toBe(false);
    expect(buildAgreement({ ...ctx, custom_text: null }).usesSchoolText).toBe(false);
  });
});

describe('agreementPlainText', () => {
  it('numbers the sections and keeps their exact wording, for the record kept with the signature', () => {
    const a = buildAgreement({ ...ctx, custom_text: 'Our own terms.' });
    const text = agreementPlainText(a);
    expect(text.startsWith('1. Your instructor and your lessons\nInstructor: Grant Robery')).toBe(true);
    expect(text).toContain("2. Your school's terms\nOur own terms.");
  });
});

describe('OWN_TERMS_CHECKLIST', () => {
  it('lists what a school writing its own terms still has to cover', () => {
    expect(OWN_TERMS_CHECKLIST).toHaveLength(4);
    expect(OWN_TERMS_CHECKLIST.join(' ')).toMatch(/cancellation/i);
    expect(OWN_TERMS_CHECKLIST.join(' ')).toMatch(/refund/i);
    expect(OWN_TERMS_CHECKLIST.join(' ')).toMatch(/data/i);
    expect(OWN_TERMS_CHECKLIST.join(' ')).toContain(DVSA_COMPLAINTS_URL);
  });
});
