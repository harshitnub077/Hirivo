// @vitest-environment jsdom
// Job-site adapters against real pages saved from LinkedIn, Naukri, Indeed, Internshala and Unstop.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLinkedInCards, linkedInSearchUrl } from '../../src/services/discover/sources/linkedin';
import { parseInternshala, internshalaUrls, internshalaCategories } from '../../src/services/discover/sources/internshala';
import { parseUnstop, unstopUrls } from '../../src/services/discover/sources/unstop';
import { fromListed, naukriUrls, indeedUrls } from '../../src/services/discover/sources/portals';
import { monthlyPay } from '../../src/services/discover/sources/common';
import { extractJobListFromPage } from '../../src/content/extractJobList';
import { cityOf, distanceKm, nearbyCities } from '../../src/services/discover/geo';
import { placeFits, scoreJob } from '../../src/services/discover/rank';
import { dedupeKey } from '../../src/services/discover';
import type { MatchProfile, RawJob } from '../../src/services/discover/types';
import type { SearchProfile } from '../../src/db';

const fixture = (f: string) => readFileSync(resolve(__dirname, '../fixtures/sources', f), 'utf8');
const NOW = Date.UTC(2026, 9, 24, 6);

const search = (over: Partial<SearchProfile> = {}): SearchProfile => ({
  jobType: 'internship',
  workModes: ['onsite', 'hybrid', 'remote'],
  experience: 'fresher',
  city: 'Bengaluru',
  scope: 'radius',
  radiusKm: 25,
  postedWithinDays: 7,
  ...over,
});
const profile = (over: Partial<SearchProfile> = {}): MatchProfile => ({
  targets: ['software engineer', 'backend engineer'],
  queries: ['software engineer intern'],
  skills: ['java', 'go'],
  level: 'intern',
  locationPreference: 'india',
  smallTeamsOnly: false,
  search: search(over),
  center: cityOf(search(over).city),
});

/** Runs the in-page extractor on a saved page, as Chrome would in the background tab. */
function extractFrom(html: string, url: string) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML;
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  const real = window.location;
  // @ts-expect-error jsdom: point location at the job site for the extractor
  delete window.location;
  (window as any).location = new URL(url);
  try {
    return extractJobListFromPage();
  } finally {
    (window as any).location = real;
    delete (HTMLElement.prototype as any).innerText;
  }
}

describe('LinkedIn (logged-out guest search)', () => {
  it('builds the search with radius in miles, recency, internship and work mode', () => {
    const u = new URL(linkedInSearchUrl(profile(), 'software engineer intern'));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ keywords: 'software engineer intern', location: 'Bengaluru, India', distance: '16', f_TPR: 'r604800', f_JT: 'I', f_WT: '1,3,2' });
  });
  it('parses the job cards with ids, companies and posting times', () => {
    const jobs = parseLinkedInCards(fixture('linkedin-guest.html'), NOW);
    expect(jobs).toHaveLength(10);
    expect(jobs[0]).toMatchObject({ source: 'linkedin', sourceId: '4482743503', company: expect.stringMatching(/Sirma/), location: 'Bengaluru, Karnataka, India', url: 'https://www.linkedin.com/jobs/view/4482743503/' });
    expect(jobs.every((j) => j.postedAt && j.postedAt <= NOW)).toBe(true);
  });
});

describe('Internshala', () => {
  it('maps roles to its categories and cities to its URLs', () => {
    expect(internshalaCategories(profile())).toEqual(['back-end-development', 'software-development']);
    const urls = internshalaUrls(profile());
    expect(urls[0]).toBe('https://internshala.com/internships/back-end-development-internship-in-bangalore/');
    expect(urls.some((u) => u.includes('work-from-home'))).toBe(true);
  });
  it('parses cards: stipend, skills, posted time, internship vs job', () => {
    const jobs = parseInternshala(fixture('internshala-search.html'), NOW);
    expect(jobs.length).toBeGreaterThanOrEqual(8);
    const first = jobs[0];
    expect(first).toMatchObject({ source: 'internshala', sourceId: '3319450', title: 'Full Stack Developer', company: 'Brandsea', monthlyPay: 5000, internship: true });
    expect(first.location).toMatch(/Bangalore.*Hybrid/);
    expect(first.url).toMatch(/^https:\/\/internshala\.com\/internship\/detail\//);
    expect(first.postedAt).toBe(NOW - 86_400_000);
    expect(first.tags.length).toBeGreaterThan(0);
  });
});

describe('Unstop', () => {
  it('searches internships with the user\'s words and parses the API', () => {
    expect(unstopUrls(profile())[0]).toContain('opportunity=internships');
    const jobs = parseUnstop(JSON.parse(fixture('unstop-search.json')), 'internships');
    expect(jobs.length).toBeGreaterThan(3);
    expect(jobs[0]).toMatchObject({ source: 'unstop', internship: true, url: expect.stringMatching(/^https:\/\/unstop\.com\//) });
    expect(jobs.every((j) => j.title && j.postedAt)).toBe(true);
  });
});

describe('Naukri and Indeed (read in a background tab)', () => {
  it('build their search URLs', () => {
    expect(naukriUrls(profile())[0]).toBe('https://www.naukri.com/software-engineer-intern-jobs-in-bangalore?jobAge=7&experience=0');
    const u = new URL(indeedUrls(profile())[0]);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ q: 'software engineer intern', l: 'Bengaluru', radius: '25', fromage: '7', sc: '0kf:jt(internship);' });
  });
  it('reads Naukri cards (internship flag, stipend, id) and never treats "Starts in" as a posting time', () => {
    const page = extractFrom(fixture('naukri-search.html'), 'https://www.naukri.com/software-engineer-intern-jobs-in-bangalore');
    expect(page.blocked).toBeUndefined();
    expect(page.jobs[0]).toMatchObject({ id: '231026500904', title: 'Intern - Software Eng', company: 'Sparta Systems', location: 'Bengaluru', internship: true, salary: 'Unpaid' });
    const job = fromListed('naukri', page.jobs[0], NOW);
    expect(job).toMatchObject({ source: 'naukri', sourceId: '231026500904', monthlyPay: 0, postedAt: undefined });
  });
  it('reads Indeed\'s embedded results with exact posting times', () => {
    const page = extractFrom(fixture('indeed-search.html'), 'https://in.indeed.com/jobs?q=x');
    expect(page.jobs.length).toBe(8);
    expect(page.jobs[0]).toMatchObject({ id: '350ec648ab28544d', title: 'Intern - Software Engineer', company: 'Nference', internship: true, postedAt: 1792299600000, url: 'https://in.indeed.com/viewjob?jk=350ec648ab28544d' });
  });
  it('recognises a block page instead of reporting "no jobs"', () => {
    const page = extractFrom('<html><head><title>Access Denied</title></head><body>You don\'t have permission to access this server.</body></html>', 'https://www.naukri.com/x');
    expect(page.blocked).toBe('Access Denied');
  });
});

describe('places, distance and filters', () => {
  it('knows Indian city names as job sites write them', () => {
    expect(cityOf('Bangalore Urban, Karnataka')?.name).toBe('Bengaluru');
    expect(cityOf('Gurgaon (Hybrid)')?.name).toBe('Gurugram');
    expect(cityOf('Remote')).toBeUndefined();
    expect(distanceKm(cityOf('Noida')!, cityOf('Delhi')!)).toBeLessThan(25);
    expect(nearbyCities(cityOf('Delhi')!, 30).map((c) => c.name)).toEqual(expect.arrayContaining(['New Delhi', 'Noida', 'Gurugram', 'Ghaziabad']));
  });
  const job = (over: Partial<RawJob>): RawJob => ({ source: 'linkedin', sourceId: '1', sourceLabel: 'LinkedIn', title: 'Software Engineer Intern', company: 'Acme', location: 'Bengaluru, Karnataka, India', remote: false, url: 'https://x', tags: [], postedAt: NOW - 3_600_000, ...over });
  it('keeps jobs inside the radius and drops the ones outside', () => {
    expect(placeFits(job({ location: 'Bengaluru' }), profile())).toMatchObject({ ok: true, distanceKm: 0 });
    expect(placeFits(job({ location: 'Mysuru, Karnataka' }), profile()).ok).toBe(false); // ~130 km
    expect(placeFits(job({ location: 'Mysuru, Karnataka' }), profile({ radiusKm: 100 })).ok).toBe(false);
    expect(placeFits(job({ location: 'Pune' }), profile({ scope: 'india' })).ok).toBe(true);
    expect(placeFits(job({ location: 'Remote', remote: true }), profile({ workModes: ['onsite'] })).ok).toBe(false);
  });
  it('filters by internship, freshness, level and pay', () => {
    expect(scoreJob(job({}), profile(), NOW)).not.toBeNull();
    expect(scoreJob(job({ title: 'Backend Engineer' }), profile(), NOW)).toBeNull(); // not an internship
    expect(scoreJob(job({ postedAt: NOW - 10 * 86_400_000 }), profile(), NOW)).toBeNull(); // older than 7 days
    expect(scoreJob(job({ title: 'Senior Software Engineer Intern' }), profile(), NOW)).toBeNull(); // fresher search
    expect(scoreJob(job({ monthlyPay: 5000 }), profile({ minMonthlyPay: 10000 }), NOW)).toBeNull();
    expect(scoreJob(job({ title: 'Backend Developer Intern' }), profile(), NOW)?.reasons[0]).toMatch(/backend/i); // searched source: specific word counts
  });
  it('treats the same job on two sites as one', () => {
    const a = job({ company: 'Acme Labs', title: 'SDE Intern', location: 'Bangalore, India' });
    const b = job({ source: 'naukri', company: 'Acme Labs', title: 'SDE Intern', location: 'Bengaluru' });
    expect(dedupeKey(a)).toBe(dedupeKey(b));
    expect(dedupeKey(a)).not.toBe(dedupeKey({ ...b, location: 'Pune' }));
  });
  it('reads pay as rupees per month', () => {
    expect(monthlyPay('₹ 3,000 - 5,000 /month')).toBe(5000);
    expect(monthlyPay('3-5 Lacs PA')).toBe(41667);
    expect(monthlyPay('Unpaid')).toBe(0);
    expect(monthlyPay('Not disclosed')).toBeUndefined();
  });
});
