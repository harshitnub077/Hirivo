// @vitest-environment jsdom
// Real Interview Pack against a real company site and real AI. Skipped without keys.
import { describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import { patchSettings } from '../../src/db/settings';
import { buildInterviewPack, parseHomepageMeta, packAsText } from '../../src/services/interviewPack';
import { findHooks } from '../../src/services/hookFinder';
import { figuresIn } from '../../src/services/proofWriter';

const GROQ = process.env.GROQ_API_KEY || '';
const FACTS = [
  { id: 'FACT-01', category: 'METRIC' as const, claim: 'Cut checkout page load time 38% by moving to React Server Components', sourceSnippet: '', verified: true },
  { id: 'FACT-02', category: 'PROJECT' as const, claim: 'Built an open-source UPI payment status tracker with 1.2k GitHub stars using TypeScript and Node.js', sourceSnippet: '', verified: true },
  { id: 'FACT-03', category: 'METRIC' as const, claim: 'Wrote Jest and Playwright tests for the checkout flow, raising coverage from 41% to 78%', sourceSnippet: '', verified: true },
];

describe.skipIf(!GROQ)('Interview Pack (live)', () => {
  it('builds a sourced pack for Atlan that cites only real facts', async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await patchSettings({ groqApiKey: GROQ, activeProvider: 'groq' });
    const html = await (await fetch('https://atlan.com')).text();
    const homepage = parseHomepageMeta(html, 'https://atlan.com');
    const hooks = await findHooks({ company: 'Atlan', domain: 'atlan.com', siteAllowed: true, context: `${homepage.title}\n${homepage.description}` });
    for (const h of hooks.filter((x) => x.source === 'news' || x.source === 'hn')) expect(h.title).not.toMatch(/Daniel Atlan|David Atlan|Ross Atlan|Lee Kok Khee|Your Mobile-Focused AI Agent/);
    const pack = await buildInterviewPack({ outreach: { companyName: 'Atlan', jobTitle: 'Frontend Engineer' }, facts: FACTS, homepage, hooks, useAI: true });
    console.log(packAsText(pack, FACTS, 'Atlan', 'Frontend Engineer'));
    expect(pack.usedAI).toBe(true);
    expect(pack.questions).toHaveLength(8);
    expect(pack.strongestFacts.every((id) => FACTS.some((f) => f.id === id))).toBe(true);
    const sourceFigures = new Set(figuresIn([homepage.title, homepage.description, ...hooks.map((h) => h.title)].join(' ')));
    expect(figuresIn(pack.companyBrief).every((n) => sourceFigures.has(n))).toBe(true);
  }, 180_000);
});
