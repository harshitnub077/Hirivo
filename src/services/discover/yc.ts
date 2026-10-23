// YC startups that say they are hiring (open dataset at yc-oss.github.io). For each one,
// Hirivo looks for a public Greenhouse, Lever or Ashby board and lists its real roles.
// Small teams here are the "underrated" companies: real, funded, and rarely flooded with applicants.
import { db } from '../../db';
import { fetchRoles } from '../atsFeeds';
import type { MatchProfile, RawJob } from './types';

interface YcCompany {
  name: string;
  slug: string;
  website: string;
  batch: string;
  teamSize: number;
  locations: string;
  regions: string[];
  oneLiner: string;
  industry: string;
  tags: string[];
}

const LIST_KEY = 'ycHiring';
const LIST_TTL = 7 * 86_400_000;
const PROBE_TTL = 14 * 86_400_000;
const PROBES_PER_RUN = 24;

const shortBatch = (b: string) => b.replace(/^(Winter|Summer|Fall|Spring|X)\s+(\d{2})(\d{2})$/, (_, s, __, y) => `${s[0]}${y}`);

async function loadList(): Promise<YcCompany[]> {
  const cached = typeof chrome !== 'undefined' && chrome.storage?.local ? (await chrome.storage.local.get(LIST_KEY))[LIST_KEY] : undefined;
  if (cached && Date.now() - cached.at < LIST_TTL) return cached.companies;
  const res = await fetch('https://yc-oss.github.io/api/companies/hiring.json');
  if (!res.ok) throw new Error(`YC list returned ${res.status}`);
  const companies: YcCompany[] = (await res.json())
    .filter((c: any) => c.isHiring && c.status !== 'Inactive')
    .map((c: any) => ({
      name: c.name,
      slug: c.slug,
      website: c.website || '',
      batch: c.batch || '',
      teamSize: Number(c.team_size) || 0,
      locations: c.all_locations || '',
      regions: c.regions || [],
      oneLiner: c.one_liner || '',
      industry: c.industry || '',
      tags: (c.tags || []).map((t: string) => t.toLowerCase()),
    }));
  if (typeof chrome !== 'undefined' && chrome.storage?.local) await chrome.storage.local.set({ [LIST_KEY]: { at: Date.now(), companies } });
  return companies;
}

export function ycLocationFit(c: Pick<YcCompany, 'locations' | 'regions'>, pref: MatchProfile['locationPreference']) {
  if (pref === 'anywhere') return true;
  const remote = c.regions.some((r) => /remote/i.test(r));
  if (pref === 'remote') return remote;
  return /india|bengaluru|bangalore|mumbai|delhi|gurgaon|gurugram|noida|hyderabad|pune|chennai/i.test(c.locations) || c.regions.includes('India');
}

const slugCandidates = (c: YcCompany) =>
  Array.from(new Set([c.slug, c.name.toLowerCase().replace(/[^a-z0-9]/g, ''), c.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')])).filter(Boolean);

async function probe(c: YcCompany) {
  for (const slug of slugCandidates(c)) {
    for (const ats of ['ashby', 'greenhouse', 'lever'] as const) {
      const roles = await fetchRoles({ ats, slug }).catch(() => null);
      if (roles && roles.length > 0) {
        await db.atsProbes.put({ id: c.slug, company: c.name, ats, slug, found: true, checkedAt: Date.now() });
        return;
      }
    }
  }
  await db.atsProbes.put({ id: c.slug, company: c.name, found: false, checkedAt: Date.now() });
}

async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

export async function fetchYc(profile: MatchProfile): Promise<RawJob[]> {
  const all = await loadList();
  const fit = all.filter((c) => ycLocationFit(c, profile.locationPreference)).sort((a, b) => a.teamSize - b.teamSize);

  // Find boards for companies we haven't checked recently, a few per run so we stay polite.
  const probes = new Map((await db.atsProbes.toArray()).map((p) => [p.id, p]));
  const toProbe = fit.filter((c) => !probes.has(c.slug) || Date.now() - probes.get(c.slug)!.checkedAt > PROBE_TTL).slice(0, PROBES_PER_RUN);
  await pool(toProbe, 6, probe);

  const found = (await db.atsProbes.toArray()).filter((p) => p.found);
  const bySlug = new Map(fit.map((c) => [c.slug, c]));
  const jobs: RawJob[] = [];

  await pool(found.filter((p) => bySlug.has(p.id)), 6, async (p) => {
    const c = bySlug.get(p.id)!;
    const roles = await fetchRoles({ ats: p.ats!, slug: p.slug! }).catch(() => null);
    for (const r of roles || []) {
      jobs.push({
        source: 'yc',
        sourceId: `${p.ats}:${p.slug}:${r.id}`,
        sourceLabel: `YC ${shortBatch(c.batch)}`,
        title: r.title,
        company: c.name,
        location: r.location || c.locations,
        remote: /remote/i.test(r.location) || c.regions.some((x) => /remote/i.test(x)),
        url: r.url,
        postedAt: r.publishedAt ? Date.parse(r.publishedAt) : undefined,
        tags: [...c.tags, c.industry.toLowerCase()],
        snippet: c.oneLiner,
        teamSize: c.teamSize,
        smallTeamReason: c.teamSize && c.teamSize <= 100 ? `YC ${shortBatch(c.batch)} · ${c.teamSize} people` : undefined,
      });
    }
  });

  // Small YC teams without a public board still get listed as companies to approach directly.
  const withBoards = new Set(found.map((p) => p.id));
  for (const c of fit.filter((c) => c.teamSize > 0 && c.teamSize <= 100 && !withBoards.has(c.slug)).slice(0, 60)) {
    jobs.push({
      source: 'yc',
      sourceId: `company:${c.slug}`,
      sourceLabel: `YC ${shortBatch(c.batch)}`,
      kind: 'company',
      title: `Hiring: ${c.oneLiner || c.industry}`,
      company: c.name,
      location: c.locations || c.regions.join(', '),
      remote: c.regions.some((x) => /remote/i.test(x)),
      url: `https://www.ycombinator.com/companies/${c.slug}/jobs`,
      tags: [...c.tags, c.industry.toLowerCase()],
      snippet: c.oneLiner,
      teamSize: c.teamSize,
      smallTeamReason: `YC ${shortBatch(c.batch)} · ${c.teamSize} people`,
    });
  }
  return jobs;
}
