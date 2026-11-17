// One place for the links that change at launch. When the Chrome Web Store listing is live,
// set storeUrl and every "Add to Chrome" button on the site points there.
const storeUrl = '';
const repoUrl = 'https://github.com/harshitnub077/Hirivo';

export const SITE = {
  storeUrl,
  repoUrl,
  /** Ready-to-load extension zip, published by .github/workflows/release.yml on every v* tag. */
  downloadUrl: `${repoUrl}/releases/latest`,
  /** Where every "Add to Chrome" button goes: the store when it is live, else the install steps. */
  installHref: storeUrl || './index.html#install',
  installLabel: storeUrl ? 'Add to Chrome, free' : 'Install Hirivo, free',
};
