import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FitRequirement, JobSnapshot, ResumeFact } from '../../src/db';

// The model is mocked: each test decides exactly what "the AI" returns, in call order.
const replies: unknown[] = [];
const calls: { taskType: string }[] = [];
vi.mock('../../src/llm/router', () => ({
  routeLLMRequest: vi.fn(async (req: { taskType: string }) => {
    calls.push({ taskType: req.taskType });
    return { content: JSON.stringify(replies.shift()), providerUsed: 'groq', model: 'mock', cached: false };
  }),
}));

const { analyzeJobFit, applyMatches, cleanRequirements, computeFitScore } = await import('../../src/services/fitAdvisor');
const { applySprintCompletion, cleanSprint, completeProofSprint, generateProofSprint, nextFactId, pickSprintGap, sprintEligible } = await import(
  '../../src/services/proofSprint'
);
const { checkGrounding } = await import('../../src/services/proofWriter');
const { db } = await import('../../src/db');

const FRONTEND_FACTS: ResumeFact[] = [
  { id: 'FACT-01', category: 'METRIC', claim: 'Cut checkout page load time 38% by moving to React Server Components', sourceSnippet: '', verified: true },
  { id: 'FACT-02', category: 'PROJECT', claim: 'Built an open-source UPI payment status tracker in TypeScript and Node.js', sourceSnippet: '', verified: true },
  { id: 'FACT-03', category: 'PROJECT', claim: 'Wrote Jest and Playwright tests for the checkout flow', sourceSnippet: '', verified: true },
];

const GO_JD = `Senior Backend Engineer (Go)
Requirements:
- 5+ years building backend services in Go
- Deep experience with distributed systems and Kafka
- Strong PostgreSQL and data modelling skills
- Experience running services on Kubernetes
Nice to have:
- Experience with gRPC
- Familiarity with TypeScript for internal tools`;

beforeEach(() => {
  replies.length = 0;
  calls.length = 0;
});

describe('computeFitScore', () => {
  it('counts must-haves twice and nice-to-haves once', () => {
    // musts: 2 met of 3 (weight 4 of 6); nice: 1 met of 2 (1 of 2) → 5/8 = 62.5 → 63
    const rows = [
      { kind: 'must', met: true },
      { kind: 'must', met: true },
      { kind: 'must', met: false },
      { kind: 'nice', met: true },
      { kind: 'nice', met: false },
    ] as const;
    expect(computeFitScore([...rows])).toBe(63);
    expect(computeFitScore([])).toBe(0);
  });
});

describe('cleanRequirements', () => {
  it('drops requirements the job never mentions and de-duplicates', () => {
    const reqs = cleanRequirements(
      {
        requirements: [
          { text: '5+ years building backend services in Go', kind: 'must', years: 5 },
          { text: '5+ years building backend services in Go', kind: 'must', years: 5 },
          { text: 'Ten years of Haskell and a PhD in category theory', kind: 'must' },
          { text: 'Experience with gRPC', kind: 'nice', years: null },
        ],
      },
      GO_JD
    );
    expect(reqs).toEqual([
      { id: 'R1', text: '5+ years building backend services in Go', kind: 'must', years: 5 },
      { id: 'R2', text: 'Experience with gRPC', kind: 'nice' },
    ]);
  });
});

describe('applyMatches', () => {
  const reqs = [
    { id: 'R1', text: 'React performance work', kind: 'must' as const },
    { id: 'R2', text: '5+ years of frontend', kind: 'must' as const, years: 5 },
    { id: 'R3', text: 'GraphQL', kind: 'nice' as const },
  ];
  it('rejects invented fact ids and years the user does not have', () => {
    const out = applyMatches(
      reqs,
      {
        matches: [
          { id: 'R1', factId: 'FACT-01', reason: 'Cut load time with RSC.' },
          { id: 'R2', factId: 'FACT-02', reason: 'Long frontend career.' },
          { id: 'R3', factId: 'FACT-99', reason: 'Used GraphQL everywhere.' },
        ],
      },
      FRONTEND_FACTS,
      1.5
    );
    expect(out.map((r) => [r.id, r.met, r.factId])).toEqual([
      ['R1', true, 'FACT-01'],
      ['R2', false, null],
      ['R3', false, null],
    ]);
    expect(out[1].reason).toBe('Asks for 5+ years; your resume shows about 1.5.');
    expect(out[2].reason).toBe('Nothing in your resume shows this yet.');
  });
});

describe('analyzeJobFit', () => {
  it('a frontend resume against a senior Go job scores under 40 with gaps listed', async () => {
    replies.push(
      {
        requirements: [
          { text: '5+ years building backend services in Go', kind: 'must', years: 5 },
          { text: 'Deep experience with distributed systems and Kafka', kind: 'must' },
          { text: 'Strong PostgreSQL and data modelling skills', kind: 'must' },
          { text: 'Experience running services on Kubernetes', kind: 'must' },
          { text: 'Experience with gRPC', kind: 'nice' },
          { text: 'Familiarity with TypeScript for internal tools', kind: 'nice' },
        ],
      },
      {
        matches: [
          { id: 'R1', factId: null, reason: 'No Go work on the resume.' },
          { id: 'R2', factId: null, reason: 'No distributed systems work shown.' },
          { id: 'R3', factId: null, reason: 'No PostgreSQL work shown.' },
          { id: 'R4', factId: null, reason: 'No Kubernetes shown.' },
          { id: 'R5', factId: null, reason: 'No gRPC shown.' },
          { id: 'R6', factId: 'FACT-02', reason: 'Built a TypeScript tracker.' },
        ],
      }
    );
    const r = await analyzeJobFit('Senior Backend Engineer (Go)', 'Lendo', GO_JD, null, FRONTEND_FACTS, { yearsExperience: 2 });

    expect(calls.map((c) => c.taskType)).toEqual(['general', 'fit_analysis']);
    expect(r.matchScore).toBe(computeFitScore(r.evidence));
    expect(r.matchScore).toBe(10); // 1 of 10 weight
    expect(r.matchScore).toBeLessThan(40);
    expect(r.verdict).toBe('DO_NOT_APPLY');
    expect(r.dealbreakers).toEqual([
      '5+ years building backend services in Go',
      'Deep experience with distributed systems and Kafka',
      'Strong PostgreSQL and data modelling skills',
      'Experience running services on Kubernetes',
    ]);
    expect(r.honestAdvice).toMatch(/^You meet 0 of 4 must-haves\. Gaps: 5\+ years building backend services in Go; Deep experience/);
  });

  it('refuses to run without resume facts', async () => {
    await expect(analyzeJobFit('X', 'Y', GO_JD, null, [])).rejects.toThrow(/resume/);
  });
});

describe('Proof Sprint', () => {
  const evidence: FitRequirement[] = [
    { id: 'R1', text: 'React performance work', kind: 'must', factId: 'FACT-01', reason: '', met: true },
    { id: 'R2', text: 'Experience with GraphQL APIs', kind: 'must', factId: null, reason: '', met: false },
    { id: 'R3', text: 'Design systems', kind: 'nice', factId: null, reason: '', met: false },
  ];
  const job: JobSnapshot = {
    id: 'linkedin:1',
    url: 'https://www.linkedin.com/jobs/view/1',
    title: 'Frontend Engineer',
    company: 'Zeta',
    location: '',
    description: '',
    analyzedAt: 1,
    fitEvidence: evidence,
    fitScore: computeFitScore(evidence), // 2 of 5 → 40
  };

  it('is offered only for partial fits with a gap, and targets the first missing must-have', () => {
    expect(job.fitScore).toBe(40);
    expect(sprintEligible(job)).toBe(true);
    expect(sprintEligible({ ...job, fitScore: 30 })).toBe(false);
    expect(sprintEligible({ ...job, fitScore: 75 })).toBe(false);
    expect(pickSprintGap(evidence)?.id).toBe('R2');
  });

  it('validates the plan: 3–7 days, no invented metrics in the fact', () => {
    const plan = cleanSprint(
      {
        title: 'GraphQL gateway for UPI status',
        scope: 'A GraphQL layer over the tracker.',
        stack: ['Apollo Server', 'TypeScript', 'PostgreSQL'],
        days: Array.from({ length: 9 }, (_, i) => ({ day: i + 1, task: `Task ${i + 1}` })),
        deliverable: 'Repo and a short write-up',
        factClaim: 'Built a GraphQL gateway serving 10,000 users with 99% uptime over a UPI status tracker',
      },
      evidence[1],
      123
    );
    expect(plan.days).toHaveLength(7);
    expect(plan.gapId).toBe('R2');
    expect(plan.factClaim).toBe('Built GraphQL gateway for UPI status using Apollo Server, TypeScript, PostgreSQL');
    expect(() => cleanSprint({ title: 'x', days: [{ task: 'a' }], factClaim: 'y' }, evidence[1])).toThrow(/incomplete/);
  });

  it('generates a plan for the biggest gap', async () => {
    replies.push({
      title: 'GraphQL gateway for UPI status',
      scope: 'Wrap the tracker in GraphQL.',
      stack: ['Apollo Server', 'TypeScript'],
      days: ['Schema', 'Resolvers', 'Auth', 'Tests', 'Write-up'],
      deliverable: 'Repo + demo',
      factClaim: 'Built a GraphQL API with Apollo Server and TypeScript over my UPI status tracker',
    });
    const plan = await generateProofSprint(job, FRONTEND_FACTS);
    expect(calls.map((c) => c.taskType)).toEqual(['draft_writing']);
    expect(plan.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it('finishing adds a fact the writer can cite, covers the gap and rescores', async () => {
    await db.facts.clear();
    await db.facts.bulkPut(FRONTEND_FACTS);
    const sprintJob: JobSnapshot = {
      ...job,
      proofSprint: cleanSprint(
        {
          title: 'GraphQL gateway',
          days: ['a', 'b', 'c'],
          factClaim: 'Built a GraphQL API with Apollo Server and TypeScript over my UPI status tracker',
        },
        evidence[1],
        1
      ),
    };
    await db.jobs.put(sprintJob);

    const { job: done, fact } = await completeProofSprint(sprintJob, 'github.com/aarav/upi-graphql');
    expect(fact.id).toBe('FACT-04');
    expect(fact.claim).toBe('Built a GraphQL API with Apollo Server and TypeScript over my UPI status tracker (github.com/aarav/upi-graphql)');
    expect(await db.facts.get('FACT-04')).toEqual(fact);
    expect(done.fitEvidence?.find((r) => r.id === 'R2')).toMatchObject({ met: true, factId: 'FACT-04' });
    expect(done.fitScore).toBe(80); // 4 of 5
    expect(done.fitVerdict).toBe('STRONG_FIT');
    expect(done.proofSprint?.completedAt).toBeGreaterThan(0);

    const facts = await db.facts.toArray();
    const g = checkGrounding('I built a GraphQL API over my UPI tracker [FACT-04].', facts);
    expect(g.unverifiedClaimsCount).toBe(0);
    expect(g.citedFactIds).toEqual(['FACT-04']);
  });

  it('nextFactId and applySprintCompletion are safe on odd input', () => {
    expect(nextFactId([{ id: 'FACT-09' }, { id: 'FACT-12' }])).toBe('FACT-13');
    expect(applySprintCompletion({ ...job, proofSprint: undefined }, 'FACT-05')).toEqual({ ...job, proofSprint: undefined });
  });
});
