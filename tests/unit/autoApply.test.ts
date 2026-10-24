// @vitest-environment jsdom
// "Apply automatically to new matches": which jobs go to Autopilot, how portal jobs are matched to
// the company's own board, and LinkedIn read logged-out.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickAutoMatches } from '../../src/services/autopilot/auto';
import { boardSlugs, resolveCompanyPosting, sameRole } from '../../src/services/autopilot/resolve';
import { portalOf } from '../../src/services/autopilot/run';
import { linkedInJobId, parseLinkedInPosting } from '../../src/services/discover/sources/linkedin';
import type { AutopilotJob, DiscoveredJob } from '../../src/db';

const NOW = new Date(2026, 9, 24, 15).getTime();
const job = (id: string, over: Partial<DiscoveredJob> = {}): DiscoveredJob => ({ id, source: 'linkedin', sourceLabel: 'LinkedIn', kind: 'job', title: 'Backend Engineer Intern', company: `Co ${id}`, location: 'Bengaluru', remote: false, url: `https://www.linkedin.com/jobs/view/${id}/`, tags: [], score: 70, matchReasons: [], status: 'new', firstSeenAt: NOW, ...over });
const queued = (id: string, over: Partial<AutopilotJob> = {}): AutopilotJob => ({ id: `linkedin:${id}`, url: '', title: '', company: `Co ${id}`, status: 'done', steps: [], emailed: [], createdAt: NOW - 3_600_000, updatedAt: NOW, ...over });
const on = (over = {}) => ({ autopilot: { enabled: true, sendEmails: true, submitForms: true, peoplePerCompany: 3, autoApply: true, ...over } });

describe('which new matches Autopilot takes', () => {
  it('only when turned on, at or above the score, best first', () => {
    const rows = [job('1', { score: 65 }), job('2', { score: 90 }), job('3', { score: 50 }), job('4', { kind: 'company', score: 95 })];
    expect(pickAutoMatches(rows, [], { autopilot: { ...on().autopilot, autoApply: false } }, NOW)).toEqual([]);
    expect(pickAutoMatches(rows, [], { autopilot: { ...on().autopilot, enabled: false } }, NOW)).toEqual([]);
    expect(pickAutoMatches(rows, [], on(), NOW).map((j) => j.id)).toEqual(['2', '1']);
    expect(pickAutoMatches(rows, [], on({ minScore: 40 }), NOW).map((j) => j.id)).toEqual(['2', '1', '3']);
  });
  it('never hands over a job twice or one the user acted on', () => {
    const rows = [job('1'), job('2', { status: 'saved' }), job('3', { status: 'applied' })];
    expect(pickAutoMatches(rows, [queued('1')], on(), NOW)).toEqual([]);
  });
  it('takes at most two roles per company a week', () => {
    const rows = [job('a', { company: 'Acme', score: 90 }), job('b', { company: 'ACME', score: 80 }), job('c', { company: 'Acme', score: 70 })];
    expect(pickAutoMatches(rows, [], on(), NOW).map((j) => j.id)).toEqual(['a', 'b']);
    expect(pickAutoMatches(rows, [queued('x', { company: 'Acme', createdAt: NOW - 86_400_000 })], on(), NOW).map((j) => j.id)).toEqual(['a']);
    expect(pickAutoMatches(rows, [queued('x', { company: 'Acme', createdAt: NOW - 8 * 86_400_000 })], on(), NOW)).toHaveLength(2);
  });
  it('keeps to the daily limit when there is one, and has none otherwise', () => {
    const rows = Array.from({ length: 30 }, (_, i) => job(String(i)));
    expect(pickAutoMatches(rows, [], on(), NOW)).toHaveLength(30);
    const today = [queued('t1', { auto: true }), queued('t2', { auto: true }), queued('t3', { auto: true, createdAt: NOW - 2 * 86_400_000 })];
    expect(pickAutoMatches(rows, today, on({ dailyLimit: 5 }), NOW)).toHaveLength(3);
    expect(pickAutoMatches(rows, [queued('m1'), queued('m2')], on({ dailyLimit: 5 }), NOW)).toHaveLength(5); // the user's own hand-overs don't count
  });
});

describe('finding a portal job on the company\'s own board', () => {
  it('guesses board names', () => {
    expect(boardSlugs('Razorpay Software Pvt Ltd')).toEqual(['razorpaysoftwarepvtltd', 'razorpay-software-pvt-ltd', 'razorpay']);
    expect(boardSlugs('Acme Labs')).toEqual(['acmelabs', 'acme-labs', 'acme']);
  });
  it('matches the same role across sites, and not a different one', () => {
    expect(sameRole('SDE Intern', 'Software Engineer Intern')).toBe(true);
    expect(sameRole('Backend Engineer (Remote) - II', 'Backend Engineer II')).toBe(true);
    expect(sameRole('Software Engineering Internship', 'Software Engineering Intern, Summer 2027')).toBe(true);
    expect(sameRole('Backend Engineer', 'Backend Engineer Intern')).toBe(false);
    expect(sameRole('Frontend Engineer', 'Backend Engineer')).toBe(false);
    expect(sameRole('Data Analyst', 'Senior Data Engineer, Platform')).toBe(false);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('finds the posting, and stops at a board that doesn\'t have it', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      calls.push(String(u));
      if (String(u).includes('api.lever.co/v0/postings/acme')) return new Response(JSON.stringify([{ id: 'l1', text: 'Software Engineer Intern', categories: { location: 'Bengaluru' }, hostedUrl: 'https://jobs.lever.co/acme/l1', createdAt: NOW }]));
      return new Response('', { status: 404 });
    });
    expect(await resolveCompanyPosting('Acme', 'SDE Intern')).toMatchObject({ ats: 'lever', slug: 'acme', url: 'https://jobs.lever.co/acme/l1' });
    expect(await resolveCompanyPosting('Acme', 'Product Designer')).toBeNull();
    expect(calls.length).toBeLessThanOrEqual(2 * 12);
  });
});

describe('LinkedIn job pages, logged-out', () => {
  it('reads the job id from any LinkedIn job link', () => {
    expect(linkedInJobId('https://in.linkedin.com/jobs/view/backend-developer-intern-at-sirma-4482743503?trk=x')).toBe('4482743503');
    expect(linkedInJobId('https://www.linkedin.com/jobs/search/?currentJobId=4482743503')).toBe('4482743503');
    expect(linkedInJobId('https://www.naukri.com/job-listings-x')).toBeUndefined();
  });
  it('parses the real page: title, company, place, posting time, description', () => {
    const p = parseLinkedInPosting(readFileSync(resolve(__dirname, '../fixtures/sources/linkedin-posting.html'), 'utf8'), NOW)!;
    expect(p).toMatchObject({ title: 'Backend Developer Intern with Devops Knowledge (Intership 6 months )In-Office Role', company: 'Sirma Business Consulting India Private Ltd.', location: 'Bengaluru, Karnataka, India', internship: true });
    expect(p.description).toMatch(/^Job Description\n/);
    expect(p.description).toMatch(/Monthly Stipend: ₹20,000/);
    expect(Date.parse(p.postedAt!)).toBeLessThan(NOW);
  });
  it('knows which sites are portals', () => {
    expect(portalOf('https://in.linkedin.com/jobs/view/1')).toBe('LinkedIn');
    expect(portalOf('https://www.naukri.com/job-listings-x')).toBe('Naukri');
    expect(portalOf('https://internshala.com/internship/detail/x')).toBe('Internshala');
    expect(portalOf('https://job-boards.greenhouse.io/acme/jobs/1')).toBeUndefined();
  });
});
