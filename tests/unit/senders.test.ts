import { describe, expect, it } from 'vitest';
import { PRIVILEGED, fromExtensionPage } from '../../src/background/senders';

const ID = 'abcdefghijklmnop';

describe('privileged background messages', () => {
  it('accepts the side panel and the offscreen document', () => {
    expect(fromExtensionPage({ id: ID, url: `chrome-extension://${ID}/sidepanel.html` }, ID)).toBe(true);
    expect(fromExtensionPage({ id: ID, url: `chrome-extension://${ID}/offscreen.html` }, ID)).toBe(true);
  });
  it('refuses content scripts running in a page, and other extensions', () => {
    expect(fromExtensionPage({ id: ID, tab: { id: 4 }, url: 'https://jobs.lever.co/acme/1' }, ID)).toBe(false);
    expect(fromExtensionPage({ id: 'someoneelse', url: 'chrome-extension://someoneelse/x.html' }, ID)).toBe(false);
  });
  it('guards every action that sends email or opens tabs', () => {
    for (const a of ['AP_SEND', 'AP_APPLY', 'AP_READ_PAGE', 'TAB_SCRAPE']) expect(PRIVILEGED.has(a)).toBe(true);
  });
});
