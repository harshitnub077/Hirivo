// Naukri and Indeed India block scripted requests (Akamai, Cloudflare), but serve a normal visit.
// So their real results page is opened in a background tab of the user's own Chrome and the job
// cards on it are read (content/extractJobList.ts). Reading only; nothing is clicked.
import type { ListedJob } from '../../../content/extractJobList';
import type { MatchProfile, RawJob, SearchHost } from '../types';
import { SourceBlocked } from '../types';
import { nearbyCities } from '../geo';
import { INTERN_WORDS, monthlyPay, parsePostedDate, slug } from './common';

export function naukriUrls(p: MatchProfile): string[] {
  const s = p.search;
  const exp = { fresher: 0, '0-2': 1, '2-5': 3, '5+': 5 }[s.experience];
  const cities = s.scope === 'radius' && p.center ? nearbyCities(p.center, s.radiusKm).slice(0, 2).map((c) => slug(c.name === 'Bengaluru' ? 'Bangalore' : c.name)) : [];
  const qs = p.queries.slice(0, 2).map((q) => slug(s.jobType === 'internship' && !INTERN_WORDS.test(q) ? `${q} intern` : q));
  const params = `jobAge=${s.postedWithinDays}&experience=${exp}${s.scope === 'remote' ? '&wfhType=2' : ''}`;
  return qs.flatMap((q) => (cities.length ? cities.map((c) => `https://www.naukri.com/${q}-jobs-in-${c}?${params}`) : [`https://www.naukri.com/${q}-jobs?${params}`])).slice(0, 4);
}

export function indeedUrls(p: MatchProfile): string[] {
  const s = p.search;
  const jt = s.jobType === 'internship' ? 'jt(internship);' : s.jobType === 'fulltime' ? 'jt(fulltime);' : '';
  const remote = s.scope === 'remote' ? 'attr(DSQF7);' : '';
  return p.queries.slice(0, 2).map((q) => {
    const u = new URLSearchParams({ q, fromage: String(s.postedWithinDays), sort: 'date' });
    if (s.scope === 'radius' && p.center) {
      u.set('l', p.center.name);
      u.set('radius', String(Math.min(100, s.radiusKm)));
    } else if (s.scope === 'india') u.set('l', 'India');
    if (jt || remote) u.set('sc', `0kf:${jt}${remote}`);
    return `https://in.indeed.com/jobs?${u}`;
  });
}

export function fromListed(source: 'naukri' | 'indeed', j: ListedJob, now = Date.now()): RawJob {
  return {
    source,
    sourceId: j.id || j.url,
    sourceLabel: source === 'naukri' ? 'Naukri' : 'Indeed',
    title: j.title,
    company: j.company,
    location: j.location,
    remote: Boolean(j.remote) || /remote|work from home/i.test(j.location),
    url: j.url,
    // Naukri internships show "Starts in…" instead of a posting age; that isn't a posting time.
    postedAt: j.postedAt ?? (/\bago\b|today|just now|yesterday/i.test(j.posted || '') ? parsePostedDate(j.posted, now) : undefined),
    salary: j.salary || undefined,
    monthlyPay: monthlyPay(j.salary),
    tags: [],
    snippet: j.snippet,
    internship: Boolean(j.internship) || INTERN_WORDS.test(j.title),
    applyVia: source,
  };
}

async function viaTabs(source: 'naukri' | 'indeed', urls: string[], host: SearchHost): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const url of urls) {
    const page = await host.scrapeTab(url);
    if (page.blocked) throw new SourceBlocked(`${source === 'naukri' ? 'Naukri' : 'Indeed'} showed a check page (${page.blocked}). Open ${new URL(url).hostname} once in Chrome, then Hirivo retries.`);
    out.push(...page.jobs.map((j) => fromListed(source, j)));
  }
  return out;
}

export const searchNaukri = (p: MatchProfile, host: SearchHost) => viaTabs('naukri', naukriUrls(p), host);
export const searchIndeed = (p: MatchProfile, host: SearchHost) => viaTabs('indeed', indeedUrls(p), host);
