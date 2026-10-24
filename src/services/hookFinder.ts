// Hook Finder: real, recent, linkable reasons to write today. Every hook has a source URL and a
// date within the last 90 days, or it is dropped. Hirivo never invents an opening line.
// Sources: the company blog feed, GitHub releases, Hacker News (Algolia API) and Google News RSS.
// Google News' feed terms allow personal, non-commercial reading; Hirivo fetches it from the
// user's own browser for that user. A paid tier would need a licensed news API instead.
import { cached, fetchText } from './siteAccess';

export interface Hook {
  id: string;
  source: 'blog' | 'github' | 'hn' | 'news';
  sourceLabel: string;
  title: string;
  url: string;
  date: number;
  suggestion: string; // what goes into the hook field
}

export const HOOK_MAX_AGE_DAYS = 90;
const DAY = 86_400_000;
const FEED_FALLBACKS = ['/rss.xml', '/blog/rss.xml', '/blog/feed/', '/feed'];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface FeedItem {
  title: string;
  url: string;
  date?: number;
}

/** Parses RSS 2.0 or Atom. Exported for tests. */
export function parseFeed(xml: string, limit = 15): FeedItem[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const items = Array.from(doc.querySelectorAll('item, entry')).slice(0, limit);
  return items
    .map((item) => {
      const text = (sel: string) => item.getElementsByTagName(sel)[0]?.textContent || '';
      const linkEl = Array.from(item.getElementsByTagName('link')).find((l) => !l.getAttribute('rel') || l.getAttribute('rel') === 'alternate');
      const url = clean(linkEl?.getAttribute('href') || linkEl?.textContent || text('guid'));
      const rawDate = text('pubDate') || text('published') || text('updated') || text('dc:date');
      const date = rawDate ? Date.parse(rawDate) : NaN;
      return { title: clean(text('title')), url, date: Number.isNaN(date) ? undefined : date };
    })
    .filter((i) => i.title && /^https?:\/\//.test(i.url));
}

const mentions = (title: string, company: string) =>
  new RegExp(`(^|[^a-z0-9])${company.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(title.toLowerCase());

export async function blogHooks(domain: string, feedUrl?: string): Promise<Hook[]> {
  const candidates = [feedUrl, ...FEED_FALLBACKS.map((p) => `https://${domain}${p}`)].filter(Boolean) as string[];
  for (const url of candidates) {
    const res = await fetchText(url, { maxChars: 4_000_000 });
    if (!res.ok || !/<(rss|feed)[\s>]/i.test(res.text.slice(0, 2000))) continue;
    return parseFeed(res.text)
      .filter((i) => i.date)
      .map((i) => ({
        id: `blog:${i.url}`,
        source: 'blog' as const,
        sourceLabel: `${domain} blog`,
        title: i.title,
        url: i.url,
        date: i.date!,
        suggestion: `Your post “${i.title}”`,
      }));
  }
  return [];
}

export async function githubHooks(org: string, now = Date.now()): Promise<Hook[]> {
  const repos = (await (await fetch(`https://api.github.com/orgs/${encodeURIComponent(org)}/repos?sort=pushed&per_page=10`)).json()) as any[];
  if (!Array.isArray(repos)) return [];
  const top = repos
    .filter((r) => !r.fork && !r.archived && now - Date.parse(r.pushed_at) < HOOK_MAX_AGE_DAYS * DAY)
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 3);
  const lists = await Promise.all(
    top.map(async (r) => {
      const rel = (await (await fetch(`https://api.github.com/repos/${r.full_name}/releases?per_page=2`)).json()) as any[];
      return (Array.isArray(rel) ? rel : [])
        .filter((x) => !x.draft && !x.prerelease && x.published_at)
        .map(
          (x): Hook => ({
            id: `gh:${x.html_url}`,
            source: 'github',
            sourceLabel: `GitHub · ${r.name}`,
            title: `${r.name} ${x.tag_name}${x.name && x.name !== x.tag_name ? `: ${x.name}` : ''}`,
            url: x.html_url,
            date: Date.parse(x.published_at),
            suggestion: `The ${x.tag_name} release of ${r.name}`,
          })
        );
    })
  );
  return lists.flat();
}

const STOP = new Set('about after again against their there these those which while would could should other where being every under above below between through during before because company companies people world today latest newest years month across within'.split(' '));
const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);

/** Words that describe what the company does (from its homepage and the job), to tell it apart from namesakes. */
export function contextTerms(text: string, company: string): Set<string> {
  const own = new Set(company.toLowerCase().split(/\s+/).map(stem));
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) || []) {
    if (STOP.has(w)) continue;
    const k = stem(w);
    if (own.has(k)) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k]) => k));
}

/** A third-party headline counts only if it names the company AND shares a word of its context.
 * Stops "Ross Atlan releases debut single" from being a hook for Atlan the data company. */
export function aboutCompany(title: string, company: string, terms: Set<string>): boolean {
  if (!mentions(title, company)) return false;
  if (terms.size === 0) return true;
  return (title.toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) || []).some((w) => terms.has(stem(w)));
}

/** "Show HN: Atlan, my AI agent" is someone's project named Atlan, unless it links to the company's own site. */
export function hnPostIsCompany(title: string, url: string | undefined, domain?: string): boolean {
  if (!/^(?:show|launch) hn\b/i.test(title)) return true;
  if (!url || !domain) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

export async function hnHooks(company: string, terms: Set<string> = new Set(), domain?: string): Promise<Hook[]> {
  const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(`"${company}"`)}&tags=story&hitsPerPage=20`);
  if (!res.ok) return [];
  return ((await res.json()).hits || [])
    .filter((h: any) => h.title && aboutCompany(h.title, company, terms) && hnPostIsCompany(h.title, h.url, domain))
    .map(
      (h: any): Hook => ({
        id: `hn:${h.objectID}`,
        source: 'hn',
        sourceLabel: 'Hacker News',
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        date: Date.parse(h.created_at),
        suggestion: `“${h.title}” on Hacker News`,
      })
    );
}

export async function newsHooks(company: string, terms: Set<string> = new Set()): Promise<Hook[]> {
  const res = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${company}"`)}&hl=en-IN&gl=IN&ceid=IN:en`);
  if (!res.ok) return [];
  return parseFeed(res.text, 20)
    .filter((i) => i.date && aboutCompany(i.title, company, terms))
    .map((i) => {
      const [headline, publisher] = i.title.split(/\s+-\s+(?=[^-]+$)/);
      return {
        id: `news:${i.url}`,
        source: 'news' as const,
        sourceLabel: publisher ? `News · ${publisher}` : 'News',
        title: headline || i.title,
        url: i.url,
        date: i.date!,
        suggestion: `${publisher ? `${publisher}'s` : 'The'} story “${headline || i.title}”`,
      };
    });
}

/** Keeps only dated, linked, recent hooks, newest first, without near-duplicate titles. */
export function selectHooks(hooks: Hook[], now = Date.now()): Hook[] {
  const seen = new Set<string>();
  return hooks
    .filter((h) => /^https?:\/\//.test(h.url) && Number.isFinite(h.date) && h.date <= now + DAY && now - h.date <= HOOK_MAX_AGE_DAYS * DAY)
    .sort((a, b) => b.date - a.date)
    .filter((h) => {
      const key = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function findHooks(
  input: { company: string; domain?: string; githubOrg?: string; feedUrl?: string; siteAllowed: boolean; context?: string },
  { force = false } = {}
): Promise<Hook[]> {
  return cached(
    `hooks:v3:${input.company.toLowerCase()}:${input.domain || ''}`,
    12 * 3_600_000,
    async () => {
      // News and HN are third-party: keep only headlines that match what this company does.
      const terms = contextTerms(input.context || '', input.company);
      const jobs: Promise<Hook[]>[] = [hnHooks(input.company, terms, input.domain), newsHooks(input.company, terms)];
      if (input.domain && input.siteAllowed) jobs.push(blogHooks(input.domain, input.feedUrl));
      if (input.githubOrg) jobs.push(githubHooks(input.githubOrg));
      const results = await Promise.all(jobs.map((j) => j.catch(() => [] as Hook[])));
      return selectHooks(results.flat());
    },
    { force }
  );
}

export function hookForWriter(h: Hook): string {
  const when = new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${h.suggestion} (${when}). Source: ${h.url}`;
}
