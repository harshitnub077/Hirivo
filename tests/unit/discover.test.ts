// End-to-end Discover run against a fake network and a real (in-memory) IndexedDB.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { patchSettings } from '../../src/db/settings';
import { runDiscover, setJobStatus } from '../../src/services/discover';
import { addCompany, refreshCompany } from '../../src/services/watchlist';

const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

let greenhouseJobs = [{ id: 1, title: 'Frontend Engineer', location: { name: 'Bengaluru' }, absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1', first_published: iso(2) }];

const routes: [RegExp, () => unknown][] = [
  [/remotive\.com/, () => ({ jobs: [{ id: 7, title: 'React Developer', company_name: 'Remo', candidate_required_location: 'Worldwide', url: 'https://remotive.com/j/7', publication_date: iso(1), tags: ['react'] }] })],
  [/remoteok\.com/, () => [{ legal: 'credit us' }, { id: 8, position: 'Senior Backend Engineer', company: 'Okay', location: 'USA', url: 'https://remoteok.com/8', epoch: Math.floor(now / 1000) }]],
  [/himalayas\.app/, () => ({ jobs: [{ guid: 'h1', title: 'Frontend Engineer', companyName: 'Remo', locationRestrictions: [], applicationLink: 'https://himalayas.app/h1', pubDate: Math.floor(now / 1000) }] })],
  [/jobicy\.com/, () => ({ jobs: [] })],
  [/arbeitnow\.com/, () => ({ data: [] })],
  [/hn\.algolia\.com\/api\/v1\/search/, () => ({ hits: [{ objectID: '99', title: 'Ask HN: Who is hiring? (October 2026)' }] })],
  [/hn\.algolia\.com\/api\/v1\/items/, () => ({ children: [{ id: 5, created_at_i: Math.floor(now / 1000), text: 'Tiny Co | Frontend Engineer | Remote (worldwide)<p>details' }] })],
  [/yc-oss\.github\.io/, () => [
    { name: 'Cardboard', slug: 'cardboard', website: '', batch: 'Winter 2026', team_size: 8, all_locations: 'Bengaluru, India', regions: ['India'], one_liner: 'AI for docs', industry: 'B2B', tags: [], isHiring: true, status: 'Active' },
  ]],
  [/api\.ashbyhq\.com\/posting-api\/job-board\/cardboard/, () => ({ jobs: [{ id: 'c1', title: 'Frontend Engineer', location: 'Bengaluru', jobUrl: 'https://jobs.ashbyhq.com/cardboard/c1', publishedAt: iso(3), isListed: true }] })],
  [/boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/, () => ({ jobs: greenhouseJobs })],
];

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await patchSettings({ targetRoles: ['frontend', 'react'], skills: ['react'], locationPreference: 'india' });
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input);
    const route = routes.find(([re]) => re.test(url));
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route[1]()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('runDiscover', () => {
  it('collects, filters, de-duplicates and credits jobs from every source', async () => {
    const result = await runDiscover({ force: true });
    const jobs = await db.discovered.toArray();
    const titles = jobs.map((j) => `${j.company}: ${j.title}`).sort();

    expect(titles).toEqual(['Cardboard: Frontend Engineer', 'Remo: Frontend Engineer', 'Remo: React Developer', 'Tiny Co: Frontend Engineer']);
    // Senior US-only backend role is filtered out by role and location.
    expect(titles.some((t) => t.includes('Okay'))).toBe(false);
    expect(jobs.find((j) => j.company === 'Cardboard')).toMatchObject({ source: 'yc', smallTeamReason: 'YC W26 · 8 people', url: 'https://jobs.ashbyhq.com/cardboard/c1' });
    expect(jobs.every((j) => j.sourceLabel && j.url.startsWith('https://'))).toBe(true);
    expect(result.added).toBe(4);
    expect(await db.atsProbes.get('cardboard')).toMatchObject({ found: true, ats: 'ashby', slug: 'cardboard' });
  });

  it('keeps what the user did across refreshes', async () => {
    await runDiscover({ force: true });
    const remo = (await db.discovered.toArray()).find((j) => j.title === 'React Developer')!;
    await setJobStatus(remo.id, 'applied');
    await runDiscover({ force: true });
    expect((await db.discovered.get(remo.id))?.status).toBe('applied');
    expect((await db.discovered.get(remo.id))?.appliedAt).toBeGreaterThan(0);
  });
});

describe('watchlist', () => {
  it('reads a real-shaped board and flags only roles that are new since the last check', async () => {
    const company = await addCompany('https://job-boards.greenhouse.io/acme');
    expect(company).toMatchObject({ status: 'ok', name: 'Acme', newRoleIds: [] });
    expect(company.roles).toHaveLength(1);

    greenhouseJobs = [...greenhouseJobs, { id: 2, title: 'React Native Developer', location: { name: 'Remote' }, absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/2', first_published: iso(0) }];
    const after = await refreshCompany(company);
    expect(after.newRoleIds).toEqual(['2']);
    expect(after.roleCountHistory.map((h) => h.count)).toEqual([1, 2]);
  });

  it('explains bad links', async () => {
    await expect(addCompany('https://example.com/careers')).rejects.toThrow(/Greenhouse, Lever or Ashby/);
  });
});
