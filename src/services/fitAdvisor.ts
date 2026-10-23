// Honest fit, as an evidence table:
//   1. extract the job's requirements (fast model),
//   2. match each one to the single resume fact that proves it (reasoning model),
//   3. compute the score in code: must-haves count twice, nice-to-haves once.
// The model never produces the number, and its output is checked against the job text,
// the user's real facts and their years of experience before it counts.
import { routeLLMRequest } from '../llm/router';
import { FitRequirement, ResumeFact, ResumeRecord } from '../db';
import { parseJsonLoose } from '../llm/json';
import { isTraceable } from './resumeImport';

export interface FitAnalysisResult {
  matchScore: number; // 0-100, from computeFitScore
  verdict: 'STRONG_FIT' | 'MODERATE_FIT' | 'DO_NOT_APPLY';
  honestAdvice: string;
  dealbreakers: string[];
  matchingStrengths: string[];
  skillGaps: { skill: string; studyRecommendation: string; timeToAcquire: string }[];
  evidence: FitRequirement[];
}

export const MUST_WEIGHT = 2;
export const NICE_WEIGHT = 1;
const MAX_REQUIREMENTS = 12;

/** Score = weighted share of requirements met. Must-haves count twice. */
export function computeFitScore(evidence: Pick<FitRequirement, 'kind' | 'met'>[]): number {
  const weight = (r: Pick<FitRequirement, 'kind'>) => (r.kind === 'must' ? MUST_WEIGHT : NICE_WEIGHT);
  const total = evidence.reduce((n, r) => n + weight(r), 0);
  if (total === 0) return 0;
  const met = evidence.filter((r) => r.met).reduce((n, r) => n + weight(r), 0);
  return Math.round((met / total) * 100);
}

export function verdictFor(score: number): FitAnalysisResult['verdict'] {
  return score >= 80 ? 'STRONG_FIT' : score >= 55 ? 'MODERATE_FIT' : 'DO_NOT_APPLY';
}

/** Plain-language summary built from the table, so the advice can't contradict the score. */
export function adviceFor(evidence: FitRequirement[], score: number): string {
  const musts = evidence.filter((r) => r.kind === 'must');
  const mustMet = musts.filter((r) => r.met).length;
  const gaps = musts.filter((r) => !r.met).map((r) => r.text);
  const head = musts.length ? `You meet ${mustMet} of ${musts.length} must-haves.` : `You meet ${evidence.filter((r) => r.met).length} of ${evidence.length} listed requirements.`;
  if (score >= 80) return `${head} Strong case: lead with the facts in green.`;
  if (gaps.length === 0) return `${head} The missing pieces are nice-to-haves, so it's still worth a short, specific note.`;
  const list = gaps.slice(0, 2).join('; ');
  if (score >= 40) return `${head} Biggest gap: ${list}. A small project that proves it would change this conversation.`;
  return `${head} Gaps: ${list}. This is a long shot today; spend the effort on closer matches.`;
}

/** Normalises and checks the model's requirement list. Exported for tests. */
export function cleanRequirements(raw: unknown, jobDescription: string): Omit<FitRequirement, 'factId' | 'reason' | 'met'>[] {
  const list = Array.isArray((raw as any)?.requirements) ? (raw as any).requirements : [];
  const seen = new Set<string>();
  const out: Omit<FitRequirement, 'factId' | 'reason' | 'met'>[] = [];
  for (const r of list) {
    const text = typeof r?.text === 'string' ? r.text.trim().replace(/\s+/g, ' ') : '';
    if (text.length < 3 || text.length > 200) continue;
    // Paraphrase is fine; invention is not. Half the words must come from the job text.
    if (!isTraceable(text, jobDescription, 0.5, 1)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const years = Number(r?.years);
    out.push({
      id: `R${out.length + 1}`,
      text,
      kind: r?.kind === 'nice' ? 'nice' : 'must',
      ...(Number.isFinite(years) && years > 0 && years < 30 ? { years } : {}),
    });
    if (out.length === MAX_REQUIREMENTS) break;
  }
  return out;
}

/** Applies the model's matches, rejecting unknown facts and years the user doesn't have. */
export function applyMatches(
  requirements: Omit<FitRequirement, 'factId' | 'reason' | 'met'>[],
  raw: unknown,
  facts: ResumeFact[],
  yearsExperience?: number
): FitRequirement[] {
  const matches: any[] = Array.isArray((raw as any)?.matches) ? (raw as any).matches : [];
  const factIds = new Set(facts.map((f) => f.id));
  return requirements.map((req) => {
    const m = matches.find((x) => x?.id === req.id);
    const proposed: string | null = typeof m?.factId === 'string' ? m.factId : null;
    const valid = proposed !== null && (factIds.has(proposed) || proposed === 'SKILLS');
    const modelReason = typeof m?.reason === 'string' ? m.reason.trim() : '';
    let factId = valid ? proposed : null;
    // An invented fact id gets a neutral reason; the model's text would claim a match that isn't there.
    let reason = valid ? modelReason || 'Backed by your resume.' : proposed === null && modelReason ? modelReason : 'Nothing in your resume shows this yet.';
    if (factId && req.years !== undefined && yearsExperience !== undefined && yearsExperience + 0.5 < req.years) {
      factId = null;
      reason = `Asks for ${req.years}+ years; your resume shows about ${Math.round(yearsExperience * 10) / 10}.`;
    }
    return { ...req, factId, reason, met: factId !== null };
  });
}

export async function analyzeJobFit(
  jobTitle: string,
  companyName: string,
  jobDescription: string,
  resume: ResumeRecord | null,
  facts: ResumeFact[],
  options: { yearsExperience?: number; skills?: string[] } = {}
): Promise<FitAnalysisResult> {
  if (facts.length === 0) {
    throw new Error('Add your resume in You → Resume so the fit check compares the job against your real achievements.');
  }
  const jd = jobDescription.slice(0, 7000);

  const extracted = await routeLLMRequest({
    taskType: 'general',
    jsonMode: true,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `Extract the hiring requirements from a job description.
Return ONLY JSON: {"requirements":[{"text": string, "kind": "must"|"nice", "years": number|null}]}
- At most ${MAX_REQUIREMENTS}, most important first. Keep each under 12 words, using the description's own wording.
- "must": required, minimum, must-have, or stated plainly as needed. "nice": preferred, bonus, plus, good to have.
- "years": the minimum years of experience if stated for that requirement, else null.
- Skip benefits, company description, equal-opportunity text and logistics.`,
      },
      { role: 'user', content: `JOB: ${jobTitle} at ${companyName}\n\n${jd}` },
    ],
  });
  const requirements = cleanRequirements(parseJsonLoose(extracted.content), `${jobTitle}\n${jd}`);
  if (requirements.length === 0) throw new Error('Could not find clear requirements in this job description.');

  const matched = await routeLLMRequest({
    taskType: 'fit_analysis',
    jsonMode: true,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You check a candidate's evidence against job requirements. Be strict and honest.
For each requirement pick the ONE resume fact that clearly proves it, or null.
- A related but weaker skill is NOT a match (React does not prove Go; an internship does not prove 5 years).
- Use "SKILLS" only when the skill is listed in the skills line but no fact shows it being used.
Return ONLY JSON: {"matches":[{"id": "R1", "factId": "FACT-03"|"SKILLS"|null, "reason": "one short sentence"}]}`,
      },
      {
        role: 'user',
        content: `REQUIREMENTS:\n${requirements.map((r) => `${r.id} (${r.kind}${r.years ? `, ${r.years}+ yrs` : ''}): ${r.text}`).join('\n')}

RESUME FACTS:\n${facts.map((f) => `[${f.id}] ${f.claim}`).join('\n')}
${options.skills?.length ? `\nSKILLS LINE: ${options.skills.join(', ')}` : ''}
${resume?.rawText && facts.length < 4 ? `\nRESUME TEXT (for context only; cite facts by id):\n${resume.rawText.slice(0, 2500)}` : ''}`,
      },
    ],
  });
  const evidence = applyMatches(requirements, parseJsonLoose(matched.content), facts, options.yearsExperience);

  const matchScore = computeFitScore(evidence);
  return {
    matchScore,
    verdict: verdictFor(matchScore),
    honestAdvice: adviceFor(evidence, matchScore),
    dealbreakers: evidence.filter((r) => r.kind === 'must' && !r.met).map((r) => r.text),
    matchingStrengths: evidence.filter((r) => r.met).map((r) => r.text),
    skillGaps: [],
    evidence,
  };
}
