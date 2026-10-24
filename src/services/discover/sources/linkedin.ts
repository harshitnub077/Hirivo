// LinkedIn job search, read logged-out through its public "guest" endpoint (the one its own
// logged-out search page uses). Fetched with credentials omitted, so the user's LinkedIn account
// is never involved. Paced, and stops at the first block response.
import type { MatchProfile, RawJob, SearchHost } from '../types';
import { SourceBlocked } from '../types';
import { INTERN_WORDS, parsePostedDate, sleep } from './common';

const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

export function linkedInSearchUrl(p: MatchProfile, keywords: string, start = 0): string {
  const s = p.search;
  const q = new URLSearchParams({ keywords, start: String(start) });
  if (s.scope === 'radius' && p.center) {
    q.set('location', `${p.center.name}, ${p.center.country}`);
    q.set('distance', String(Math.max(5, Math.round(s.radiusKm * 0.621)))); // LinkedIn takes miles
  } else q.set('location', s.scope === 'remote' ? 'Worldwide' : 'India');
  q.set('f_TPR', `r${s.postedWithinDays * 86400}`);
  q.set('f_JT', s.jobType === 'internship' ? 'I' : s.jobType === 'fulltime' ? 'F' : 'F,I');
  const modes = s.scope === 'remote' ? ['remote'] : s.workModes;
  q.set('f_WT', modes.map((m) => ({ onsite: '1', remote: '2', hybrid: '3' })[m]).join(','));
  const exp = { fresher: '1,2', '0-2': '2', '2-5': '3,4', '5+': '4,5' }[s.experience];
  if (exp && s.jobType !== 'internship') q.set('f_E', exp);
  return `${BASE}?${q}`;
}

/** Job cards from the guest endpoint's HTML. */
export function parseLinkedInCards(html: string, now = Date.now()): RawJob[] {
  const doc = new DOMParser().parseFromString(`<ul>${html}</ul>`, 'text/html');
  const out: RawJob[] = [];
  for (const card of Array.from(doc.querySelectorAll('[data-entity-urn*="jobPosting"]'))) {
    const id = card.getAttribute('data-entity-urn')!.split(':').pop()!;
    const text = (sel: string) => (card.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
    const title = text('.base-search-card__title');
    const company = text('.base-search-card__subtitle').replace(/,$/, '');
    const location = text('.job-search-card__location');
    const time = card.querySelector('time');
    // The relative text ("3 hours ago") is more precise than the date-only datetime attribute.
    const postedAt = parsePostedDate(time?.textContent?.trim(), now) ?? (time?.getAttribute('datetime') ? Date.parse(time.getAttribute('datetime')!) : undefined);
    if (!id || !title) continue;
    out.push({
      source: 'linkedin',
      sourceId: id,
      sourceLabel: 'LinkedIn',
      title,
      company,
      location,
      remote: /remote/i.test(location),
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      postedAt,
      salary: text('.job-search-card__salary-info') || undefined,
      tags: [],
      internship: INTERN_WORDS.test(title) || undefined,
      applyVia: 'linkedin',
    });
  }
  return out;
}

export async function searchLinkedIn(p: MatchProfile, host: SearchHost): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const [qi, keywords] of p.queries.slice(0, 3).entries()) {
    for (const start of [0, 10]) {
      if (qi || start) await sleep(2500);
      const res = await host.fetchText(linkedInSearchUrl(p, keywords, start), { credentials: 'omit' });
      if (res.status === 429 || res.status === 999) throw new SourceBlocked('LinkedIn is limiting requests from this connection; it will retry later.');
      if (!res.ok) break;
      const jobs = parseLinkedInCards(res.text);
      out.push(...jobs.map((j) => (p.search.jobType === 'internship' ? { ...j, internship: true } : j)));
      if (jobs.length < 10) break;
    }
  }
  return out;
}
