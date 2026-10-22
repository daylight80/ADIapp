import {
  isOpen, daysSince, askedLine, contactLine, atStage, stageTotals, dialable, telUrl, smsUrl, enquiryProblem,
  enquiryToPupilInput, type Enquiry,
} from '../enquiries';
import { buildActionItems } from '../actionCentre';
import { routeForTarget } from '../actionCentreNav';

const NOW = new Date(2026, 9, 22, 12, 0);
const ago = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const enq = (id: string, over: Partial<Enquiry> = {}): Enquiry => ({
  id, name: `Person ${id}`, phone: '07700 900123', email: null, postcode: null, source: null, notes: null,
  stage: 'Waiting', stage_at: ago(1), last_contacted_at: null, converted_student_id: null, converted_at: null,
  closed_at: null, closed_reason: null, created_at: ago(1), ...over,
});

describe('open / closed', () => {
  it('an enquiry is open until it starts as a pupil or is closed', () => {
    expect(isOpen(enq('a'))).toBe(true);
    expect(isOpen(enq('a', { converted_at: ago(1) }))).toBe(false);
    expect(isOpen(enq('a', { closed_at: ago(1) }))).toBe(false);
  });
});

describe('describing an enquiry', () => {
  it('says how long ago they asked and when you last spoke', () => {
    expect(askedLine(enq('a', { created_at: ago(0) }), NOW)).toBe('Asked today');
    expect(askedLine(enq('a', { created_at: ago(1) }), NOW)).toBe('Asked yesterday');
    expect(askedLine(enq('a', { created_at: ago(4) }), NOW)).toBe('Asked 4 days ago');
    expect(contactLine(enq('a'), NOW)).toBe('Not contacted yet');
    expect(contactLine(enq('a', { last_contacted_at: ago(2) }), NOW)).toBe('Last contact: 2 days ago');
    expect(daysSince('garbage', NOW)).toBeNull();
    expect(daysSince(null, NOW)).toBeNull();
  });
});

describe('columns', () => {
  it('lists the longest-waiting first, only open ones at that stage, and counts them', () => {
    const list = [
      enq('new', { created_at: ago(1) }),
      enq('old', { created_at: ago(9) }),
      enq('contacted', { stage: 'Contacted' }),
      enq('done', { converted_at: ago(1) }),
      enq('gone', { closed_at: ago(1) }),
    ];
    expect(atStage(list, 'Waiting').map((e) => e.id)).toEqual(['old', 'new']);
    expect(stageTotals(list)).toEqual({ Waiting: 2, Contacted: 1, Booked: 0 });
  });
});

describe('call and text', () => {
  it('builds tel: and sms: links from a UK number as typed', () => {
    expect(dialable('07700 900123')).toBe('07700900123');
    expect(telUrl('07700 900123')).toBe('tel:07700900123');
    expect(smsUrl('+44 7700 900123')).toBe('sms:+447700900123');
    expect(telUrl('(0208) 123-4567')).toBe('tel:02081234567');
  });
  it('gives nothing for a missing or too-short number', () => {
    expect(telUrl('')).toBeNull();
    expect(telUrl(null)).toBeNull();
    expect(smsUrl('12345')).toBeNull();
    expect(telUrl('call me')).toBeNull();
  });
});

describe('checking a new enquiry', () => {
  it('needs a name and a way to reach them', () => {
    expect(enquiryProblem({ name: '  ' })).toMatch(/name/);
    expect(enquiryProblem({ name: 'Sam' })).toMatch(/phone number or an email/);
    expect(enquiryProblem({ name: 'Sam', phone: '123' })).toMatch(/too short/);
    expect(enquiryProblem({ name: 'Sam', email: 'nope' })).toMatch(/email/);
    expect(enquiryProblem({ name: 'Sam', phone: '07700 900123' })).toBeNull();
    expect(enquiryProblem({ name: 'Sam', email: 'sam@example.co.uk' })).toBeNull();
  });
});

describe('starting as a pupil', () => {
  it('carries the details across, with no licence number yet', () => {
    expect(enquiryToPupilInput(enq('a', { name: 'Sam Lee', email: 'sam@x.co.uk', postcode: 'CR4 1AA' }))).toEqual({
      name: 'Sam Lee', email: 'sam@x.co.uk', phone: '07700 900123', postcode: 'CR4 1AA', provisional_licence: '',
    });
    expect(enquiryToPupilInput(enq('b', { email: null, phone: null }))).toMatchObject({ email: '', phone: undefined });
  });
});

describe('Action Centre follow-ups', () => {
  const run = (enquiries: Enquiry[]) =>
    buildActionItems({ now: NOW, students: [], lessons: [], hoursBalances: {}, deadlines: [], enquiries })
      .filter((i) => i.key.startsWith('enquiry-'));

  it('flags an enquiry nobody has contacted after two days, not before', () => {
    const items = run([enq('a', { created_at: ago(3) }), enq('b', { created_at: ago(1) })]);
    expect(items.map((i) => i.key)).toEqual(['enquiry-a']);
    expect(items[0].title).toBe('Person a: enquiry 3 days old');
    expect(items[0].target).toEqual({ screen: 'enquiries' });
  });

  it('flags a contacted enquiry a week after the last contact, but never Booked, closed or started ones', () => {
    const items = run([
      enq('c1', { stage: 'Contacted', last_contacted_at: ago(8) }),
      enq('c2', { stage: 'Contacted', last_contacted_at: ago(3) }),
      enq('b', { stage: 'Booked', last_contacted_at: ago(30) }),
      enq('x', { created_at: ago(30), closed_at: ago(1) }),
      enq('y', { created_at: ago(30), converted_at: ago(1) }),
    ]);
    expect(items.map((i) => i.key)).toEqual(['enquiry-c1']);
    expect(items[0].detail).toBe('Last contact 8 days ago and no booking yet.');
  });

  it('opens the Enquiries screen', () => {
    expect(routeForTarget({ screen: 'enquiries' })).toEqual({ pathname: '/enquiries-screen' });
  });
});
