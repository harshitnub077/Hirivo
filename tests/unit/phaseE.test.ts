// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSnapshot } from '../../src/db';

const replies: unknown[] = [];
vi.mock('../../src/llm/router', () => ({
  routeLLMRequest: vi.fn(async () => ({ content: JSON.stringify(replies.shift()), providerUsed: 'groq', model: 'mock', cached: false })),
}));

const { db } = await import('../../src/db');
const { buildDaily5, localDayKey, nextDailyAt, pickDaily5 } = await import('../../src/services/daily5');
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
