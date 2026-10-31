import { formPageUrl, webhookUrl, iframeSnippet, privacyWording, enquiryProblem, enquiryBody } from '../enquiryForm';

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // made up

describe('addresses an owner copies', () => {
  it('builds the hosted page address on the web app, whatever trailing slash the origin has', () => {
    expect(formPageUrl('https://webapp.example.test/', KEY)).toBe(`https://webapp.example.test/enquiry-form-screen?k=${KEY}`);
  });

  it('builds the webhook address from the api base, which already ends in /api', () => {
    expect(webhookUrl('https://api.example.test/api', KEY)).toBe(`https://api.example.test/api/public/enquiries/${KEY}`);
  });

  it('builds an iframe that points at the hosted page', () => {
    const tag = iframeSnippet('https://webapp.example.test/enquiry-form-screen?k=x');
    expect(tag).toContain('src="https://webapp.example.test/enquiry-form-screen?k=x"');
    expect(tag.startsWith('<iframe')).toBe(true);
  });

  it('gives privacy wording with or without a school name', () => {
    expect(privacyWording('Sam Driving')).toMatch(/^Sam Driving will use/);
    expect(privacyWording('')).toMatch(/^We will use/);
  });
});

describe('what a visitor must fill in', () => {
  const ok = { name: 'Sam', phone: '07700900123', email: '', consent: true };

  it('is fine with a name, one way to reply and the tick', () => {
    expect(enquiryProblem(ok)).toBeNull();
    expect(enquiryProblem({ ...ok, phone: '', email: 'sam@example.test' })).toBeNull();
  });

  it('asks for each missing thing', () => {
    expect(enquiryProblem({ ...ok, name: '  ' })).toMatch(/name/);
    expect(enquiryProblem({ ...ok, phone: '', email: '' })).toMatch(/mobile number or an email/);
    expect(enquiryProblem({ ...ok, consent: false })).toMatch(/tick/);
  });
});

describe('the post body', () => {
  it('uses field names the server understands and sends the trap field as it is', () => {
    const body = enquiryBody({
      name: 'Sam', phone: '07700900123', email: 'sam@example.test', postcode: 'CR0 1AA', availability: 'Evenings',
      theory: 'Passed', transmission: 'Manual', message: 'Hello', consent: true, company_website: 'spam.test',
    });
    expect(body).toMatchObject({
      name: 'Sam', phone: '07700900123', email: 'sam@example.test', postcode: 'CR0 1AA', availability: 'Evenings',
      theory_test: 'Passed', transmission: 'Manual', message: 'Hello', consent: 'Happy to be contacted', company_website: 'spam.test',
    });
  });
});
