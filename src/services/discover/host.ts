// The browser side of a search: plain fetches from this extension page, and background-tab reads
// done by the background worker (it owns tabs and survives the panel closing).
import type { SearchHost } from './types';

/** Undefined outside the extension (the demo panel): job sites can only be read from the extension. */
export function browserSearchHost(): SearchHost | undefined {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return undefined;
  return {
    async fetchText(url, init) {
      try {
        const r = await fetch(url, init);
        return { ok: r.ok, status: r.status, url: r.url || url, text: r.ok ? await r.text() : '' };
      } catch {
        return { ok: false, status: 0, url, text: '' };
      }
    },
    async scrapeTab(url) {
      const r = await chrome.runtime.sendMessage({ action: 'TAB_SCRAPE', url });
      if (!r || r.error) throw new Error(r?.error || 'The page could not be read.');
      return r;
    },
  };
}
