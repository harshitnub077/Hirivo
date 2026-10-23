import { db, JobSnapshot } from '../db';
import { extractJobFromPage, ExtractedJobData } from '../content/extractJob';
import { extractJobListFromPage, ListedJob } from '../content/extractJobList';
import { savePageJobs } from '../services/discover';
import { grabRenderedPage } from '../content/grabPage';

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

/** Saves the job cards visible on the current search page. Called only from a user click. */
export async function saveJobsFromActivePage(): Promise<{ host: string; count: number }> {
  const page = await getActivePage();
  if (!page) throw new Error('Open a job search page (LinkedIn, Naukri, Indeed, Wellfound…) first.');
  const run = () => chrome.scripting.executeScript({ target: { tabId: page.tabId }, func: extractJobListFromPage });
  let results;
  try {
    results = await run();
  } catch {
    const granted = await chrome.permissions.request({ origins: [`${new URL(page.url).origin}/*`] }).catch(() => false);
    if (!granted) throw new Error(`Hirivo needs your OK to read ${page.host}.`);
    results = await run();
  }
  const { host, jobs } = results[0]?.result as { host: string; jobs: ListedJob[] };
  if (!jobs?.length) throw new Error('No job cards found on this page. Open a search results list and try again.');
  const count = await savePageJobs(
    jobs.map((j) => ({
      source: 'page' as const,
      sourceId: j.url,
      sourceLabel: host,
      title: j.title,
      company: j.company,
      location: j.location,
      remote: /remote/i.test(j.location),
      url: j.url,
      tags: [],
    }))
  );
  return { host, count };
}

/** Returns the rendered HTML of the current tab, for team pages built with JavaScript. User click only. */
export async function grabActivePageHtml(): Promise<{ url: string; html: string; host: string }> {
  const page = await getActivePage();
  if (!page) throw new Error('Open the company team page in this window first.');
  const run = () => chrome.scripting.executeScript({ target: { tabId: page.tabId }, func: grabRenderedPage });
  let results;
  try {
    results = await run();
  } catch {
    const granted = await chrome.permissions.request({ origins: [`${new URL(page.url).origin}/*`] }).catch(() => false);
    if (!granted) throw new Error(`Hirivo needs your OK to read ${page.host}.`);
    results = await run();
  }
  const r = results[0]?.result as { url: string; html: string } | undefined;
  if (!r?.html) throw new Error('Could not read this page.');
  return { ...r, host: page.host };
}
