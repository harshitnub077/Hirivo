// Internshala: India's largest internship board, plus fresher jobs. Public listing pages, searched
// by category (its URLs are category + city) and parsed from HTML.
import type { MatchProfile, RawJob, SearchHost } from '../types';
import { SourceBlocked } from '../types';
import { nearbyCities } from '../geo';
import { monthlyPay, parsePostedDate, sleep, slug } from './common';

// Role words → Internshala categories (every slug checked against the live site).
const CATEGORIES: [RegExp, string][] = [
  [/full[\s-]?stack/i, 'full-stack-development'],
  [/front[\s-]?end|react|angular|vue|ui developer/i, 'front-end-development'],
  [/back[\s-]?end|node|django|spring|api/i, 'back-end-development'],
  [/web/i, 'web-development'],
  [/android/i, 'android-app-development'],
  [/mobile|ios|flutter|react native/i, 'mobile-app-development'],
  [/machine learning|\bml\b|deep learning/i, 'machine-learning'],
  [/\bai\b|artificial intelligence|llm|genai/i, 'artificial-intelligence-ai'],
  [/data scien/i, 'data-science'],
  [/data analy|business analy|analytics/i, 'data-analytics'],
  [/devops|sre|site reliability|platform/i, 'devops'],
  [/cloud/i, 'cloud-computing'],
  [/security|cyber/i, 'cyber-security'],
  [/\bjava\b/i, 'java'],
  [/python/i, 'python'],
  [/javascript/i, 'javascript-development'],
  [/ui\/ux|ux|product design/i, 'ui-ux-design'],
  [/graphic/i, 'graphic-design'],
  [/digital marketing|seo|social media/i, 'digital-marketing'],
  [/marketing|growth/i, 'marketing'],
  [/content|copywrit/i, 'content-writing'],
  [/finance|account/i, 'finance'],
  [/\bhr\b|human resources|talent|recruit/i, 'human-resources-hr'],
  [/business development|bde/i, 'business-development'],
  [/sales/i, 'sales'],
  [/operations/i, 'operations'],
  [/software|developer|engineer|sde|programmer/i, 'software-development'],
];

export function internshalaCategories(p: MatchProfile): string[] {
  const words = [...p.queries, ...p.targets].join(' | ');
  const found = CATEGORIES.filter(([re]) => re.test(words)).map(([, c]) => c);
  return Array.from(new Set(found.length ? found : ['software-development'])).slice(0, 3);
}

/** Listing URLs for the profile: internships and/or fresher jobs, by city, all India or work from home. */
export function internshalaUrls(p: MatchProfile): string[] {
  const s = p.search;
  const kinds: ('internships' | 'jobs')[] = s.jobType === 'internship' ? ['internships'] : s.jobType === 'fulltime' ? ['jobs'] : ['internships', 'jobs'];
  const cities = s.scope === 'radius' && p.center ? nearbyCities(p.center, s.radiusKm).slice(0, 3).map((c) => slug(c.name === 'Bengaluru' ? 'Bangalore' : c.name)) : [];
  const urls: string[] = [];
  for (const kind of kinds) {
    const unit = kind === 'internships' ? 'internship' : 'jobs';
    for (const cat of internshalaCategories(p)) {
      if (s.scope === 'remote') urls.push(`https://internshala.com/${kind}/work-from-home-${cat}-${kind}/`);
      else if (cities.length) for (const c of cities) urls.push(`https://internshala.com/${kind}/${cat}-${unit}-in-${c}/`);
      else urls.push(`https://internshala.com/${kind}/${cat}-${unit}/`);
      if (s.scope !== 'remote' && s.workModes.includes('remote')) urls.push(`https://internshala.com/${kind}/work-from-home-${cat}-${kind}/`);
    }
  }
  return Array.from(new Set(urls)).slice(0, 8);
}

export function parseInternshala(html: string, now = Date.now()): RawJob[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: RawJob[] = [];
  for (const card of Array.from(doc.querySelectorAll('.individual_internship[internshipid]'))) {
    const text = (sel: string) => (card.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
    const href = card.getAttribute('data-href') || card.querySelector('.job-internship-name a')?.getAttribute('href') || '';
    const title = text('.job-internship-name');
    if (!title || !href) continue;
    const location = text('.locations') || 'India';
    const pay = text('.stipend') || text('.salary') || text('.desktop');
    const internship = card.getAttribute('employment_type') !== 'job';
    out.push({
      source: 'internshala',
      sourceId: card.getAttribute('internshipid')!,
      sourceLabel: 'Internshala',
      title,
      company: text('.company-name'),
      location,
      remote: /work from home|remote/i.test(location),
      url: new URL(href, 'https://internshala.com').toString(),
      postedAt: parsePostedDate(text('.color-labels [class^="status-"] span') || text('.color-labels span'), now),
      salary: pay || undefined,
      monthlyPay: monthlyPay(pay),
      tags: Array.from(card.querySelectorAll('.job_skill')).map((e) => (e.textContent || '').trim().toLowerCase()).filter(Boolean),
      internship,
      applyVia: 'internshala',
    });
  }
  return out;
}

export async function searchInternshala(p: MatchProfile, host: SearchHost): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const [i, url] of internshalaUrls(p).entries()) {
    if (i) await sleep(1200);
    const res = await host.fetchText(url, { credentials: 'omit' });
    if (res.status === 403 || res.status === 429) throw new SourceBlocked('Internshala is limiting requests; it will retry later.');
    if (res.ok) out.push(...parseInternshala(res.text));
  }
  return out;
}
