// @vitest-environment jsdom
// Finding people and their addresses: email formats proven by real addresses, YC founders,
// LinkedIn pages the user reads, LinkedIn notes and the top-5 picker.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPattern, formatsOf, learnPattern, patternProof } from '../../src/services/people/emailPattern';
import { commitEvidence } from '../../src/services/people/github';
import { parseYcCompanyPage } from '../../src/services/people/yc';
import { parseLinkedInPeople, linkedInProfileUrl } from '../../src/services/contacts/linkedinPeople';
import { factSentence, linkedInNote, NOTE_LIMIT } from '../../src/services/people/linkedinNote';
import { addLinkedInTasks, emailEvidence, pickLinkedInPeople } from '../../src/services/people';
import { buildLadder } from '../../src/services/contactLadder';
import { pickRecipients } from '../../src/services/multiOutreach';
import { db, type ResumeFact } from '../../src/db';

const fixture = (f: string) => readFileSync(resolve(__dirname, '../fixtures/people', f), 'utf8');
const site = (name: string, email: string) => ({ name, email, source: 'site' as const });

describe('email format', () => {
  it('reads which format a real address uses', () => {
    expect(formatsOf('Priya Sharma', 'priya.sharma@acme.in')).toEqual(['first.last']);
    expect(formatsOf('Priya Sharma', 'psharma@acme.in')).toEqual(['flast']);
    expect(formatsOf('Dr. José O’Neil', 'jose@acme.in')).toEqual(['first']);
    expect(formatsOf('Priya Sharma', 'careers@acme.in')).toEqual([]); // a shared inbox proves nothing
    expect(formatsOf('Priya Sharma', 'pri@acme.in')).toEqual([]); // a nickname proves nothing
  });
  it('confirms a format only with proof, agreement and a mail server', () => {
    const one = [site('Priya Sharma', 'priya.sharma@acme.in')];
    expect(learnPattern(one, 'acme.in', { hasMx: true })?.id).toBe('first.last');
    expect(learnPattern(one, 'acme.in', { hasMx: false })).toBeUndefined();
    expect(learnPattern(one, 'acme.in', { hasMx: undefined })).toBeUndefined();
    expect(learnPattern([site('Priya Sharma', 'priya.sharma@other.com')], 'acme.in', { hasMx: true })).toBeUndefined();
    // Two addresses in different formats: nothing is proven.
    expect(learnPattern([...one, site('Rahul Verma', 'rahul@acme.in')], 'acme.in', { hasMx: true })).toBeUndefined();
    // A role inbox and a nickname don't contradict.
    expect(learnPattern([...one, site('Hiring', 'careers@acme.in'), site('Rahul Verma', 'rv2@acme.in')], 'acme.in', { hasMx: true })?.id).toBe('first.last');
  });
  it('applies the format to a new name and explains where it came from', () => {
    const p = learnPattern([site('Priya Sharma', 'priya.sharma@acme.in'), site('Arjun Rao', 'arjun.rao@acme.in')], 'www.acme.in', { hasMx: true })!;
    expect(applyPattern(p, 'Neha Gupta, PHR')).toBe('neha.gupta@acme.in');
    expect(applyPattern(p, 'Madonna')).toBeUndefined(); // no last name to fill first.last
    expect(patternProof(p)).toBe('first.last@acme.in, seen in priya.sharma@acme.in and 1 more');
  });
  it('takes evidence from GitHub commits at the domain only', () => {
    const commits = [
      { commit: { author: { name: 'Priya Sharma', email: 'priya.sharma@acme.in' }, committer: { name: 'GitHub', email: 'noreply@github.com' } } },
      { commit: { author: { name: 'Rahul Verma', email: 'rahul@gmail.com' } } },
      { commit: { author: { name: 'bot', email: 'bot@acme.in' } } },
      { commit: { author: { name: 'Arjun Rao', email: '12345+arjun@users.noreply.github.com' } } },
    ];
    expect(commitEvidence(commits, 'acme.in')).toEqual([{ name: 'Priya Sharma', email: 'priya.sharma@acme.in', source: 'github' }]);
  });
  it('uses listed addresses and the user\'s own export as evidence', () => {
    const lookup = { domain: 'acme.in', people: [{ name: 'Priya Sharma', role: 'CTO', email: 'priya@acme.in', page: '/team' }], inboxes: [], githubMembers: [], pagesChecked: [], checkedAt: 0 };
    const conns = [{ id: '1', firstName: 'Arjun', lastName: 'Rao', fullName: 'Arjun Rao', company: 'Acme', companyNormalized: 'acme', position: 'SDE', email: 'arjun@acme.in' } as any];
    expect(emailEvidence('acme.in', lookup, conns, 'Acme').map((e) => e.source)).toEqual(['site', 'export']);
  });
});

describe('YC founders', () => {
  it('reads founders and their LinkedIn links from the real company page', () => {
    const page = parseYcCompanyPage(fixture('yc-company.html'))!;
    expect(page.name).toBe('Razorpay');
    expect(page.founders).toEqual([
      { name: 'Harshil Mathur', title: 'Founder/CEO', linkedinUrl: 'https://www.linkedin.com/pub/harshil-mathur/69/23a/127' },
      { name: 'Shashank Kumar', title: 'Founder', linkedinUrl: 'https://www.linkedin.com/in/kumarshashank' },
    ]);
    expect(parseYcCompanyPage('<html><body>nothing</body></html>')).toBeNull();
  });
});

describe('a LinkedIn people page the user reads', () => {
  const doc = () => new DOMParser().parseFromString(fixture('linkedin-people-search.html'), 'text/html');
  it('keeps current staff with clean names and headlines; drops past staff and hidden members', () => {
    const people = parseLinkedInPeople(doc(), 'Razorpay', 'https://www.linkedin.com/search/results/people/?keywords=razorpay');
    expect(people.map((p) => [p.name, p.role])).toEqual([
      ['Priya Sharma', 'Talent Acquisition Lead'],
      ['Rahul Verma', 'Engineering Manager - Payments | Razorpay'],
      ['Neha Gupta', 'HR Business Partner'],
    ]);
    expect(people[0]).toMatchObject({ profileUrl: 'https://www.linkedin.com/in/priya-sharma-1a2b3c/', page: 'LinkedIn' });
  });
  it('normalises profile links', () => {
    expect(linkedInProfileUrl('/in/neha%20g?trk=x')).toBe('https://www.linkedin.com/in/neha g/');
    expect(linkedInProfileUrl('https://www.linkedin.com/company/acme')).toBeUndefined();
  });
});

const facts: ResumeFact[] = [
  { id: 'FACT-01', category: 'METRIC', claim: 'Cut p99 latency of the payments API from 480 ms to 120 ms with Redis caching.', sourceSnippet: '', verified: true },
  { id: 'FACT-02', category: 'PROJECT', claim: 'Built an open-source rate limiter in Go with 600 GitHub stars.', sourceSnippet: '', verified: true },
  { id: 'FACT-03', category: 'EDUCATION', claim: 'B.Tech in Computer Science from IIT Roorkee.', sourceSnippet: '', verified: true },
  { id: 'FACT-04', category: 'SKILL', claim: 'Java, Go, Kubernetes', sourceSnippet: '', verified: true },
];

describe('LinkedIn notes', () => {
  it('turns resume facts into first person, only when they read as actions', () => {
    expect(factSentence(facts[0])).toBe('I cut p99 latency of the payments API from 480 ms to 120 ms with Redis caching.');
    expect(factSentence(facts[3])).toBeUndefined();
  });
  it('fits LinkedIn\'s 200 characters, uses the first name and the most relevant fact', () => {
    const note = linkedInNote({ name: 'Priya Sharma', audience: 'recruiter', company: 'Razorpay', jobTitle: 'Backend Engineer', facts, jobText: 'payments API latency Redis' });
    expect(note.length).toBeLessThanOrEqual(NOTE_LIMIT);
    expect(note).toMatch(/^Hi Priya, I've applied for the Backend Engineer role at Razorpay\. I cut p99 latency/);
    expect(note).not.toMatch(/IIT|FACT-/);
  });
  it('drops the fact, then shortens the title, to stay within the limit', () => {
    const note = linkedInNote({ name: 'Venkataraghavan Subramanian', audience: 'team', company: 'Very Long Company Name Private Limited', jobTitle: 'Senior Software Development Engineer II (Payments Platform, Bengaluru) - Hybrid', facts });
    expect(note.length).toBeLessThanOrEqual(NOTE_LIMIT);
    expect(note).toMatch(/^Hi Venkataraghavan,/);
  });
});

describe('the ladder with founders and confirmed formats', () => {
  const pattern = learnPattern([site('Priya Sharma', 'priya.sharma@acme.in')], 'acme.in', { hasMx: true });
  const lookup = { domain: 'acme.in', people: [{ name: 'Rahul Verma', role: 'Engineering Manager', page: '/team' }, { name: 'Priya Sharma', role: 'Talent Partner', email: 'priya.sharma@acme.in', page: '/team' }], inboxes: [], githubMembers: [], pagesChecked: [], checkedAt: 0 };
  const founders = [{ name: 'Kabir Shah', title: 'Co-founder & CEO', linkedinUrl: 'https://www.linkedin.com/in/kabirshah' }];
  const ladder = buildLadder({ jobTitle: 'Backend Engineer', company: 'Acme', domain: 'acme.in', connections: [], lookup, domainHasMx: true, founders, pattern });

  it('marks addresses in the proven format as confirmed, and says why', () => {
    const rahul = ladder.find((c) => c.name === 'Rahul Verma')!;
    expect(rahul).toMatchObject({ email: 'rahul.verma@acme.in', emailStatus: 'pattern-confirmed' });
    expect(rahul.why).toMatch(/seen in priya\.sharma@acme\.in/);
    expect(ladder.find((c) => c.name === 'Priya Sharma')?.emailStatus).toBe('listed');
    const guessed = buildLadder({ jobTitle: 'Backend Engineer', company: 'Acme', domain: 'acme.in', connections: [], lookup, domainHasMx: true });
    expect(guessed.find((c) => c.name === 'Rahul Verma')?.emailStatus).toBe('guessed');
  });
  it('adds YC founders with their LinkedIn link', () => {
    expect(ladder.find((c) => c.name === 'Kabir Shah')).toMatchObject({ tier: 3, profileUrl: 'https://www.linkedin.com/in/kabirshah', emailStatus: 'pattern-confirmed', email: 'kabir.shah@acme.in' });
  });
  it('emails a founder, the hiring manager and HR first', () => {
    const verified = ladder.filter((c) => c.emailStatus === 'listed' || c.emailStatus === 'pattern-confirmed');
    expect(pickRecipients(verified).map((r) => r.audience)).toEqual(['hiring-manager', 'recruiter', 'founder']);
  });
  it('picks LinkedIn people one of each kind, at most five', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, tier: 3 as const, name: `Person ${i}`, role: 'Software Engineer', why: '', contactType: 'COLD_HIRING_MGR' as const, relevance: i, profileUrl: `https://www.linkedin.com/in/p${i}` }));
    const picked = pickLinkedInPeople([...ladder, ...many]);
    expect(picked).toHaveLength(5);
    expect(picked[0].name).toBe('Kabir Shah');
    expect(pickLinkedInPeople(ladder.filter((c) => c.name !== 'Kabir Shah'))).toEqual([]); // nobody else has a profile link
  });
});

describe('LinkedIn tasks in Pipeline', () => {
  beforeEach(() => db.linkedinTasks.clear());
  const person = { id: 'yc:Kabir', tier: 3 as const, name: 'Kabir Shah', role: 'Co-founder & CEO', why: '', contactType: 'COLD_HIRING_MGR' as const, relevance: 70, profileUrl: 'https://www.linkedin.com/in/kabirshah' };
  it('saves one note per person and never the same person twice in 60 days', async () => {
    const first = await addLinkedInTasks([person], { id: 'job1', company: 'Acme', title: 'Backend Engineer' }, facts);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ status: 'todo', audience: 'founder', name: 'Kabir Shah' });
    expect(first[0].note.length).toBeLessThanOrEqual(NOTE_LIMIT);
    expect(await addLinkedInTasks([person], { id: 'job2', company: 'Acme', title: 'Platform Engineer' }, facts)).toEqual([]);
    expect(await db.linkedinTasks.count()).toBe(1);
  });
});
