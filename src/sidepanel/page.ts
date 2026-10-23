import { db, JobSnapshot } from '../db';
import { extractJobFromPage, ExtractedJobData } from '../content/extractJob';

export interface ActivePage {
  tabId: number;
  url: string;
  host: string;
}

export async function getActivePage(): Promise<ActivePage | null> {
  if (import.meta.env.DEV && location.search.includes('demo')) return (await import('./demo')).DEMO_PAGE;
  if (typeof chrome === 'undefined' || !chrome.tabs) return null;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return null;
  return { tabId: tab.id, url: tab.url, host: new URL(tab.url).hostname.replace(/^www\./, '') };
}

/** Stable id per job: LinkedIn search pages carry the job in ?currentJobId=. */
export function jobIdFor(url: string): string {
  try {
    const u = new URL(url);
    const liJob = u.searchParams.get('currentJobId') || u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
    if (u.hostname.endsWith('linkedin.com') && liJob) return `linkedin:${liJob}`;
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

async function runExtractor(tabId: number): Promise<ExtractedJobData> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: extractJobFromPage });
  if (!result?.result) throw new Error('Could not read this page.');
  return result.result as ExtractedJobData;
}

/**
 * Reads the job on the current tab. Called only from a user click. On sites outside the
 * built-in list, Chrome asks the user once to allow Hirivo to read that one site.
 */
export async function analyzeActivePage(): Promise<JobSnapshot> {
  const page = await getActivePage();
  if (!page) throw new Error('Open a job posting in this window, then press Analyze.');

  let data: ExtractedJobData;
  try {
    data = await runExtractor(page.tabId);
  } catch (err: any) {
    const origin = `${new URL(page.url).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!granted) throw new Error(`Hirivo needs your OK to read ${page.host}. Press Analyze again and choose Allow.`);
    data = await runExtractor(page.tabId);
  }

  if (!data.title || data.description.length < 120) {
    throw new Error('This page does not look like a single job posting. Open the job itself, then press Analyze.');
  }

  const id = jobIdFor(data.sourceUrl);
  const previous = await db.jobs.get(id);
  const job: JobSnapshot = {
    ...previous,
    id,
    url: data.sourceUrl,
    title: data.title,
    company: data.company || previous?.company || '',
    companyDomain: previous?.companyDomain || data.companyDomain,
    location: data.location,
    description: data.description,
    postedDate: data.postedDate,
    isReposted: data.isReposted,
    atsUrl: data.atsUrl,
    analyzedAt: previous?.analyzedAt ?? 0,
  };
  await db.jobs.put(job);
  return job;
}
