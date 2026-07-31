export const WINK_GO_POLICY_VERSION = '2026-07-30';
export const WINK_GO_POLICY_CONSENT_STORAGE_KEY = 'winkgoPolicyConsent';

export type PolicyConsentFlow = 'login' | 'register';

export type StoredPolicyConsent = {
  policyVersion: string;
  privacyVersion: string;
  termsVersion: string;
  acceptedAt: string;
  flow: PolicyConsentFlow;
};

export function recordPolicyConsent(
  storage: Pick<Storage, 'setItem'>,
  flow: PolicyConsentFlow,
  acceptedAt = new Date()
): StoredPolicyConsent {
  const consent: StoredPolicyConsent = {
    policyVersion: WINK_GO_POLICY_VERSION,
    privacyVersion: WINK_GO_POLICY_VERSION,
    termsVersion: WINK_GO_POLICY_VERSION,
    acceptedAt: acceptedAt.toISOString(),
    flow,
  };
  storage.setItem(WINK_GO_POLICY_CONSENT_STORAGE_KEY, JSON.stringify(consent));
  return consent;
}
