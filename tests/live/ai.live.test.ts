// Real AI calls. Keys come only from the environment (GROQ_API_KEY, GEMINI_API_KEY) and are never
// stored in the repo. Without keys this file is skipped. Run: GROQ_API_KEY=… npm run test:live
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import { patchSettings } from '../../src/db/settings';
import { buildProfile, isTraceable } from '../../src/services/resumeImport';
import { analyzeJobFit, computeFitScore } from '../../src/services/fitAdvisor';
import { generateProofSprint } from '../../src/services/proofSprint';
import { checkGrounding, generateProofLinkedDraft } from '../../src/services/proofWriter';
import { routeLLMRequest } from '../../src/llm/router';
import { htmlToText } from '../../src/services/discover/hn';

const GROQ = process.env.GROQ_API_KEY || '';
const GEMINI = process.env.GEMINI_API_KEY || '';

const RESUME = `Aarav Mehta
Bengaluru · aarav.mehta@gmail.com · +91 98765 43210 · github.com/aaravm
EXPERIENCE
Frontend Engineer Intern, Zeta (Jan 2025 – Jun 2025)
• Cut checkout page load time 38% by moving to React Server Components
• Wrote Jest and Playwright tests for the checkout flow, raising coverage from 41% to 78%
PROJECTS
• Built an open-source UPI payment status tracker with 1.2k GitHub stars using TypeScript and Node.js
• Built a Chrome extension that summarises Razorpay settlement reports, used by 300 merchants
SKILLS
React, TypeScript, Node.js, PostgreSQL, Docker, Tailwind
EDUCATION
B.Tech Computer Science, IIT Delhi, 2025`;

describe.skipIf(!GROQ && !GEMINI)('real AI flows', () => {
  let jd = '';
  let jobTitle = '';

  beforeAll(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await patchSettings({ groqApiKey: GROQ, geminiApiKey: GEMINI, activeProvider: GROQ ? 'groq' : 'gemini' });
    const data = await (await fetch('https://boards-api.greenhouse.io/v1/boards/razorpaysoftwareprivatelimited/jobs?content=true')).json();
    // A posting with a real description (some Razorpay postings are placeholders).
    const job = data.jobs.find((j: any) => /engineer|developer|sde/i.test(j.title) && /requirement|qualification|you have|experience in|years of/i.test(htmlToText(htmlToText(j.content || ''))) && !/needs to be added/i.test(j.content)) || data.jobs[0];
    jobTitle = job.title;
    jd = htmlToText(htmlToText(job.content));
  }, 60_000);

  it('structures a resume without inventing facts', async () => {
    const p = await buildProfile(RESUME);
    console.log(`profile: usedAI=${p.usedAI}, ${p.facts.length} facts, roles: ${p.roles.map((r) => `${r.title} (${r.level})`).join(', ')}`);
    expect(p.usedAI).toBe(true);
    expect(p.facts.length).toBeGreaterThanOrEqual(3);
    for (const f of p.facts) expect(isTraceable(f.claim, RESUME)).toBe(true);
    expect(p.roles.length).toBeGreaterThan(0);
    await db.facts.bulkPut(p.facts);
  }, 120_000);

  it('scores fit from an evidence table on a real Razorpay posting', async () => {
    const facts = await db.facts.toArray();
    const r = await analyzeJobFit(jobTitle, 'Razorpay', jd, null, facts, { yearsExperience: 0.5, skills: ['react', 'typescript'] });
    console.log(`fit for "${jobTitle}": ${r.matchScore}% ${r.verdict}\n${r.evidence.map((e) => `  ${e.met ? '✓' : '✗'} [${e.kind}] ${e.text} → ${e.factId ?? 'gap'}: ${e.reason}`).join('\n')}`);
    expect(r.evidence.length).toBeGreaterThan(2);
    expect(r.matchScore).toBe(computeFitScore(r.evidence));
    const ids = new Set(facts.map((f) => f.id));
    for (const e of r.evidence) if (e.factId && e.factId !== 'SKILLS') expect(ids.has(e.factId)).toBe(true);
  }, 180_000);

  it('plans a Proof Sprint for the biggest gap', async () => {
    const facts = await db.facts.toArray();
    const r = await analyzeJobFit(jobTitle, 'Razorpay', jd, null, facts, { yearsExperience: 0.5 });
    if (!r.evidence.some((e) => !e.met)) return;
    const sprint = await generateProofSprint({ title: jobTitle, company: 'Razorpay', fitEvidence: r.evidence }, facts);
    console.log(`sprint: ${sprint.title} (${sprint.days.length} days) → "${sprint.factClaim}"`);
    expect(sprint.days.length).toBeGreaterThanOrEqual(3);
    expect(sprint.days.length).toBeLessThanOrEqual(7);
  }, 180_000);

  it('writes a grounded email that cites only real facts', async () => {
    const facts = await db.facts.toArray();
    const d = await generateProofLinkedDraft({
      jobTitle,
      companyName: 'Razorpay',
      recipientName: 'Priya Sharma',
      recipientRole: 'Engineering Manager',
      facts,
      senderName: 'Aarav Mehta',
      requirements: ['Strong frontend engineering with React', 'Payments domain experience', 'Writing tests'],
    });
    const g = checkGrounding(d.emailBody, facts);
    const words = d.emailBody.replace(/\[FACT-\d+\]/g, '').split(/\s+/).filter(Boolean).length;
    console.log(`subject: ${d.emailSubject}\n${d.emailBody}\n-- ${words} words, unverified claims: ${g.unverifiedClaimsCount}, cited: ${g.citedFactIds.join(', ')}`);
    expect(d.emailBody.startsWith('Hi Priya,')).toBe(true);
    expect(g.unverifiedClaimsCount).toBe(0);
    expect(g.citedFactIds.length).toBeGreaterThan(0);
    expect(g.citedFactIds.length).toBeLessThanOrEqual(3);
    expect(words).toBeLessThan(170);
    expect(d.emailBody).toContain('Aarav Mehta');
  }, 120_000);

  it.skipIf(!GEMINI)('falls back to Gemini when Groq is unavailable', async () => {
    await patchSettings({ groqApiKey: 'gsk_invalid_key_for_fallback_test', activeProvider: 'groq' });
    const r = await routeLLMRequest({ taskType: 'general', messages: [{ role: 'user', content: 'Reply with the single word: ok' }], skipCache: true });
    console.log(`fallback answered by ${r.providerUsed} (${r.model})`);
    expect(r.providerUsed).toBe('gemini');
    await patchSettings({ groqApiKey: GROQ });
  }, 60_000);
});
