// Hits the real public sources. Run on demand: npm run test:live
import { describe, expect, it } from 'vitest';
import { fetchArbeitnow, fetchHimalayas, fetchJobicy, fetchRemoteOk, fetchRemotive } from '../../src/services/discover/boards';
import { fetchHn } from '../../src/services/discover/hn';
import { scoreJob } from '../../src/services/discover/rank';

const profile = { targets: ['engineer', 'developer'], skills: ['react', 'typescript', 'python'], locationPreference: 'anywhere' as const, smallTeamsOnly: false };

describe.each([
  ['Remotive', fetchRemotive],
  ['Remote OK', fetchRemoteOk],
  ['Himalayas', fetchHimalayas],
  ['Jobicy', fetchJobicy],
  ['Arbeitnow', fetchArbeitnow],
  ['HN Who is hiring', fetchHn],
])('%s', (name, fetcher) => {
  it('returns well-formed jobs', async () => {
    const jobs = await fetcher();
    expect(jobs.length).toBeGreaterThan(5);
    for (const j of jobs.slice(0, 20)) {
      expect(j.title, `${name} title`).toBeTruthy();
      expect(j.company, `${name} company`).toBeTruthy();
      expect(j.url, `${name} url`).toMatch(/^https?:\/\//);
    }
    const matched = jobs.map((j) => scoreJob(j, profile)).filter(Boolean);
    console.log(`${name}: ${jobs.length} jobs, ${matched.length} match engineer/developer`);
  }, 60_000);
});
