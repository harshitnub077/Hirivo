import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { daysSince, findMatchingRole, parseAtsUrl } from '../../src/services/atsFeeds';
import { parseHnPost } from '../../src/services/discover/hn';
import {
  extractCollege,
  extractContactInfo,
  extractFactsHeuristic,
  extractSkillsHeuristic,
  isTraceable,
  readDocx,
  suggestRolesHeuristic,
} from '../../src/services/resumeImport';
import { parseJsonLoose } from '../../src/llm/json';

describe('parseAtsUrl', () => {
  it.each([
    ['https://job-boards.greenhouse.io/razorpaysoftwareprivatelimited/jobs/4740728005', 'greenhouse', 'razorpaysoftwareprivatelimited'],
    ['https://boards.greenhouse.io/embed/job_board?for=stripe', 'greenhouse', 'stripe'],
    ['jobs.lever.co/cred', 'lever', 'cred'],
    ['https://jobs.ashbyhq.com/linear/d3bc1ced/application', 'ashby', 'linear'],
  ])('%s', (url, ats, slug) => {
    expect(parseAtsUrl(url)).toEqual({ ats, slug });
  });
  it('rejects other sites', () => {
    expect(parseAtsUrl('https://www.linkedin.com/jobs/view/1')).toBeNull();
    expect(parseAtsUrl('not a url ::')).toBeNull();
  });
});

describe('findMatchingRole', () => {
  const roles = [
    { id: '11', title: 'Senior Frontend Engineer (Payments)', location: '', url: 'https://x/11' },
    { id: '22', title: 'Product Designer', location: '', url: 'https://x/22' },
  ];
  it('matches titles despite "Sr." and brackets', () => expect(findMatchingRole(roles, 'Sr. Frontend Engineer')?.id).toBe('11'));
  it('matches by id in the page url', () => expect(findMatchingRole(roles, 'whatever', 'https://board/jobs/22?src=li')?.id).toBe('22'));
  it('returns undefined when absent', () => expect(findMatchingRole(roles, 'Data Analyst')).toBeUndefined());
  it('daysSince', () => expect(daysSince(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe(3));
});

describe('parseHnPost', () => {
  it('reads company, role, location and apply link', () => {
    const job = parseHnPost({
      id: 42,
      created_at_i: 1_790_000_000,
      text: 'Sidekick Labs | Senior SWE, R&amp;D Engineer | REMOTE (US Timezones) | Full-time | $170k to $230k<p>Apply at <a href="https:&#x2F;&#x2F;sidekick.dev&#x2F;jobs" rel="nofollow">here</a>',
    })!;
    expect(job.company).toBe('Sidekick Labs');
    expect(job.title).toContain('Senior SWE');
    expect(job.remote).toBe(true);
    expect(job.url).toBe('https://sidekick.dev/jobs');
    expect(job.sourceUrl).toBe('https://news.ycombinator.com/item?id=42');
    expect(job.salary).toContain('$170k');
  });
  it('handles em-dash separators', () => {
    const job = parseHnPost({ id: 1, text: 'PrairieLearn (Remote US) — Full-Stack Software Engineer — TypeScript / Postgres' })!;
    expect(job.company).toBe('PrairieLearn');
    expect(job.title).toBe('Full-Stack Software Engineer');
  });
  it('keeps URLs out of the location', () => {
    const job = parseHnPost({ id: 4, text: 'Enveritas | Backend Software Engineer | Remote (Global) | https://enveritas.org/jobs' })!;
    expect(job.location).toBe('Remote (Global)');
  });
  it('ignores chatter', () => {
    expect(parseHnPost({ id: 2, text: 'Is anyone hiring in Pune?' })).toBeNull();
    expect(parseHnPost({ id: 3, text: null })).toBeNull();
  });
});

const RESUME = `Aarav Mehta
Bengaluru · aarav.mehta@gmail.com · +91 98765 43210
linkedin.com/in/aarav-mehta · github.com/aaravm · aarav.dev
EXPERIENCE
• Cut checkout page load time 38% by moving to React Server Components at Zeta
• Built an open-source UPI payment status tracker with 1.2k GitHub stars using TypeScript and Node.js
• Led migration of 14 services from REST to GraphQL with zero downtime
SKILLS
React, TypeScript, Node.js, PostgreSQL, Docker, AWS
EDUCATION
B.Tech, IIT Delhi`;

describe('resume extraction without AI', () => {
  it('finds contact details and links', () => {
    expect(extractContactInfo(RESUME)).toEqual({
      fullName: 'Aarav Mehta',
      email: 'aarav.mehta@gmail.com',
      phone: '+91 98765 43210',
      linkedinUrl: 'https://linkedin.com/in/aarav-mehta',
      githubUrl: 'https://github.com/aaravm',
      portfolioUrl: 'https://aarav.dev',
    });
  });
  it('does not mistake degrees for websites, and finds the college', () => {
    const text = 'Riya Sen\nriya.sen@outlook.com\nB.Tech in CSE, National Institute of Technology Trichy, 2025\nM.Sc. Physics';
    expect(extractContactInfo(text).portfolioUrl).toBeUndefined();
    expect(extractCollege(text)).toBe('National Institute of Technology Trichy');
    expect(extractCollege('B.Tech, IIT Delhi')).toBe('IIT Delhi');
  });
  it('finds achievement bullets as facts with padded ids', () => {
    const facts = extractFactsHeuristic(RESUME);
    expect(facts).toHaveLength(3);
    expect(facts[0]).toMatchObject({ id: 'FACT-01', category: 'METRIC' });
    expect(facts[0].claim).toMatch(/^Cut checkout/);
  });
  it('finds skills and suggests roles from them', () => {
    const skills = extractSkillsHeuristic(RESUME);
    expect(skills).toEqual(expect.arrayContaining(['react', 'typescript', 'node.js', 'postgresql', 'docker', 'aws', 'graphql']));
    expect(suggestRolesHeuristic(skills).map((r) => r.title)).toContain('Frontend Engineer');
  });
  it('rejects invented facts', () => {
    expect(isTraceable('Cut checkout page load time 38% by moving to React Server Components', RESUME)).toBe(true);
    expect(isTraceable('Managed a team of 40 engineers at Google', RESUME)).toBe(false);
  });
  it('reads DOCX text', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Aarav Mehta</w:t></w:r></w:p><w:p><w:r><w:t>Built X &amp; Y</w:t></w:r></w:p></w:body></w:document>';
    const docx = zipSync({ 'word/document.xml': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') });
    expect(readDocx(docx)).toBe('Aarav Mehta\nBuilt X & Y');
  });
});

describe('parseJsonLoose', () => {
  it('parses JSON wrapped in prose and fences', () => {
    expect(parseJsonLoose('Sure! ```json\n{"a": {"b": "}"}}\n``` hope that helps')).toEqual({ a: { b: '}' } });
  });
  it('throws when there is no JSON', () => expect(() => parseJsonLoose('nothing here')).toThrow());
});
