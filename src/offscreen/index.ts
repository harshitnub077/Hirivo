// Offscreen document: Autopilot's research and writing need DOMParser, which the background worker
// lacks. Tabs, Gmail and notifications are asked of the background worker by message.
import { runQueue, type ApplyReport, type AutopilotHost } from '../services/autopilot/run';
import type { ExtractedJobData } from '../content/extractJob';
import { runDiscover } from '../services/discover';
import { browserSearchHost } from '../services/discover/host';

function ask<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) =>
    chrome.runtime.sendMessage(message, (r) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (r?.error) reject(new Error(r.error));
      else resolve(r as T);
    })
  );
}

const host: AutopilotHost = {
  readPage: (url) => ask<{ page: ExtractedJobData | null }>({ action: 'AP_READ_PAGE', url }).then((r) => r.page),
  sendEmail: (m) => ask<{ draftId: string; threadId: string }>({ action: 'AP_SEND', ...m }),
  apply: (url, submit) => ask<ApplyReport>({ action: 'AP_APPLY', url, submit }),
  notify: (title, message, jobId) => ask({ action: 'AP_NOTIFY', title, message, jobId }).then(() => undefined),
  canReadAnySite: () => ask<{ ok: boolean }>({ action: 'AP_CAN_READ' }).then((r) => Boolean(r?.ok)),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

let searching = false;
async function search(reason: 'alert' | 'daily') {
  if (searching) return;
  searching = true;
  try {
    const r = await runDiscover({ host: browserSearchHost() });
    const newTopMatches = r.newTopMatches.slice(0, 5).map((j) => ({ title: j.title, company: j.company }));
    await chrome.runtime.sendMessage({ action: 'SEARCH_DONE', reason, newTopMatches }).catch(() => undefined);
  } catch {
    if (reason === 'daily') await chrome.runtime.sendMessage({ action: 'SEARCH_DONE', reason, newTopMatches: [] }).catch(() => undefined);
  } finally {
    searching = false;
  }
}

chrome.runtime.onMessage.addListener((m) => {
  if (m?.target === 'offscreen' && m.action === 'AP_RUN') runQueue(host);
  if (m?.target === 'offscreen' && m.action === 'SEARCH_RUN') search(m.reason === 'daily' ? 'daily' : 'alert');
  return false;
});
runQueue(host);
