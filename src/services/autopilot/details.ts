// What Autopilot needs to know about a posting before it acts: the full description, the page
// with the application form, and the company's own website. Public ATS APIs first; anything else
// is read from the page by the background worker.
import { parseAtsUrl } from '../atsFeeds';
import { htmlToText, decodeEntities } from '../discover/hn';
import { companyDomainOf, registrableDomain } from '../companyDomain';
import { fetchText } from '../siteAccess';

export interface PostingDetails {
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
  postedAt?: string;
}

/** The ATS job id in a posting URL: /jobs/123, ?gh_jid=123, or the path segment after the slug. */
export function atsJobId(url: string): string | undefined {
  try {
    const u = new URL(url);
    const gh = u.searchParams.get('gh_jid') || u.pathname.match(/\/jobs\/(\d+)/)?.[1];
    if (gh) return gh;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[1] && !/^(apply|application)$/.test(parts[1]) ? parts[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Greenhouse, Lever and Ashby postings, straight from their public APIs. */
export async function atsPosting(url: string): Promise<PostingDetails | null> {
  const ref = parseAtsUrl(url);
  const id = atsJobId(url);
  if (!ref || !id) return null;
  if (ref.ats === 'greenhouse') {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.slug)}/jobs/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const j = await res.json();
    return {
      title: j.title || '',
      company: j.company_name || '',
      location: j.location?.name || '',
      description: htmlToText(decodeEntities(String(j.content || ''))).slice(0, 12000),
      // The Greenhouse-hosted page always has the form, even when the company embeds it elsewhere.
      applyUrl: `https://job-boards.greenhouse.io/${ref.slug}/jobs/${id}`,
      postedAt: j.first_published || j.updated_at,
    };
  }
  if (ref.ats === 'lever') {
    const res = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(ref.slug)}/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const j = await res.json();
    const lists = (j.lists || []).map((l: any) => `${l.text}\n${htmlToText(String(l.content || ''))}`).join('\n');
    return {
      title: j.text || '',
      company: '',
      location: j.categories?.location || '',
      description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n').slice(0, 12000),
      applyUrl: j.applyUrl || `${j.hostedUrl}/apply`,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
    };
  }
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.slug)}`);
  if (!res.ok) return null;
  const j = ((await res.json()).jobs || []).find((x: any) => x.id === id || x.jobUrl === url || url.startsWith(x.jobUrl));
  if (!j) return null;
  return {
    title: j.title || '',
    company: '',
    location: j.location || '',
    description: String(j.descriptionPlain || htmlToText(String(j.descriptionHtml || ''))).slice(0, 12000),
    applyUrl: j.applyUrl || `${j.jobUrl}/application`,
    postedAt: j.publishedAt,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Domain guesses for a company name: "Acme Labs Pvt Ltd" → acmelabs.com, acme.com, acmelabs.in… */
export function domainGuesses(company: string): string[] {
  const words = company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|pvt|private|limited|corp|corporation|co|gmbh|technologies|technology|labs|software|solutions|india)\b\.?/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return [];
  const bases = Array.from(new Set([words.join(''), words[0], words.join('-')]));
  const tlds = ['com', 'io', 'ai', 'in', 'co', 'dev', 'app', 'tech'];
  return bases.flatMap((b) => tlds.map((t) => `${b}.${t}`)).slice(0, 18);
}

/** True when a homepage plainly belongs to the company (its name in the title or site name). */
export function homepageIsCompany(html: string, company: string): boolean {
  const name = norm(company.replace(/\b(inc|llc|ltd|pvt|private|limited)\b\.?/gi, ''));
  if (name.length < 2) return false;
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '';
  const site = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i)?.[1] || '';
  return norm(decodeEntities(`${title} ${site}`)).includes(name);
}

/**
 * The company's own website. Hints (a careers page, JSON-LD) are trusted when they aren't a job
 * board; otherwise common domains are tried and kept only if the homepage names the company.
 * Needs permission to read any site (Autopilot asks once).
 */
export async function findCompanyDomain(company: string, hints: (string | undefined)[] = [], fetcher = fetchText): Promise<string | undefined> {
  for (const h of hints) {
    const d = companyDomainOf(h);
    if (d) return registrableDomain(d);
  }
  for (const domain of domainGuesses(company)) {
    const res = await fetcher(`https://${domain}`, { timeoutMs: 6000, maxChars: 200_000 });
    if (res.ok && homepageIsCompany(res.text, company)) return registrableDomain(new URL(res.url || `https://${domain}`).hostname);
  }
  return undefined;
}
