// Side-panel side of Autopilot: hand jobs over and wake the runner.
import { enqueue } from './queue';

export async function handToAutopilot(jobs: { url: string; title: string; company: string }[], opts: { force?: boolean } = {}) {
  const added = await enqueue(jobs, opts);
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) await chrome.runtime.sendMessage({ action: 'AP_START' }).catch(() => undefined);
  return added;
}

/** One-time grant: read any website (company sites, careers pages, job pages). */
export async function allowAnySite(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return false;
  return chrome.permissions.request({ origins: ['https://*/*'] }).catch(() => false);
}

export async function canReadAnySite(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return false;
  return chrome.permissions.contains({ origins: ['https://*/*'] }).catch(() => false);
}
