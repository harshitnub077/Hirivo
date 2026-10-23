// Proof Sprint: when a job is a partial fit (40–70), plan a 3–7 day project that closes the
// biggest must-have gap. When the user finishes it, it becomes a resume fact the writer can
// cite, and the requirement it covers counts as met.
import { db, FitRequirement, JobSnapshot, ProofSprint, ResumeFact } from '../db';
import { routeLLMRequest } from '../llm/router';
import { parseJsonLoose } from '../llm/json';
import { adviceFor, computeFitScore, verdictFor } from './fitAdvisor';

export const SPRINT_MIN_SCORE = 40;
export const SPRINT_MAX_SCORE = 70;

export function sprintEligible(job: Pick<JobSnapshot, 'fitScore' | 'fitEvidence'>): boolean {
  return (
    job.fitScore !== undefined &&
    job.fitScore >= SPRINT_MIN_SCORE &&
    job.fitScore <= SPRINT_MAX_SCORE &&
    Boolean(job.fitEvidence?.some((r) => !r.met))
  );
}

/** The gap to close first: the first unmet must-have (requirements are ordered by importance). */
export function pickSprintGap(evidence: FitRequirement[]): FitRequirement | undefined {
  return evidence.find((r) => r.kind === 'must' && !r.met) || evidence.find((r) => !r.met);
}

const METRIC = /\d[\d,.]*\s*(?:%|x\b|k\b|users|stars|downloads|requests|rps|ms\b|uptime|customers)/i;

const plainClaim = (title: string, stack: unknown) => {
  const tools = (Array.isArray(stack) ? stack : []).filter((s): s is string => typeof s === 'string').slice(0, 3);
  return `Built ${title}${tools.length ? ` using ${tools.join(', ')}` : ''}`;
};

/** Checks and normalises the model's plan. Exported for tests. */
export function cleanSprint(raw: any, gap: FitRequirement, now = Date.now()): ProofSprint {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const days = (Array.isArray(raw?.days) ? raw.days : [])
    .map((d: any) => str(typeof d === 'string' ? d : d?.task, 220))
    .filter(Boolean)
    .slice(0, 7)
    .map((task: string, i: number) => ({ day: i + 1, task }));
  const title = str(raw?.title, 80);
  const factClaim = str(raw?.factClaim, 180);
  if (!title || days.length < 3 || !factClaim) throw new Error('The sprint plan came back incomplete. Try again.');
  return {
    gapId: gap.id,
    gap: gap.text,
    title,
    scope: str(raw?.scope, 400),
    stack: (Array.isArray(raw?.stack) ? raw.stack : []).map((s: unknown) => str(s, 30)).filter(Boolean).slice(0, 6),
    days,
    deliverable: str(raw?.deliverable, 240),
    // The fact describes what was built, never results the user hasn't measured yet.
    factClaim: METRIC.test(factClaim) ? plainClaim(title, raw?.stack) : factClaim,
    createdAt: now,
  };
}

export async function generateProofSprint(
  job: Pick<JobSnapshot, 'title' | 'company' | 'fitEvidence'>,
  facts: ResumeFact[],
  skills: string[] = []
): Promise<ProofSprint> {
  const gap = pickSprintGap(job.fitEvidence || []);
  if (!gap) throw new Error('No gaps to close for this job.');
  const res = await routeLLMRequest({
    taskType: 'draft_writing',
    jsonMode: true,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `You design a small, real project that lets a job seeker prove one missing skill within a week, alone, for free.
Return ONLY JSON:
{"title": string (under 8 words),
 "scope": string (2 sentences: what it does and why it proves the skill),
 "stack": string[] (3-6 tools, free to use),
 "days": [{"day": 1, "task": string}] (3 to 7 days, one concrete task each, last day = write-up and demo),
 "deliverable": string (what to show: repo, live link, short write-up),
 "factClaim": string (one resume line, past tense, describing what was built and what it uses; no made-up numbers)}
Make it relevant to the company's product where possible. Build on what the person already knows.`,
      },
      {
        role: 'user',
        content: `JOB: ${job.title} at ${job.company}
GAP TO CLOSE: ${gap.text}${gap.years ? ` (${gap.years}+ years asked; aim for credible hands-on proof, not years)` : ''}
WHAT THEY ALREADY KNOW: ${[...facts.slice(0, 6).map((f) => f.claim), skills.join(', ')].filter(Boolean).join(' | ')}`,
      },
    ],
  });
  return cleanSprint(parseJsonLoose(res.content), gap);
}

export function nextFactId(facts: Pick<ResumeFact, 'id'>[]): string {
  const n = Math.max(0, ...facts.map((f) => Number(f.id.replace(/\D/g, '')) || 0)) + 1;
  return `FACT-${String(n).padStart(2, '0')}`;
}

/** Pure: the job after the sprint is done, with the gap covered and the score recomputed. */
export function applySprintCompletion(job: JobSnapshot, factId: string, link?: string, now = Date.now()): JobSnapshot {
  const sprint = job.proofSprint;
  if (!sprint || !job.fitEvidence) return job;
  const evidence = job.fitEvidence.map((r) =>
    r.id === sprint.gapId ? { ...r, met: true, factId, reason: `Covered by your Proof Sprint: ${sprint.title}.` } : r
  );
  const score = computeFitScore(evidence);
  return {
    ...job,
    fitEvidence: evidence,
    fitScore: score,
    fitVerdict: verdictFor(score),
    honestAdvice: adviceFor(evidence, score),
    dealbreakers: evidence.filter((r) => r.kind === 'must' && !r.met).map((r) => r.text),
    matchingStrengths: evidence.filter((r) => r.met).map((r) => r.text),
    proofSprint: { ...sprint, completedAt: now, factId, link: link || undefined },
  };
}

/** Adds the sprint as a resume fact and updates the job. Returns the new fact. */
export async function completeProofSprint(job: JobSnapshot, link?: string): Promise<{ job: JobSnapshot; fact: ResumeFact }> {
  const sprint = job.proofSprint;
  if (!sprint) throw new Error('No sprint to complete.');
  const cleanLink = link?.trim().replace(/[).,]+$/, '');
  return db.transaction('rw', db.facts, db.jobs, async () => {
    const facts = await db.facts.toArray();
    const fact: ResumeFact = {
      id: nextFactId(facts),
      category: 'PROJECT',
      claim: cleanLink ? `${sprint.factClaim} (${cleanLink})` : sprint.factClaim,
      sourceSnippet: `Proof Sprint for ${job.title} at ${job.company}`,
      verified: true,
    };
    await db.facts.put(fact);
    const updated = applySprintCompletion(job, fact.id, cleanLink);
    await db.jobs.put(updated);
    return { job: updated, fact };
  });
}
