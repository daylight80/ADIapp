import React from 'react';
import { LegalPage } from '../src/LegalPage';
import { PRIVACY_INTRO, PRIVACY_SECTIONS } from '../src/legalContent';

export default function PrivacyPolicyScreen() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={PRIVACY_INTRO}
      sections={PRIVACY_SECTIONS}
      other={{ label: 'Terms of Service', route: '/terms-of-service-screen' }}
      testID="privacy-policy-screen"
    />
  );
}
