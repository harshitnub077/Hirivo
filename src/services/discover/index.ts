// Discover: pulls jobs from every free public source, scores them for the user, and keeps a
// local feed. Sources are cached so each is called a few times a day at most.
import { db, DiscoveredJob, JobSource } from '../../db';
import { getSettings } from '../../db/settings';
import { matchesTargets } from '../watchlist';
import { fetchArbeitnow, fetchHimalayas, fetchJobicy, fetchRemoteOk, fetchRemotive } from './boards';
import { fetchHn } from './hn';
import { fetchYc } from './yc';
import { scoreJob } from './rank';
import type { MatchProfile, RawJob } from './types';

export type { MatchProfile, RawJob } from './types';

const HOUR = 3_600_000;

// Order matters for de-duplication: direct company boards first, aggregators after.
export const SOURCES: { id: JobSource; label: string; site: string; every: number; fetch: (p: MatchProfile) => Promise<RawJob[]> }[] = [
  { id: 'watchlist', label: 'Your watchlist', site: '', every: 0, fetch: () => fetchWatchlistRoles() },
  { id: 'yc', label: 'YC startups', site: 'https://www.ycombinator.com/companies', every: 12 * HOUR, fetch: (p) => fetchYc(p) },
  { id: 'hn', label: 'HN Who is hiring', site: 'https://news.ycombinator.com', every: 12 * HOUR, fetch: () => fetchHn() },
  { id: 'remotive', label: 'Remotive', site: 'https://remotive.com', every: 6 * HOUR, fetch: () => fetchRemotive() },
  { id: 'remoteok', label: 'Remote OK', site: 'https://remoteok.com', every: 6 * HOUR, fetch: () => fetchRemoteOk() },
  { id: 'himalayas', label: 'Himalayas', site: 'https://himalayas.app', every: 6 * HOUR, fetch: (p) => fetchHimalayas(p.targets) },
  { id: 'jobicy', label: 'Jobicy', site: 'https://jobicy.com', every: 6 * HOUR, fetch: () => fetchJobicy() },
  { id: 'arbeitnow', label: 'Arbeitnow', site: 'https://www.arbeitnow.com', every: 6 * HOUR, fetch: () => fetchArbeitnow() },
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
    }))
  );
}

export async function getMatchProfile(): Promise<MatchProfile> {
  const s = await getSettings();
  const chosen = new Set(s.chosenRoles || []);
  const level = (s.suggestedRoles || []).find((r) => chosen.has(r.title))?.level;
  return {
    targets: (s.targetRoles || []).map((t) => t.toLowerCase().trim()).filter(Boolean),
    skills: (s.skills || []).map((x) => x.toLowerCase()),
    level,
    locationPreference: s.locationPreference || 'india',
    smallTeamsOnly: Boolean(s.smallTeamsOnly),
  };
}

const cacheKey = (id: JobSource) => `discover:${id}`;

async function loadSource(src: (typeof SOURCES)[number], profile: MatchProfile, force: boolean): Promise<RawJob[]> {
  const hasStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;
  const cached = hasStorage ? (await chrome.storage.local.get(cacheKey(src.id)))[cacheKey(src.id)] : undefined;
  // YC depends on the location preference, so its cache is per preference.
  const fresh = cached && cached.pref === profile.locationPreference && Date.now() - cached.at < src.every;
  if (fresh && !force) return cached.jobs;
  try {
    const jobs = await src.fetch(profile);
    if (hasStorage && src.every > 0) await chrome.storage.local.set({ [cacheKey(src.id)]: { at: Date.now(), pref: profile.locationPreference, jobs } });
    await db.sourceFetches.put({ id: src.id, fetchedAt: Date.now(), count: jobs.length });
    return jobs;
  } catch (err: any) {
    await db.sourceFetches.put({ id: src.id, fetchedAt: Date.now(), count: 0, error: err.message });
    return cached?.jobs || [];
  }
}

const dedupeKey = (j: RawJob) => `${j.company}|${j.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');

export interface DiscoverResult {
  added: number;
  total: number;
  newTopMatches: DiscoveredJob[];
}

export async function runDiscover({ force = false } = {}): Promise<DiscoverResult> {
  const profile = await getMatchProfile();
  const batches = await Promise.all(SOURCES.map((s) => loadSource(s, profile, force)));

  const seen = new Set<string>();
  const scored: DiscoveredJob[] = [];
  const existing = new Map((await db.discovered.toArray()).map((j) => [j.id, j]));
  const now = Date.now();

  for (const raw of batches.flat()) {
    if (!raw.title || !raw.company || !raw.url) continue;
    const key = dedupeKey(raw);
    if (seen.has(key)) continue;
    const result = scoreJob(raw, profile, now);
    if (!result || result.score < 25) continue;
    seen.add(key);
    const id = `${raw.source}:${raw.sourceId}`;
    const prev = existing.get(id);
    scored.push({
      id,
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
      score: result.score,
      matchReasons: result.reasons,
      status: prev?.status || 'new',
      firstSeenAt: prev?.firstSeenAt || now,
      appliedAt: prev?.appliedAt,
    });
  }

  // Keep anything the user acted on; replace the untouched "new" feed with this run.
  const keepIds = new Set(scored.map((j) => j.id));
  const stale = [...existing.values()].filter((j) => j.status === 'new' && !keepIds.has(j.id)).map((j) => j.id);
  await db.transaction('rw', db.discovered, async () => {
    await db.discovered.bulkDelete(stale);
    await db.discovered.bulkPut(scored.map((j) => ({ ...j, status: existing.get(j.id)?.status || j.status })));
  });

  const added = scored.filter((j) => !existing.has(j.id));
  return {
    added: added.length,
    total: scored.length,
    newTopMatches: added.filter((j) => j.kind === 'job' && j.score >= 60 && matchesTargets(j.title, profile.targets)).sort((a, b) => b.score - a.score),
  };
}

/** Jobs the user saves from a search page they are viewing (LinkedIn, Naukri, Indeed…). */
export async function savePageJobs(jobs: RawJob[]): Promise<number> {
  const profile = await getMatchProfile();
  const now = Date.now();
  const rows: DiscoveredJob[] = jobs.map((raw) => {
    const result = scoreJob(raw, { ...profile, locationPreference: 'anywhere', targets: [] }, now);
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
      status: 'saved',
      firstSeenAt: now,
    };
  });
  await db.discovered.bulkPut(rows);
  return rows.length;
}

export async function setJobStatus(id: string, status: DiscoveredJob['status']) {
  await db.discovered.update(id, { status, ...(status === 'applied' ? { appliedAt: Date.now() } : {}) });
}
