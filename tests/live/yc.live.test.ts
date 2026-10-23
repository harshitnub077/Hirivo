import { describe, expect, it } from 'vitest';
import { fetchYc } from '../../src/services/discover/yc';

describe('YC startups', () => {
  it('finds hiring Indian startups and lists roles from their own boards', async () => {
    const jobs = await fetchYc({ targets: [], skills: [], locationPreference: 'india', smallTeamsOnly: false });
    const roles = jobs.filter((j) => j.kind !== 'company');
    const companies = jobs.filter((j) => j.kind === 'company');
    console.log(`YC India: ${roles.length} roles from public boards, ${companies.length} small teams without a board`);
    console.log(roles.slice(0, 5).map((r) => `${r.company} — ${r.title} (${r.smallTeamReason ?? 'large team'})`).join('\n'));
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs.slice(0, 20)) expect(j.url).toMatch(/^https:\/\//);
  }, 120_000);
});
