// Public, keyless job-board feeds. Field names were checked against live responses:
//   Greenhouse: jobs[].{id,title,location.name,absolute_url,first_published,updated_at}
//   Lever:      [].{id,text,categories.location,hostedUrl,createdAt(ms)}
//   Ashby:      jobs[].{id,title,location,jobUrl,publishedAt,isListed}
import type { WatchedRole, WatchlistCompany } from '../db';

export type AtsType = WatchlistCompany['ats'];

export interface AtsRef {
  ats: AtsType;
  slug: string;
}

export function parseAtsUrl(raw: string | undefined): AtsRef | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const first = url.pathname.split('/').filter(Boolean)[0];

  if (host.endsWith('greenhouse.io')) {
    const embedded = url.searchParams.get('for');
    if (embedded) return { ats: 'greenhouse', slug: embedded };
    if (first && first !== 'embed') return { ats: 'greenhouse', slug: first };
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    if (first) return { ats: 'lever', slug: first };
  }
  if (host === 'jobs.ashbyhq.com' && first) return { ats: 'ashby', slug: first };
  return null;
}

const FEEDS: Record<AtsType, (slug: string) => string> = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`,
  lever: (slug) => `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
};

export function boardUrl({ ats, slug }: AtsRef): string {
  if (ats === 'greenhouse') return `https://job-boards.greenhouse.io/${slug}`;
  if (ats === 'lever') return `https://jobs.lever.co/${slug}`;
  return `https://jobs.ashbyhq.com/${slug}`;
}

/** Returns null when the board does not exist (so callers can tell "no board" from "no roles"). */
export async function fetchRoles({ ats, slug }: AtsRef): Promise<WatchedRole[] | null> {
  const res = await fetch(FEEDS[ats](slug));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${ats} feed returned ${res.status}`);
  const data = await res.json();

  if (ats === 'greenhouse') {
    if (!Array.isArray(data.jobs)) return null;
    return data.jobs.map((j: any) => ({
      id: String(j.id),
      title: j.title || '',
      location: j.location?.name || '',
      url: j.absolute_url,
      publishedAt: j.first_published || j.updated_at,
    }));
  }
  if (ats === 'lever') {
    if (!Array.isArray(data)) return null;
    return data.map((j: any) => ({
      id: String(j.id),
      title: j.text || '',
      location: j.categories?.location || '',
      url: j.hostedUrl,
      publishedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
    }));
  }
  if (!Array.isArray(data.jobs)) return null;
  return data.jobs
    .filter((j: any) => j.isListed !== false)
    .map((j: any) => ({
      id: String(j.id),
      title: j.title || '',
      location: j.location || '',
      url: j.jobUrl,
      publishedAt: j.publishedAt,
    }));
}

const normalizeTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\b(sr|snr)\b/g, 'senior')
    .trim();

/** Finds the posting on the company's own board that corresponds to a job seen elsewhere. */
export function findMatchingRole(roles: WatchedRole[], title: string, pageUrl?: string): WatchedRole | undefined {
  // Only an ATS link carries the board's own job id; elsewhere (a LinkedIn id) digits can collide.
  if (pageUrl && /^https?:\/\//.test(pageUrl) && parseAtsUrl(pageUrl)) {
    const segments = new URL(pageUrl).pathname.split('/');
    const byUrl = roles.find((r) => r.url === pageUrl || segments.includes(r.id));
    if (byUrl) return byUrl;
  }
  const target = normalizeTitle(title);
  if (!target) return undefined;
  return (
    roles.find((r) => normalizeTitle(r.title) === target) ||
    roles.find((r) => {
      const t = normalizeTitle(r.title);
      return t.length > 4 && (t.includes(target) || target.includes(t));
    })
  );
}

export function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
