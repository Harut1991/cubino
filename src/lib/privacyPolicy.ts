/** Public privacy policy URL used in-app and for the Google Play store listing. */
export const PRIVACY_POLICY_URL = 'https://harut1991.github.io/cubino/privacy.html';

export function openPrivacyPolicy(): void {
  window.open(PRIVACY_POLICY_URL, '_blank', 'noopener,noreferrer');
}
