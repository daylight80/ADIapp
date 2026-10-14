// What the Pupil Agreement says, shaped around section 10 of the DVSA driving
// instructor code of practice (not in force yet; expected between late 2026 and
// early 2027). It says an instructor's terms of business must include their
// business contact details, the price and duration of lessons, a cancellation
// policy, a refund policy, how the pupil's personal data is handled and how the
// pupil can make a complaint, and should be given to the pupil in writing before
// lessons start. https://www.gov.uk/government/publications/driving-instructor-code-of-practice/driving-instructor-code-of-practice-effective-date-to-be-confirmed
//
// The first two (contact details, price and duration) come from the pupil's own
// record and are always shown, so even a school with its own wording gets them.

import { refundOption, NOT_DELIVERED_SENTENCE } from './refundPolicy';

export type AgreementContext = {
  instructor_name?: string | null;
  adi_number?: string | null;
  business_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  address?: string | null;
  hourly_rate?: number | string | null;
  custom_text?: string | null;
  refund_policy?: string | null;
};

export type AgreementSection = { heading: string; body: string };

export const DVSA_COMPLAINTS_URL = 'https://www.gov.uk/complain-about-a-driving-instructor';

const filled = (v: string | null | undefined): v is string => !!v && v.trim().length > 0;

export function formatRate(rate: number | string | null | undefined): string | null {
  const n = typeof rate === 'string' ? Number(rate) : rate;
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return null;
  return `£${n.toFixed(2)}`;
}

/** Who the instructor is, how to reach them, and what lessons cost. Always shown. */
export function detailsSection(ctx: AgreementContext): AgreementSection {
  const lines: string[] = [];
  if (filled(ctx.instructor_name)) {
    lines.push(`Instructor: ${ctx.instructor_name.trim()}${filled(ctx.adi_number) ? ` (ADI number ${ctx.adi_number.trim()})` : ''}`);
  }
  if (filled(ctx.business_name)) lines.push(`Business: ${ctx.business_name.trim()}`);
  if (filled(ctx.contact_phone)) lines.push(`Phone: ${ctx.contact_phone.trim()}`);
  if (filled(ctx.contact_email)) lines.push(`Email: ${ctx.contact_email.trim()}`);
  if (filled(ctx.address)) lines.push(`Address: ${ctx.address.trim().replace(/\s*\n\s*/g, ', ')}`);

  const rate = formatRate(ctx.hourly_rate);
  lines.push(
    rate
      ? `Lesson price: ${rate} per hour. The length of each lesson is agreed when it is booked, and the price is for the time booked.`
      : 'Lesson price: your instructor will tell you the price per hour before you book. The length of each lesson is agreed when it is booked.',
  );
  return { heading: 'Your instructor and your lessons', body: lines.join('\n') };
}

/** The standard wording, used when the school has not written its own. */
export function standardSections(refundPolicy?: string | null): AgreementSection[] {
  return [
    {
      heading: 'Lessons & cancellations',
      body:
        'Cancellations made less than 24 hours before the lesson are charged at the full rate, unless your instructor agrees otherwise. ' +
        'If your instructor cancels a lesson, you will not be charged for it.',
    },
    {
      heading: 'Eyesight, licence & fitness to drive',
      body:
        'You confirm that you meet the DVSA eyesight standard (number plate readable at 20 metres), hold a valid provisional or full licence ' +
        'that you will show on request, and are fit to drive on the day of each lesson.',
    },
    {
      heading: 'Insurance & liability',
      body:
        "The vehicle is fully insured for tuition. You agree to follow the instructor's directions at all times. Reckless or wilful misuse may incur charges.",
    },
    {
      heading: 'What to expect from your instructor',
      body:
        'Your instructor is approved by DVSA and will display their instructor badge in the windscreen during paid lessons. ' +
        'They will teach in line with the national standard for driver training, give you the full lesson time agreed, ' +
        'tell you how you are progressing and what further training you need, and account for any money you pay in advance.',
    },
    {
      heading: 'Conduct & safeguarding',
      body:
        'Your instructor will treat you with respect, keep to professional boundaries, and will not use inappropriate language, ' +
        'behave in an aggressive way or make unnecessary physical contact. They will not contact you inappropriately outside lessons, ' +
        'including through personal social media. If you are ever uncomfortable, tell someone you trust and report it to DVSA ' +
        `at ${DVSA_COMPLAINTS_URL}.`,
    },
    {
      heading: 'Mobile phones',
      body:
        'Your instructor will not use a phone or hand-held device while teaching in a moving vehicle, and will park safely before using a tablet ' +
        'to record your progress or show you something. Please keep your own phone put away during lessons too.',
    },
    {
      heading: 'Payments, prepaid hours & refunds',
      body:
        'All fees are payable on or before the lesson. Money you pay in advance (prepaid hours) is used up as your lessons are completed, ' +
        `and your balance is shown in the app. ${refundOption(refundPolicy).sentence} ${NOT_DELIVERED_SENTENCE} ` +
        'VAT receipts are available on request.',
    },
    {
      heading: 'Your personal data (UK GDPR)',
      body:
        'Your contact details, lesson notes and progress data are stored securely and used only to deliver your tuition. ' +
        'You may ask for a copy of your data, or for it to be deleted, at any time.',
    },
    {
      heading: 'Photos, video & recording',
      body:
        'Your instructor will not share your personal information, photos or videos, including any in-car camera footage, without your explicit written consent. ' +
        'Tell your instructor if you do not want to be recorded. The optional tick box below is your consent for your driving test pass ' +
        "photo or video to be used on social media and the driving school's website. It is not required, and you can change your mind at any time.",
    },
    {
      heading: 'Driving tests',
      body:
        'You book your own driving test with DVSA: instructors cannot book, change or cancel car tests for pupils. ' +
        'Your instructor will advise you on when you are ready and can help you choose a date. Agree with your instructor beforehand whether ' +
        'they will come with you on the test, and arrive in good time with your licence and the other documents you need.',
    },
    {
      heading: 'Complaints',
      body:
        'If you are unhappy with anything, tell your instructor first. They will deal with it promptly and keep a record of how it was resolved. ' +
        `You can also complain to DVSA at ${DVSA_COMPLAINTS_URL}.`,
    },
  ];
}

export type BuiltAgreement = { sections: AgreementSection[]; usesSchoolText: boolean };

export function buildAgreement(ctx: AgreementContext): BuiltAgreement {
  const custom = filled(ctx.custom_text) ? ctx.custom_text.trim() : null;
  return {
    usesSchoolText: !!custom,
    sections: [
      detailsSection(ctx),
      ...(custom ? [{ heading: "Your school's terms", body: custom }] : standardSections(ctx.refund_policy)),
    ],
  };
}

/** The exact words shown, as one block of text, kept with the signature. */
export function agreementPlainText(agreement: BuiltAgreement): string {
  return agreement.sections.map((s, i) => `${i + 1}. ${s.heading}\n${s.body}`).join('\n\n');
}

/**
 * For a school that writes its own terms: what the code of practice says terms of
 * business must cover. Contact details and lesson price are added automatically to
 * every agreement (see detailsSection), so those two are not on this list.
 */
export const OWN_TERMS_CHECKLIST: string[] = [
  'Your cancellation policy',
  'Your refund policy, including unused prepaid hours',
  'How you handle pupils\' personal data',
  `How a pupil can make a complaint (DVSA's page is ${DVSA_COMPLAINTS_URL})`,
];
