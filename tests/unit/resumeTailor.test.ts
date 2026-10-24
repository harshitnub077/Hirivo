import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FitRequirement, ResumeFact } from '../../src/db';

const replies: unknown[] = [];
vi.mock('../../src/llm/router', () => ({
  routeLLMRequest: vi.fn(async () => ({ content: JSON.stringify(replies.shift()), providerUsed: 'groq', model: 'mock', cached: false })),
}));

const { checkRewrite, rankFacts, tailorResume, tailorSkills } = await import('../../src/services/resumeTailor');

const FACTS: ResumeFact[] = [
  { id: 'FACT-01', category: 'PROJECT', claim: 'Built an open-source UPI payment status tracker with 1.2k GitHub stars using TypeScript and Node.js', sourceSnippet: '', verified: true },
  { id: 'FACT-02', category: 'METRIC', claim: 'Cut checkout page load time 38% by moving to React Server Components at Zeta', sourceSnippet: '', verified: true },
  { id: 'FACT-03', category: 'PROJECT', claim: 'Helped organise the college hackathon for 300 students', sourceSnippet: '', verified: true },
  { id: 'FACT-04', category: 'METRIC', claim: 'Wrote Jest and Playwright tests for the checkout flow, raising coverage from 41% to 78%', sourceSnippet: '', verified: true },
];

const JOB = {
  id: 'job-1',
  title: 'Frontend Engineer, Payments',
  company: 'Razorpay',
  description: 'Build checkout UI in React and TypeScript. Strong testing culture with Jest and Playwright. Payments experience a plus. Kafka is nice to have.',
  fitEvidence: [
    { id: 'R1', text: 'React and TypeScript frontend work', kind: 'must', factId: 'FACT-02', reason: '', met: true },
    { id: 'R2', text: 'Testing with Jest or Playwright', kind: 'must', factId: 'FACT-04', reason: '', met: true },
    { id: 'R3', text: 'Payments experience', kind: 'nice', factId: 'FACT-01', reason: '', met: true },
  ] as FitRequirement[],
};

beforeEach(() => {
  replies.length = 0;
});

describe('checkRewrite (the honesty gate)', () => {
  const src = FACTS[1].claim;
  it('accepts honest rewording that leads with the result', () => {
    expect(checkRewrite(src, 'Reduced checkout load time by 38% at Zeta by moving to React Server Components')).toEqual([]);
  });
  it('rejects a changed or added figure', () => {
    expect(checkRewrite(src, 'Cut checkout load time 45% with React Server Components at Zeta')[0]).toMatch(/figure \(45%\)/);
    expect(checkRewrite(src, 'Cut load time 38% for 2M users with React Server Components at Zeta')[0]).toMatch(/figure \(2m\)/i);
  });
  it('rejects a technology the original never named', () => {
    expect(checkRewrite(src, 'Cut checkout load time 38% using React Server Components and GraphQL at Zeta')[0]).toMatch(/technology.*GraphQL/);
  });
  it('rejects inflated ownership', () => {
    expect(checkRewrite(FACTS[2].claim, 'Led the college hackathon for 300 students')[0]).toMatch(/ownership/);
  });
  it('rejects new organisations or products', () => {
    expect(checkRewrite(src, 'Cut checkout load time 38% at Zeta and Razorpay by moving to React Server Components')[0]).toMatch(/names something.*Razorpay/);
  });
  it('rejects padding and gutting', () => {
    expect(checkRewrite('Wrote unit tests for the API', 'Wrote comprehensive, rigorous, production-grade unit tests for the API that ensured reliability, maintainability and confidence across every release cycle')).toContain('is padded well beyond the original');
    expect(checkRewrite(src, 'Cut load time')).toContain('drops most of the original');
  });
});

describe('ordering', () => {
  it('puts facts that prove must-haves first, unrelated ones last', () => {
    const order = rankFacts(FACTS, `${JOB.title}\n${JOB.description}`, JOB.fitEvidence).map((r) => r.fact.id);
    expect(order.slice(0, 2).sort()).toEqual(['FACT-02', 'FACT-04']);
    expect(order.at(-1)).toBe('FACT-03');
  });
  it('orders skills with the job’s first and adds nothing new', () => {
    const skills = tailorSkills(['docker', 'react', 'typescript', 'postgresql'], JOB.description, 'React TypeScript Docker PostgreSQL');
    expect(new Set(skills.slice(0, 2))).toEqual(new Set(['React', 'TypeScript']));
    expect(skills).not.toContain('Kafka');
    expect(skills).toHaveLength(4);
  });
});

describe('tailorResume', () => {
  it('keeps the original whenever a suggestion overclaims, and says why', async () => {
    replies.push({
      summary: 'Frontend engineer who cut checkout load time 38% and raised test coverage from 41% to 78%.',
      bullets: [
        { id: 'FACT-02', text: 'Reduced checkout load time by 38% at Zeta by moving to React Server Components' },
        { id: 'FACT-04', text: 'Raised checkout test coverage from 41% to 95% with Jest and Playwright' },
        { id: 'FACT-03', text: 'Led the college hackathon for 300 students' },
        { id: 'FACT-01', text: 'Built an open-source UPI payment status tracker with Kafka' },
        { id: 'FACT-99', text: 'Invented bullet' },
      ],
    });
    const r = await tailorResume({ job: JOB, facts: FACTS, resumeText: FACTS.map((f) => f.claim).join('\n'), skills: ['react', 'typescript'], useAI: true });
    const byId = Object.fromEntries(r.bullets.map((b) => [b.factId, b]));

    expect(r.bullets).toHaveLength(4); // no invented bullet
    expect(byId['FACT-02']).toMatchObject({ changed: true, text: 'Reduced checkout load time by 38% at Zeta by moving to React Server Components' });
    expect(byId['FACT-04']).toMatchObject({ changed: false, text: FACTS[3].claim });
    expect(byId['FACT-04'].keptOriginalBecause).toMatch(/figure \(95%\)/);
    expect(byId['FACT-03'].keptOriginalBecause).toMatch(/ownership/);
    expect(byId['FACT-01'].keptOriginalBecause).toMatch(/Kafka/);
    expect(r.summary).toMatch(/^Frontend engineer who cut checkout load time 38%/);
    expect(r.missing).toContain('Kafka'); // reported as a gap, never added
  });

  it('drops a summary that invents something', async () => {
    replies.push({ summary: 'Seasoned engineer with 5 years of experience leading teams.', bullets: [] });
    const r = await tailorResume({ job: JOB, facts: FACTS, resumeText: '', skills: [], useAI: true });
    expect(r.summary).toBeUndefined();
    expect(r.summaryDroppedBecause).toMatch(/figure \(5\)|ownership/);
  });

  it('without AI it still reorders, and changes no words', async () => {
    const r = await tailorResume({ job: JOB, facts: FACTS, resumeText: '', skills: ['react'], useAI: false });
    expect(r.bullets.every((b) => !b.changed && b.text === b.original)).toBe(true);
    expect(r.bullets.at(-1)?.factId).toBe('FACT-03');
  });
});

describe('export', async () => {
  const { buildResumeDoc, extractEducation, toDocx, toMarkdown } = await import('../../src/services/resumeExport');
  const { readDocx } = await import('../../src/services/resumeImport');
  const { unzipSync, strFromU8 } = await import('fflate');

  const tailored = {
    jobId: 'j',
    summary: 'Frontend engineer who cut checkout load time 38%.',
    bullets: [{ factId: 'FACT-02', original: 'x', text: 'Cut load time 38% <fast> & small', changed: true, why: '' }],
    skills: ['React', 'TypeScript'],
    covered: [],
    missing: [],
    usedAI: true,
    createdAt: 0,
  };
  const RESUME = 'Aarav Mehta\nEXPERIENCE\nStuff\nEDUCATION\nB.Tech Computer Science, IIT Delhi, 2025\nCGPA 8.6\nSKILLS\nReact';
  const doc = buildResumeDoc(tailored, { userFullName: 'Aarav Mehta', userEmail: 'a@b.in', linkedinUrl: 'https://www.linkedin.com/in/aarav/' }, RESUME, 'Frontend Engineer');

  it('pulls the education block', () => {
    expect(extractEducation(RESUME)).toEqual(['B.Tech Computer Science, IIT Delhi, 2025', 'CGPA 8.6']);
    expect(doc.contact).toEqual(['a@b.in', 'linkedin.com/in/aarav']);
  });
  it('writes a valid .docx that reads back, with text escaped', () => {
    const bytes = toDocx(doc);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    expect(strFromU8(files['word/document.xml'])).toContain('Cut load time 38% &lt;fast&gt; &amp; small');
    const text = readDocx(bytes);
    expect(text).toContain('Aarav Mehta');
    expect(text).toContain('Cut load time 38% <fast> & small');
    expect(text).toContain('B.Tech Computer Science, IIT Delhi, 2025');
  });
  it('writes Markdown', () => {
    expect(toMarkdown(doc)).toContain('## Selected work relevant to Frontend Engineer\n- Cut load time 38% <fast> & small');
  });
});
