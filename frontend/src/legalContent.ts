/**
 * Terms of Service and Privacy Policy text for ADI Pro (28 Sept 2026).
 *
 * DRAFT FOR REVIEW. Written in plain English to match what the app and backend
 * actually do (checked against the code and the live Supabase project on the
 * date above), but it has NOT been reviewed by a solicitor. The commercial
 * positions (refunds, liability cap, notice periods, retention) are marked with
 * [REVIEW] comments below — check them before relying on this text.
 *
 * Kept as data, separate from the screens, so the wording can be edited without
 * touching any layout code. To change what a section says, edit it here.
 */

export const LEGAL_LAST_UPDATED = '28 September 2026';

export const OPERATOR = {
  name: 'Driving School Solutions',
  address: 'Sutton, London, SM1 4LS',
  email: 'hello@drivingschoolsolutions.co.uk',
};

export type LegalSection = {
  heading: string;
  /** Plain paragraphs, rendered in order. */
  body?: string[];
  /** Optional bullet list, rendered after the paragraphs. */
  bullets?: string[];
};

export const TERMS_INTRO =
  `These terms are the agreement between you and ${OPERATOR.name} ("we", "us") for using ADI Pro, ` +
  'our diary, student-tracking, wallet and invoicing app for driving instructors, on the web and on mobile. ' +
  'Please read them, together with our Privacy Policy, before you create an account.';

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: '1. Who we are',
    body: [
      `ADI Pro is run by ${OPERATOR.name}, ${OPERATOR.address}. You can reach us at ${OPERATOR.email}.`,
      'By creating an account or using ADI Pro you agree to these terms. If you do not agree, please do not use it.',
    ],
  },
  {
    heading: '2. Who can use ADI Pro',
    body: [
      'ADI Pro is built for approved driving instructors (ADIs) and driving schools in the UK. When you register you must give your real name, a working email address and your correct DVSA ADI number.',
      'Students and pupils use ADI Pro only by invitation from their instructor, so they cannot register on their own. A pupil who accepts an invitation is bound by these terms too, although most of what follows concerns instructors and schools.',
    ],
  },
  {
    heading: '3. Your account',
    body: [
      'You are responsible for keeping your password safe and for everything done through your account. Tell us straight away at the address above if you think someone else has got into it.',
      'Keep your details accurate and up to date. Each instructor should have their own account, and you must not share a login between people.',
    ],
  },
  {
    heading: '4. Plans and payment',
    body: [
      'ADI Pro has a free Starter plan with limits on the number of students, and paid plans (ADI Pro and Franchise) with more features. The current features and prices are shown in the app on the plans screen and again before you pay.',
      'Paid plans are charged monthly in advance through our payment provider, Stripe, and renew automatically until you cancel. Prices include or exclude VAT as shown at checkout. If we change a price we will tell you in advance, and the new price only applies from your next renewal.',
      'You can cancel at any time from Manage subscription in the app. Your paid features continue until the end of the period you have already paid for, and then your account moves to the Starter plan.',
      // [REVIEW] Refund position: currently "no refunds except where the law requires".
      'Fees already paid are not refundable, except where the law requires it or where we agree otherwise. If a payment fails we may move your account to the Starter plan until it is resolved.',
    ],
  },
  {
    heading: '5. Your students and your data',
    body: [
      'You stay responsible for the personal information about your pupils that you put into ADI Pro. You must have a lawful reason to hold it, keep it accurate, and only use ADI Pro to run your driving lessons.',
      'When you import contacts from your phone, you confirm you are allowed to add those people as students.',
      'Our Privacy Policy explains how personal data is handled, including that you (or your driving school) are responsible for your pupils\' data and we process it on your behalf.',
    ],
  },
  {
    heading: '6. Reminders and messages sent through ADI Pro',
    body: [
      'On paid plans, ADI Pro can send lesson reminders to your students by push notification and by email, using the contact details you hold for them. Emails are sent in your name and replies go to you.',
      'You are responsible for making sure those contact details are correct and that your students expect to hear from you about their lessons.',
    ],
  },
  {
    heading: '7. Acceptable use',
    body: ['You must not:'],
    bullets: [
      'use ADI Pro for anything unlawful, or to send spam or misleading messages;',
      'try to get into other people\'s accounts or data, or to probe, disrupt or overload the service;',
      'copy, resell or reverse-engineer ADI Pro, except where the law allows;',
      'upload content that is unlawful, harmful or that you have no right to share.',
    ],
  },
  {
    heading: '8. Your content',
    body: [
      'You own what you put into ADI Pro. You give us permission to store, process and display it only so that we can provide the service to you, for example to show your diary, send your reminders or produce your invoices.',
    ],
  },
  {
    heading: '9. Tools that support your teaching',
    body: [
      'ADI Pro is not connected to or endorsed by the DVSA. Features such as the DL25 mock test, standards check, syllabus tracking and the theory and Show Me / Tell Me tools are practice and record-keeping aids. They are not official assessments, and they do not replace your own professional judgement.',
    ],
  },
  {
    heading: '10. Third-party services',
    body: [
      'ADI Pro relies on other providers, such as Stripe for payments and Google for travel-time estimates. We are not responsible for their services, and they may have their own terms.',
    ],
  },
  {
    heading: '11. Availability and your records',
    body: [
      'We work hard to keep ADI Pro running and to look after your data, but we cannot promise it will always be available or free from errors. We may change or improve features over time.',
      'You are responsible for keeping any records you are legally required to keep. We recommend you use the backup and export tools in the app regularly.',
    ],
  },
  {
    heading: '12. Our responsibility to you',
    body: [
      'Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else the law does not allow us to limit.',
      // [REVIEW] Liability cap: currently fees paid in the previous 12 months.
      'Otherwise, and as far as the law allows, we are not liable for loss of profit, income, business or data, or for indirect or consequential loss. Our total liability to you for anything arising from your use of ADI Pro is limited to the fees you paid us in the 12 months before the event that caused the claim.',
      'If you are a consumer, your statutory rights are not affected by these terms.',
    ],
  },
  {
    heading: '13. Ending your account',
    body: [
      'You can stop using ADI Pro at any time, and you can ask us to delete your account from Profile > Privacy & data.',
      'We may suspend or close an account that breaks these terms or puts other users or the service at risk. Where reasonable we will tell you first and explain why.',
    ],
  },
  {
    heading: '14. Changes to these terms',
    body: [
      'We may update these terms from time to time. If a change matters, we will tell you in the app or by email before it takes effect. If you keep using ADI Pro after that, you accept the updated terms.',
    ],
  },
  {
    heading: '15. Governing law',
    body: [
      'These terms are governed by the law of England and Wales, and the courts of England and Wales have jurisdiction, although if you live in Scotland or Northern Ireland you may also bring a claim in your local courts.',
    ],
  },
  {
    heading: '16. Contact',
    body: [`Questions about these terms? Email ${OPERATOR.email}.`],
  },
];

export const PRIVACY_INTRO =
  `This policy explains what personal information ADI Pro collects, why, who sees it, and the choices you have. ` +
  'It is written to be read, so we have kept it plain.';

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: '1. Who is responsible for your data',
    body: [
      `${OPERATOR.name} (${OPERATOR.address}) runs ADI Pro. The role we play depends on whose data it is:`,
    ],
    bullets: [
      'Instructors and school owners: for your own account and billing details we are the "controller" of your personal data.',
      'Pupils and students: the instructor or driving school that adds you is the controller of your lesson, progress and contact records. We process that information only on their behalf and on their instructions, to provide ADI Pro.',
    ],
  },
  {
    heading: '2. What we collect',
    body: ['Instructors and school owners:'],
    bullets: [
      'name, email address, DVSA ADI number, phone number and business or school name and logo;',
      'your password, which is stored securely by our sign-in provider and which we cannot read;',
      'your plan and subscription status (card details go directly to Stripe and we never see them);',
      'what you record in the app: diary and lessons, vehicles, invoices, wallet, income and expenses, and receipt photos.',
    ],
  },
  {
    heading: 'Pupils and students',
    body: ['Entered by your instructor, or by you when you use the app:'],
    bullets: [
      'name, email address, phone number and pick-up address;',
      'lesson history and notes, progress against the driving syllabus, mock test and theory test results, reflective logs and test outcomes;',
      'payments and balances, and your signed pupil agreement (the name you type as a signature and the time you signed).',
    ],
  },
  {
    heading: 'Technical information',
    bullets: [
      'a push notification token for your device, if you turn notifications on;',
      'your IP address and basic request logs, which our hosting providers keep for security and troubleshooting;',
      'a sign-in session stored in your browser or on your phone, so you stay signed in.',
    ],
  },
  {
    heading: '3. Your phone\'s permissions',
    body: ['ADI Pro only asks for what a feature needs, and each is optional:'],
    bullets: [
      'Camera and photos: to scan or attach receipts.',
      'Contacts: only when you choose to import contacts. Your contacts are listed on your phone for you to tick; only the people you select are saved as students.',
      'Location: only while you record a driving route. Recorded routes are saved on your own device and are not uploaded to us. You can export them yourself.',
      'Notifications: to receive lesson reminders.',
    ],
  },
  {
    heading: '4. Why we use it, and our legal basis',
    body: ['We use personal data for these purposes:'],
    bullets: [
      'To provide ADI Pro and your account, including sending lesson reminders, invitations, sign-up confirmation and password-reset emails (contract).',
      'To take payment and keep the financial records the law requires (contract and legal obligation).',
      'To keep the service secure, prevent misuse and fix problems (legitimate interests).',
      'To use your phone\'s camera, contacts, location and notifications when you switch those features on (your consent, which you can withdraw in your phone\'s settings).',
    ],
  },
  {
    heading: 'What we do not do',
    body: [
      'We do not sell your personal data, and we do not use it for advertising. ADI Pro does not contain advertising or third-party analytics or tracking tools.',
    ],
  },
  {
    heading: '5. Who we share it with',
    body: [
      'We use a small number of service providers to run ADI Pro. They may only use your data to provide their service to us:',
    ],
    bullets: [
      'Supabase: our database and sign-in. Data is stored in London, UK.',
      'Render: runs our server, in Frankfurt, Germany.',
      'Netlify: hosts the web app.',
      'Stripe: takes and manages subscription payments.',
      'Resend: sends our emails, such as sign-up confirmation, password reset, invitations and lesson reminders.',
      'Expo: delivers push notifications to your phone.',
      'Google: when you ask for a travel-time estimate, the pick-up and destination addresses are sent to Google Maps.',
      'Anthropic: when you scan a receipt, the receipt image is sent to Anthropic so the text can be read.',
    ],
  },
  {
    heading: 'Sharing within ADI Pro',
    body: [
      'An instructor can see their own students. A school owner can see the instructors and students in their school. A pupil can see their own records. We may also share information if the law requires it.',
    ],
  },
  {
    heading: '6. Transfers outside the UK',
    body: [
      'Some of the providers above may process data outside the UK. Where they do, we rely on approved safeguards, such as the UK\'s adequacy arrangements or the UK International Data Transfer Addendum, so your data stays protected to UK standards.',
    ],
  },
  {
    heading: '7. How long we keep it',
    body: [
      'We keep your data while your account is active. When an account is deleted, or a deletion request is completed, we delete or anonymise the personal data, except what we must keep by law, such as billing records (normally six years). Deleted data may remain in secure backups for a short time before it is overwritten.',
    ],
  },
  {
    heading: '8. Your rights',
    body: [
      'Under UK data protection law you can ask to see your data, correct it, have it deleted, restrict or object to how it is used, receive a copy in a portable form, and withdraw consent where we rely on it.',
      'You can download your data and request deletion yourself in the app under Profile > Privacy & data. Otherwise email us at ' + OPERATOR.email + '.',
      'If you are a pupil, your instructor is responsible for your records, so it is often quickest to ask them first. We will help them respond to you.',
      'You can also complain to the Information Commissioner\'s Office (ico.org.uk, 0303 123 1113) if you are unhappy with how your data has been handled, though we would welcome the chance to put it right first.',
    ],
  },
  {
    heading: '9. Cookies and similar technologies',
    body: [
      'We only use the browser or device storage that is strictly needed to keep you signed in and remember your basic settings. We do not use advertising or analytics cookies.',
    ],
  },
  {
    heading: '10. Children',
    body: [
      'ADI Pro is designed for instructors. Pupils are usually 17 or over. We do not knowingly collect data from anyone under 16. If a pupil is under 18, their instructor is responsible for handling their information appropriately.',
    ],
  },
  {
    heading: '11. Security',
    body: [
      'We use industry-standard measures to protect your data, including encrypted connections and database rules that limit each instructor to their own students\' records. No system is perfectly secure, so if you think your account has been compromised please tell us at once.',
    ],
  },
  {
    heading: '12. Changes to this policy',
    body: [
      'We may update this policy. If a change matters, we will tell you in the app or by email. The date at the top shows when it was last updated.',
    ],
  },
  {
    heading: '13. Contact',
    body: [`Questions or requests about your data? Email ${OPERATOR.email}, or write to ${OPERATOR.name}, ${OPERATOR.address}.`],
  },
];
