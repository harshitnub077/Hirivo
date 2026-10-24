// Discover: pulls jobs from LinkedIn, Naukri, Indeed, Internshala, Unstop, company boards and the
// public remote boards, filters them to the user's search (role, internship or job, place and
// radius, how recent), scores them and keeps a local feed. Sources are cached per search and paced.
import { db, DiscoveredJob, JobSource, SearchProfile, UserSettings } from '../../db';
import { getSettings } from '../../db/settings';
import { matchesTargets } from '../watchlist';
import { cleanTargets } from '../targets';
import { fetchArbeitnow, fetchHimalayas, fetchJobicy, fetchRemoteOk, fetchRemotive } from './boards';
import { fetchHn } from './hn';
import { fetchYc } from './yc';
import { scoreJob } from './rank';
import { cityOf } from './geo';
import { searchLinkedIn } from './sources/linkedin';
import { searchInternshala } from './sources/internshala';
import { searchUnstop } from './sources/unstop';
import { searchIndeed, searchNaukri } from './sources/portals';
import { SourceBlocked, type MatchProfile, type RawJob, type SearchHost } from './types';

export type { MatchProfile, RawJob, SearchHost } from './types';

const HOUR = 3_600_000;

interface Source {
  id: JobSource;
  label: string;
  site: string;
  every: number;
  /** Reads pages through the browser (fetch or a background tab), so it needs a SearchHost. */
  needsHost?: boolean;
  /** Only worth asking when the search allows remote work. */
  remoteOnly?: boolean;
  fetch: (p: MatchProfile, host?: SearchHost) => Promise<RawJob[]>;
}

// Order matters for de-duplication: direct company boards first, then the job sites.
export const SOURCES: Source[] = [
  { id: 'watchlist', label: 'Your watchlist', site: '', every: 0, fetch: () => fetchWatchlistRoles() },
  { id: 'yc', label: 'YC startups', site: 'https://www.ycombinator.com/companies', every: 12 * HOUR, fetch: (p) => fetchYc(p) },
  { id: 'linkedin', label: 'LinkedIn', site: 'https://www.linkedin.com/jobs', every: 2 * HOUR, needsHost: true, fetch: (p, h) => searchLinkedIn(p, h!) },
  { id: 'naukri', label: 'Naukri', site: 'https://www.naukri.com', every: 3 * HOUR, needsHost: true, fetch: (p, h) => searchNaukri(p, h!) },
  { id: 'indeed', label: 'Indeed', site: 'https://in.indeed.com', every: 3 * HOUR, needsHost: true, fetch: (p, h) => searchIndeed(p, h!) },
  { id: 'internshala', label: 'Internshala', site: 'https://internshala.com', every: 3 * HOUR, needsHost: true, fetch: (p, h) => searchInternshala(p, h!) },
  { id: 'unstop', label: 'Unstop', site: 'https://unstop.com', every: 6 * HOUR, needsHost: true, fetch: (p, h) => searchUnstop(p, h!) },
  { id: 'hn', label: 'HN Who is hiring', site: 'https://news.ycombinator.com', every: 12 * HOUR, fetch: () => fetchHn() },
  { id: 'remotive', label: 'Remotive', site: 'https://remotive.com', every: 6 * HOUR, remoteOnly: true, fetch: () => fetchRemotive() },
  { id: 'remoteok', label: 'Remote OK', site: 'https://remoteok.com', every: 6 * HOUR, remoteOnly: true, fetch: () => fetchRemoteOk() },
  { id: 'himalayas', label: 'Himalayas', site: 'https://himalayas.app', every: 6 * HOUR, remoteOnly: true, fetch: (p) => fetchHimalayas(p.targets) },
  { id: 'jobicy', label: 'Jobicy', site: 'https://jobicy.com', every: 6 * HOUR, remoteOnly: true, fetch: () => fetchJobicy() },
  { id: 'arbeitnow', label: 'Arbeitnow', site: 'https://www.arbeitnow.com', every: 6 * HOUR, remoteOnly: true, fetch: () => fetchArbeitnow() },
];

async function fetchWatchlistRoles(): Promise<RawJob[]> {
  const companies = await db.watchlist.toArray();
  return companies.flatMap((c) =>
    c.roles.map((r) => ({
      source: 'watchlist' as const,
      sourceId: `${c.id}:${r.id}`,
      sourceLabel: `${c.name} board`,
      title: r.title,
      company: c.name,
      location: r.location,
      remote: /remote/i.test(r.location),
      url: r.url,
      postedAt: r.publishedAt ? Date.parse(r.publishedAt) : undefined,
      tags: [],
      applyVia: 'ats' as const,
    }))
  );
}

/** The user's search, with defaults from their profile for anything not set yet. */
export function searchDefaults(s: UserSettings): SearchProfile {
  const level = (s.suggestedRoles || []).find((r) => (s.chosenRoles || []).includes(r.title))?.level;
  const city = cityOf(s.preferredLocation || '');
  const legacy = s.locationPreference;
  return {
    jobType: level === 'intern' ? 'internship' : 'both',
    workModes: ['onsite', 'hybrid', 'remote'],
    experience: level === 'intern' || level === 'entry' ? 'fresher' : level === 'senior' ? '5+' : '0-2',
    city: city?.name || '',
    scope: legacy === 'remote' ? 'remote' : city ? 'radius' : 'india',
    radiusKm: 25,
    postedWithinDays: 7,
    ...s.search,
  };
}

/** What to type into job-site search boxes: the chosen role titles, without level words. */
export function searchQueries(s: UserSettings, search: SearchProfile): string[] {
  const titles = (s.chosenRoles || []).map((t) => t.replace(/\b(senior|sr\.?|junior|jr\.?|lead|staff|principal|intern(ship)?)\b/gi, '').replace(/\s+/g, ' ').trim());
  const fallback = cleanTargets(s.targetRoles).filter((t) => t.includes(' ') || t.length > 3);
  const base = Array.from(new Set([...titles, ...fallback].filter(Boolean))).slice(0, 3);
  const qs = base.length ? base : ['software engineer'];
  return search.jobType === 'internship' ? qs.map((q) => `${q} intern`) : qs;
}

export async function getMatchProfile(): Promise<MatchProfile> {
  const s = await getSettings();
  const chosen = new Set(s.chosenRoles || []);
  const level = (s.suggestedRoles || []).find((r) => chosen.has(r.title))?.level;
  const search = searchDefaults(s);
  const center = cityOf(search.city);
  return {
    targets: cleanTargets(s.targetRoles),
    queries: searchQueries(s, search),
    skills: (s.skills || []).map((x) => x.toLowerCase()),
    level,
    locationPreference: search.scope === 'remote' ? 'remote' : search.scope === 'india' ? 'india' : 'india',
    smallTeamsOnly: Boolean(s.smallTeamsOnly),
    search,
    center,
  };
}

const cacheKey = (id: JobSource) => `discover:${id}`;
/** A source's cached results are only reused for the same search. */
const searchKey = (p: MatchProfile) => JSON.stringify([p.queries, p.search, p.locationPreference]);

async function loadSource(src: Source, profile: MatchProfile, force: boolean, host?: SearchHost): Promise<RawJob[]> {
  const hasStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;
  const cached = hasStorage ? (await chrome.storage.local.get(cacheKey(src.id)))[cacheKey(src.id)] : undefined;
  const fresh = cached && cached.pref === searchKey(profile) && Date.now() - cached.at < src.every;
  if (fresh && !force) return cached.jobs;
  try {
    const jobs = await src.fetch(profile, host);
    if (hasStorage && src.every > 0) await chrome.storage.local.set({ [cacheKey(src.id)]: { at: Date.now(), pref: searchKey(profile), jobs } });
    await db.sourceFetches.put({ id: src.id, fetchedAt: Date.now(), count: jobs.length });
    return jobs;
  } catch (err: any) {
    await db.sourceFetches.put({ id: src.id, fetchedAt: Date.now(), count: 0, error: err instanceof SourceBlocked ? `Blocked: ${err.message}` : err.message });
    return cached?.jobs || [];
  }
}

/** The same job on several sites: same company, same title, same city (or remote). */
const roleKey = (j: Pick<RawJob, 'company' | 'title'>) => `${j.company}|${j.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');
export const dedupeKey = (j: Pick<RawJob, 'company' | 'title' | 'location' | 'remote'>) => {
  const place = cityOf(j.location)?.name || (j.remote ? 'remote' : j.location.split(/[,(]/)[0]);
  return `${roleKey(j)}|${place.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
};

export interface DiscoverResult {
  added: number;
  total: number;
  newTopMatches: DiscoveredJob[];
}

// Which copy of a duplicated job to keep: the company's own board first, then the copy with the
// clearest way to apply (LinkedIn links out to company sites; Internshala and Naukri apply in place).
const SOURCE_RANK: Partial<Record<JobSource, number>> = { watchlist: 0, yc: 0, linkedin: 1, internshala: 2, naukri: 3, indeed: 4, unstop: 5, hn: 6 };
const rankOf = (s: JobSource) => SOURCE_RANK[s] ?? 7;

function toRow(raw: RawJob, result: { score: number; reasons: string[]; distanceKm?: number }, prev: DiscoveredJob | undefined, now: number): DiscoveredJob {
  return {
    id: `${raw.source}:${raw.sourceId}`,
    source: raw.source,
    sourceLabel: raw.sourceLabel,
    sourceUrl: raw.sourceUrl,
    kind: raw.kind || 'job',
    title: raw.title,
    company: raw.company,
    location: raw.location,
    remote: raw.remote,
    url: raw.url,
    postedAt: raw.postedAt,
    salary: raw.salary,
    tags: raw.tags.slice(0, 8),
    snippet: raw.snippet?.slice(0, 400),
    teamSize: raw.teamSize,
    smallTeamReason: raw.smallTeamReason,
    internship: raw.internship,
    distanceKm: result.distanceKm,
    applyVia: raw.applyVia,
    score: result.score,
    matchReasons: result.reasons,
    status: prev?.status || 'new',
    firstSeenAt: prev?.firstSeenAt || now,
    appliedAt: prev?.appliedAt,
    nudgedAt: prev?.nudgedAt,
  };
}

/**
 * Runs in two phases so results appear fast: the job sites and public feeds first, then YC startup
 * boards (which need many small lookups). When the same job appears twice, the better copy wins.
 * Without a `host` (no browser to read pages with), the job-site sources are skipped.
 */
export async function runDiscover({ force = false, host }: { force?: boolean; host?: SearchHost } = {}): Promise<DiscoverResult> {
  const profile = await getMatchProfile();
  const existing = new Map((await db.discovered.toArray()).map((j) => [j.id, j]));
  const now = Date.now();
  const byKey = new Map<string, DiscoveredJob>();
  // The same role in two different cities is two jobs; a copy with no city ("Worldwide", "Remote")
  // is the same job as any city's copy.
  const placed = (j: Pick<RawJob, 'location'>) => !!cityOf(j.location);
  const sameJob = (raw: RawJob, key: string) =>
    byKey.get(key) ?? [...byKey.values()].find((r) => roleKey(r) === roleKey(raw) && (!placed(r) || !placed(raw)));

  const ingest = async (raws: RawJob[]) => {
    const replaced: string[] = [];
    const rows: DiscoveredJob[] = [];
    for (const raw of raws) {
      if (!raw.title || !raw.company || !raw.url) continue;
      const key = dedupeKey(raw);
      const have = sameJob(raw, key);
      if (have && rankOf(raw.source) >= rankOf(have.source)) continue;
      const result = scoreJob(raw, profile, now);
      if (!result || result.score < 25) continue;
      const row = toRow(raw, result, existing.get(`${raw.source}:${raw.sourceId}`), now);
      if (have) {
        replaced.push(have.id);
        byKey.delete(dedupeKey(have));
      }
      byKey.set(key, row);
      rows.push(row);
    }
    await db.transaction('rw', db.discovered, async () => {
      // Never drop something the user acted on, even if a better copy turned up.
      await db.discovered.bulkDelete(replaced.filter((id) => (existing.get(id)?.status || 'new') === 'new'));
      await db.discovered.bulkPut(rows);
    });
  };

  const allowsRemote = profile.search.scope === 'remote' || profile.search.workModes.includes('remote');
  const usable = SOURCES.filter((s) => (!s.needsHost || host) && (!s.remoteOnly || allowsRemote));
  const quick = usable.filter((s) => s.id !== 'yc');
  const slow = usable.filter((s) => s.id === 'yc');
  // Best sources first, so their copy of a duplicate is the one kept.
  const byRank = <T extends { source: JobSource }>(xs: T[]) => [...xs].sort((a, b) => rankOf(a.source) - rankOf(b.source));
  await ingest(byRank((await Promise.all(quick.map((s) => loadSource(s, profile, force, host)))).flat()));
  await ingest(byRank((await Promise.all(slow.map((s) => loadSource(s, profile, force, host)))).flat()));

  // Replace the untouched "new" feed with this run; keep anything the user acted on.
  const keepIds = new Set([...byKey.values()].map((j) => j.id));
  const stale = [...existing.values()].filter((j) => j.status === 'new' && !keepIds.has(j.id)).map((j) => j.id);
  await db.discovered.bulkDelete(stale);

  const all = [...byKey.values()];
  const added = all.filter((j) => !existing.has(j.id));
  return {
    added: added.length,
    total: all.length,
    newTopMatches: added.filter((j) => j.kind === 'job' && j.score >= 60 && matchesTargets(j.title, profile.targets)).sort((a, b) => b.score - a.score),
  };
}

/** Jobs the user saves from a search page they are viewing (LinkedIn, Naukri, Indeed…). */
export async function savePageJobs(jobs: RawJob[]): Promise<number> {
  const profile = await getMatchProfile();
  const now = Date.now();
  const existing = new Map((await db.discovered.bulkGet(jobs.map((j) => `page:${j.sourceId}`))).filter(Boolean).map((j) => [j!.id, j!]));
  const rows: DiscoveredJob[] = jobs.map((raw) => {
    const result = scoreJob(raw, { ...profile, locationPreference: 'anywhere', targets: [] }, now);
    const prev = existing.get(`page:${raw.sourceId}`);
    return {
      id: `page:${raw.sourceId}`,
      source: 'page',
      sourceLabel: raw.sourceLabel,
      kind: 'job',
      title: raw.title,
      company: raw.company,
      location: raw.location,
      remote: raw.remote,
      url: raw.url,
      postedAt: raw.postedAt,
      tags: [],
      score: result?.score ?? 30,
      matchReasons: result?.reasons ?? [],
      // Saving the same search page again must not undo "applied" on a job from it.
      status: prev && prev.status !== 'new' && prev.status !== 'dismissed' ? prev.status : 'saved',
      firstSeenAt: prev?.firstSeenAt || now,
      appliedAt: prev?.appliedAt,
      nudgedAt: prev?.nudgedAt,
    };
  });
  await db.discovered.bulkPut(rows);
  return rows.length;
}

export async function setJobStatus(id: string, status: DiscoveredJob['status']) {
  await db.discovered.update(id, { status, ...(status === 'applied' ? { appliedAt: Date.now() } : {}) });
}
