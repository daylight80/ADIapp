// What an owner copies from the Website form card, and what the hosted form page sends.
// The key is secret-ish (it says which school an enquiry is for): none of this is logged or stored here.

/** The DualControl-hosted form page, on the web app's own address. */
export function formPageUrl(webOrigin: string, key: string): string {
  return `${webOrigin.replace(/\/+$/, '')}/enquiry-form-screen?k=${encodeURIComponent(key)}`;
}

/** The address an Elementor Form's Webhook action (or any other form) posts to. `apiBase` already ends in /api. */
export function webhookUrl(apiBase: string, key: string): string {
  return `${apiBase.replace(/\/+$/, '')}/public/enquiries/${encodeURIComponent(key)}`;
}

/** Paste into an HTML widget on any site to show the hosted form inside the page. */
export function iframeSnippet(pageUrl: string): string {
  return `<iframe src="${pageUrl}" title="Enquiry form" width="100%" height="900" style="border:0;max-width:560px"></iframe>`;
}

/** Wording the owner can put on their own form. Not legal advice; the Terms and Privacy text still needs a solicitor. */
export function privacyWording(schoolName: string): string {
  const who = schoolName.trim() || 'We';
  return `${who} will use the details you give here only to reply to your enquiry about driving lessons, and will keep them while we are talking to you. You can ask for them to be deleted at any time.`;
}

export type EnquiryFields = {
  name: string; phone: string; email: string; postcode: string;
  availability: string; theory: string; transmission: string; message: string;
  consent: boolean; company_website: string;
};

/** A message for the visitor, or null when the form is fine to send. */
export function enquiryProblem(f: Pick<EnquiryFields, 'name' | 'phone' | 'email' | 'consent'>): string | null {
  if (!f.name.trim()) return 'Please enter your name.';
  if (!f.phone.trim() && !f.email.trim()) return 'Please give a mobile number or an email address so we can reply.';
  if (!f.consent) return 'Please tick the box to say you are happy to be contacted.';
  return null;
}

/** The post body. The hidden trap field goes along as it is: a person leaves it empty, a bot fills it. */
export function enquiryBody(f: EnquiryFields): Record<string, string> {
  const out: Record<string, string> = {
    name: f.name, phone: f.phone, email: f.email, postcode: f.postcode,
    availability: f.availability, theory_test: f.theory, transmission: f.transmission, message: f.message,
    consent: f.consent ? 'Happy to be contacted' : '',
    company_website: f.company_website,
  };
  return out;
}
