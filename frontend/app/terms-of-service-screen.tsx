import React from 'react';
import { LegalPage } from '../src/LegalPage';
import { TERMS_INTRO, TERMS_SECTIONS } from '../src/legalContent';

export default function TermsOfServiceScreen() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={TERMS_INTRO}
      sections={TERMS_SECTIONS}
      other={{ label: 'Privacy Policy', route: '/privacy-policy-screen' }}
      testID="terms-of-service-screen"
    />
  );
}
