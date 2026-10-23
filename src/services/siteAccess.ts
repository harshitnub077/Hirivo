// Reading a company's own website needs the user's OK for that one site (optional host permission).
// Call ensureSiteAccess first thing in a click handler: Chrome only shows the prompt during a user gesture.

export function originsFor(domain: string): string[] {
  const bare = domain.replace(/^www\./, '');
  return [`https://${bare}/*`, `https://www.${bare}/*`];
}

export async function hasSiteAccess(domain: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return true;
  return chrome.permissions.contains({ origins: originsFor(domain) });
}

export async function ensureSiteAccess(domain: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return true;
  const origins = originsFor(domain);
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins }).catch(() => false);
}

/** Fetches text with a timeout and a size cap, so one huge page can't stall the panel. */
export async function fetchText(url: string, { timeoutMs = 12_000, maxChars = 2_500_000 } = {}): Promise<{ ok: boolean; status: number; url: string; text: string; type: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    const text = res.ok ? (await res.text()).slice(0, maxChars) : '';
    return { ok: res.ok, status: res.status, url: res.url || url, text, type: res.headers.get('content-type') || '' };
  } catch {
    return { ok: false, status: 0, url, text: '', type: '' };
  }
}

const hasStorage = () => typeof chrome !== 'undefined' && !!chrome.storage?.local;

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, { force = false } = {}): Promise<T> {
  if (hasStorage() && !force) {
    const hit = (await chrome.storage.local.get(key))[key];
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  }
  const value = await load();
  if (hasStorage()) await chrome.storage.local.set({ [key]: { at: Date.now(), value } });
  return value;
}
