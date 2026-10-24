// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSnapshot, ResumeFact } from '../../src/db';

const replies: unknown[] = [];
vi.mock('../../src/llm/router', () => ({
  routeLLMRequest: vi.fn(async () => ({ content: JSON.stringify(replies.shift()), providerUsed: 'groq', model: 'mock', cached: false })),
}));

const { db } = await import('../../src/db');
const { buildDaily5, localDayKey, nextDailyAt, pickDaily5 } = await import('../../src/services/daily5');
const { buildInterviewPack, defaultQuestions, parseHomepageMeta, packAsText } = await import('../../src/services/interviewPack');
const { realVerdict } = await import('../../src/services/verdicts');

const NOW = new Date(2026, 9, 24, 9, 0, 0).getTime();
const DAY = 86_400_000;

const cand = (over: Record<string, unknown>) => ({
  id: String(over.id),
  source: 'discovered' as const,
  title: 'Frontend Engineer',
  company: String(over.company ?? over.id),
  url: `https://x/${over.id}`,
  warm: false,
  real: 'neutral' as const,
  safety: 'neutral' as const,
  ...over,
});

describe('pickDaily5', () => {
  it('never picks a Doubtful or Risky role, however strong it looks', () => {
    const picks = pickDaily5(
      [
        cand({ id: 'ghost', fit: 99, postedAt: NOW, warm: true, real: 'risk' }),
        cand({ id: 'scam', fit: 99, postedAt: NOW, safety: 'risk' }),
        cand({ id: 'ok', fit: 40 }),
      ],
      { now: NOW }
    );
    expect(picks.map((p) => p.id)).toEqual(['ok']);
  });

  it('ranks by fit, freshness and a warm path, with reasons', () => {
    const picks = pickDaily5(
      [
        cand({ id: 'old-low', fit: 50, postedAt: NOW - 30 * DAY }),
        cand({ id: 'fresh-warm', fit: 70, postedAt: NOW - DAY, warm: true, real: 'ok' }),
        cand({ id: 'fresh', fit: 70, postedAt: NOW - DAY }),
        cand({ id: 'stale', fit: 95, postedAt: NOW - 60 * DAY }),
      ],
      { now: NOW }
    );
    expect(picks.map((p) => p.id)).toEqual(['fresh-warm', 'fresh', 'old-low']);
    expect(picks[0].reasons).toEqual(['70% fit', 'posted 1 d ago', 'you know someone there', 'live on their board']);
  });

  it('caps at five, two per company, and rotates yesterday’s picks down', () => {
    const many = Array.from({ length: 9 }, (_, i) => cand({ id: `j${i}`, company: i < 4 ? 'Acme' : `Co${i}`, fit: 90 - i }));
    const picks = pickDaily5(many, { now: NOW, recentIds: new Set(['j4']) });
    expect(picks).toHaveLength(5);
    expect(picks.filter((p) => p.company === 'Acme')).toHaveLength(2);
    expect(picks.map((p) => p.id)).not.toContain('j4');
  });
});

describe('dates', () => {
  it('schedules the next 8:00 local', () => {
    expect(new Date(nextDailyAt(new Date(2026, 9, 24, 7, 30).getTime())).getHours()).toBe(8);
    expect(nextDailyAt(new Date(2026, 9, 24, 9, 0).getTime())).toBe(new Date(2026, 9, 25, 8, 0).getTime());
    expect(localDayKey(new Date(2026, 0, 5, 1, 0).getTime())).toBe('2026-01-05');
  });
});

describe('buildDaily5 (end to end on the database)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('keeps a Doubtful analyzed role out even when Discover also lists it', async () => {
    const doubtful: JobSnapshot = {
      id: 'linkedin:1', url: 'https://linkedin.com/jobs/view/1', title: 'Backend Engineer', company: 'Lendo', location: '', description: '',
      analyzedAt: NOW, atsType: 'greenhouse', ghostScore: 75, fitScore: 90,
    };
    expect(realVerdict(doubtful).label).toBe('Doubtful');
    const live: JobSnapshot = { ...doubtful, id: 'linkedin:2', title: 'Frontend Engineer', company: 'Zeta', ghostScore: 8, fitScore: 60 };
    await db.jobs.bulkPut([doubtful, live]);
    await db.discovered.put({
      id: 'remotive:9', source: 'remotive', sourceLabel: 'Remotive', title: 'Backend Engineer', company: 'Lendo', location: 'Remote', remote: true,
      url: 'https://remotive.com/9', tags: [], score: 95, matchReasons: [], status: 'new', firstSeenAt: NOW, postedAt: NOW,
    });
    const row = await buildDaily5(NOW);
    expect(row.picks.map((p) => p.company)).toEqual(['Zeta']);
    expect(await db.daily.get(localDayKey(NOW))).toMatchObject({ picks: row.picks });
  });
});

const FACTS: ResumeFact[] = [
  { id: 'FACT-01', category: 'METRIC', claim: 'Cut checkout page load time 38% by moving to React Server Components', sourceSnippet: '', verified: true },
  { id: 'FACT-02', category: 'PROJECT', claim: 'Built an open-source UPI payment status tracker in TypeScript', sourceSnippet: '', verified: true },
  { id: 'FACT-03', category: 'METRIC', claim: 'Wrote Jest and Playwright tests raising coverage from 41% to 78%', sourceSnippet: '', verified: true },
  { id: 'FACT-04', category: 'EDUCATION', claim: 'B.Tech, IIT Delhi', sourceSnippet: '', verified: true },
];
const HOME = parseHomepageMeta(
  '<html><head><title>Zeta | Banking tech</title><meta name="description" content="Zeta builds modern card and banking software for banks in 12 countries."></head></html>',
  'https://zeta.tech'
);
const HOOKS = [{ id: 'h', source: 'blog' as const, sourceLabel: 'zeta.tech blog', title: 'Launching Zeta Tachyon 2', url: 'https://zeta.tech/blog/t2', date: NOW - 3 * DAY, suggestion: '' }];
const OUT = { companyName: 'Zeta', jobTitle: 'Frontend Engineer' };

describe('Interview Pack', () => {
  beforeEach(() => {
    replies.length = 0;
  });

  it('reads the homepage description', () => {
    expect(HOME).toEqual({ url: 'https://zeta.tech', title: 'Zeta | Banking tech', description: 'Zeta builds modern card and banking software for banks in 12 countries.' });
  });

  it('only ever cites the user’s own facts, and drops a brief with invented figures', async () => {
    replies.push({
      companyBrief: 'Zeta builds banking software and has 5,000 employees.',
      questions: Array.from({ length: 10 }, (_, i) => `Question number ${i + 1} about checkout performance?`),
      strongestFactIds: ['FACT-99', 'FACT-03', 'FACT-01'],
      askThem: ['How does Tachyon 2 change the frontend roadmap?', 'What does great look like in 90 days?', 'How is the team split?'],
    });
    const pack = await buildInterviewPack({ outreach: OUT, facts: FACTS, homepage: HOME, hooks: HOOKS, useAI: true });
    expect(pack.strongestFacts).toHaveLength(3);
    expect(pack.strongestFacts.every((id) => FACTS.some((f) => f.id === id))).toBe(true);
    expect(pack.strongestFacts.slice(0, 2)).toEqual(['FACT-03', 'FACT-01']);
    expect(pack.strongestFacts).not.toContain('FACT-04'); // a degree is not proof of the work
    expect(pack.companyBrief).toBe(HOME.description); // 5,000 isn't in the sources
    expect(pack.questions).toHaveLength(8);
    expect(pack.sources.map((s) => s.url)).toEqual(['https://zeta.tech', 'https://zeta.tech/blog/t2']);
  });

  it('keeps a brief that stays within its sources', async () => {
    replies.push({ companyBrief: 'Zeta makes banking software for banks in 12 countries and recently launched Tachyon 2.', questions: [], strongestFactIds: [], askThem: [] });
    const pack = await buildInterviewPack({ outreach: OUT, facts: FACTS, homepage: HOME, hooks: HOOKS, useAI: true });
    expect(pack.companyBrief).toMatch(/12 countries/);
    expect(pack.questions).toEqual(defaultQuestions('Frontend Engineer'));
  });

  it('works without AI, from the question bank and ranked facts', async () => {
    const pack = await buildInterviewPack({ outreach: OUT, facts: FACTS, homepage: HOME, hooks: HOOKS, useAI: false });
    expect(pack.usedAI).toBe(false);
    expect(pack.questions[0]).toMatch(/system you built/);
    expect(pack.askThem[2]).toContain('Launching Zeta Tachyon 2');
    expect(packAsText(pack, FACTS, 'Zeta', 'Frontend Engineer')).toContain('Your strongest proof\n- ');
  });
});
