import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import { fingerprint, normalizeDescription, parsePostedDate, recordFingerprint, sourceOf } from '../../src/services/repostFingerprint';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 24);

const JD = `We are hiring a Backend Engineer to build our lending platform. You will design APIs in Go and PostgreSQL,
own reliability for loan disbursal services, and work with risk and product teams. 3+ years of experience with
distributed systems. Hybrid in Bengaluru. Benefits include health insurance, ESOPs and a learning budget.`;

beforeEach(async () => {
  await db.fingerprints.clear();
});

describe('normalizeDescription', () => {
  it('ignores dates, numbers, links, emails and spacing', async () => {
    const a = `${JD}\nPosted 3 days ago. Apply by 12 Oct 2026 at https://jobs.example.com/1 or hr@example.com`;
    const b = `${JD.replace(/\n/g, '  ')}\nPosted 1 month ago.   Apply by 30 Nov 2026 at https://jobs.example.com/987 or talent@example.org`;
    expect(normalizeDescription(a)).toBe(normalizeDescription(b));
    expect(await fingerprint(a)).toBe(await fingerprint(b));
  });
  it('refuses to fingerprint very short text', async () => expect(await fingerprint('Hiring now!')).toBeNull());
});

describe('parsePostedDate', () => {
  it.each([
    ['2 weeks ago', NOW - 14 * DAY],
    ['30+ days ago', NOW - 30 * DAY],
    ['a month ago', NOW - 30 * DAY],
    ['yesterday', NOW - DAY],
    ['Reposted 5 days ago', NOW - 5 * DAY],
    ['2026-10-01', Date.parse('2026-10-01')],
  ])('%s', (raw, expected) => expect(parsePostedDate(raw, NOW)).toBe(expected));
  it('returns undefined for unknown text', () => expect(parsePostedDate('Be an early applicant', NOW)).toBeUndefined());
});

describe('sourceOf', () => {
  it('reads the site from either id style', () => {
    expect(sourceOf('linkedin:4040404040')).toBe('linkedin');
    expect(sourceOf('jobs.lever.co/cred/abc')).toBe('jobs.lever.co');
  });
});

describe('recordFingerprint', () => {
  it('says nothing the first time a description is seen', async () => {
    const r = await recordFingerprint({ id: 'linkedin:1', company: 'Lendo', description: JD, postedDate: '2 days ago' }, NOW);
    expect(r).toMatchObject({ postings: 1 });
    expect(r?.finding).toBeUndefined();
  });

  it('flags the same description posted again on the same site under a new job id', async () => {
    await recordFingerprint({ id: 'linkedin:1', company: 'Lendo', description: JD, postedDate: '2026-08-01' }, NOW - 60 * DAY);
    await recordFingerprint({ id: 'linkedin:2', company: 'Lendo', description: JD, postedDate: '2026-09-01' }, NOW - 30 * DAY);
    const r = await recordFingerprint({ id: 'linkedin:3', company: 'Lendo', description: JD, postedDate: '1 day ago' }, NOW);
    expect(r?.postings).toBe(3);
    expect(r?.finding?.text).toMatch(/^Same description seen 3 times since 1 Aug 2026/);
  });

  it('flags a job that comes back with a newer posting date', async () => {
    await recordFingerprint({ id: 'linkedin:9', company: 'Lendo', description: JD, postedDate: '3 weeks ago' }, NOW - 7 * DAY);
    const r = await recordFingerprint({ id: 'linkedin:9', company: 'Lendo', description: JD, postedDate: '1 day ago' }, NOW);
    expect(r?.postings).toBe(2);
    expect(r?.finding?.text).toContain('this listing was just re-dated');
  });

  it('does not treat the same role on LinkedIn and the company board as a repost', async () => {
    await recordFingerprint({ id: 'linkedin:5', company: 'Lendo', description: JD, postedDate: '2 days ago' }, NOW);
    const r = await recordFingerprint({ id: 'jobs.lever.co/lendo/abc', company: 'Lendo', description: JD }, NOW);
    expect(r?.finding).toBeUndefined();
  });

  it('opening the same listing again without a date change is not a repost', async () => {
    await recordFingerprint({ id: 'linkedin:7', company: 'Lendo', description: JD, postedDate: '2 days ago' }, NOW - DAY);
    const r = await recordFingerprint({ id: 'linkedin:7', company: 'Lendo', description: JD, postedDate: '3 days ago' }, NOW);
    expect(r?.finding).toBeUndefined();
  });
});
