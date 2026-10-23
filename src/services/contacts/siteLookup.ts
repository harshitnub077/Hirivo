// Reads a company's own site (with the user's OK) for people, hiring inboxes, its GitHub org
// and its blog feed. Static pages only; for sites that render people with JavaScript, the user
// can open the page and use scanRenderedPage instead.
import { cached, fetchText } from '../siteAccess';
import { fetchOrgMembers, GithubMember, resolveOrg } from './github';
import { PageScan, scanPage, TeamPerson } from './teamPage';

export interface SiteLookup {
  domain: string;
  people: TeamPerson[];
  inboxes: string[];
  githubOrg?: string;
  githubMembers: GithubMember[];
  feedUrl?: string;
  pagesChecked: string[];
  checkedAt: number;
}

const TEAM_PATHS = ['/about', '/team', '/about-us', '/people', '/company', '/leadership'];
const WEEK = 7 * 86_400_000;

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

export function mergeScans(into: PageScan, scan: PageScan) {
  const known = new Set(into.people.map((p) => p.name.toLowerCase()));
  into.people.push(...scan.people.filter((p) => !known.has(p.name.toLowerCase())));
  into.inboxes = Array.from(new Set([...into.inboxes, ...scan.inboxes]));
  into.githubOrg ||= scan.githubOrg;
  into.feedUrl ||= scan.feedUrl;
}

export async function lookupCompanySite(domain: string, company: string, { force = false } = {}): Promise<SiteLookup> {
  return cached(
    `site:${domain}`,
    WEEK,
    async () => {
      const base = `https://${domain}`;
      const total: PageScan = { people: [], inboxes: [] };
      const pagesChecked: string[] = [];

      const home = await fetchText(base);
      if (home.ok) {
        pagesChecked.push('/');
        mergeScans(total, scanPage(parse(home.text), company, domain, '/'));
      }
      for (const path of TEAM_PATHS) {
        if (total.people.length >= 3 || pagesChecked.length >= 5) break;
        const page = await fetchText(base + path);
        if (!page.ok || !/html/i.test(page.type)) continue;
        pagesChecked.push(path);
        mergeScans(total, scanPage(parse(page.text), company, domain, path));
      }

      const githubOrg = await resolveOrg([total.githubOrg, domain.split('.')[0]]).catch(() => undefined);
      const githubMembers = githubOrg ? await fetchOrgMembers(githubOrg).catch(() => []) : [];
      const feedUrl = total.feedUrl ? new URL(total.feedUrl, base).toString() : undefined;

      return { domain, people: total.people, inboxes: total.inboxes, githubOrg, githubMembers, feedUrl, pagesChecked, checkedAt: Date.now() };
    },
    { force }
  );
}

/** Adds people from a page the user has open (rendered by JavaScript) to a lookup. */
export function addRenderedPage(lookup: SiteLookup, html: string, company: string, pageUrl: string): SiteLookup {
  const path = (() => {
    try {
      return new URL(pageUrl).pathname || '/';
    } catch {
      return pageUrl;
    }
  })();
  const total: PageScan = { people: [...lookup.people], inboxes: [...lookup.inboxes], githubOrg: lookup.githubOrg, feedUrl: lookup.feedUrl };
  mergeScans(total, scanPage(parse(html), company, lookup.domain, path));
  return { ...lookup, people: total.people, inboxes: total.inboxes, pagesChecked: Array.from(new Set([...lookup.pagesChecked, path])) };
}
