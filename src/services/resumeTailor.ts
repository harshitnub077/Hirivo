// Honest per-job resume tailoring. Hirivo may only REORDER and REWORD what the resume already says.
// The model suggests rewrites; code checks each one against its source fact and keeps the
// original wording whenever a rewrite adds a number, changes a figure, names a new technology,
// inflates ownership ("contributed" → "led"), names a new organisation, or pads the line.
import type { FitRequirement, JobSnapshot, ResumeFact, TailoredBullet, TailoredResume } from '../db';
import { routeLLMRequest } from '../llm/router';
import { parseJsonLoose } from '../llm/json';
import { keywordMatch, termsIn } from './keywordMatch';
import { autoPurgeRoboticPhrases } from './phraseLinter';

export type { TailoredBullet, TailoredResume } from '../db';

// ---------- Honesty check ----------

const NUMBER = /\d+(?:[.,]\d+)*(?:\s?%|\s?(?:x|k|m|mn|b|bn|l|cr|lakh|lakhs|crore|crores)\b|\+)?/gi;
const OWNERSHIP = /\b(led|lead|leading|managed|manage|managing|owned|own|owning|architected|headed|directed|spearheaded|mentored|founded|co-?founded|supervised|oversaw)\b/gi;
const PROPER = /\b[A-Z][a-zA-Z0-9&.'’-]*[a-z][a-zA-Z0-9&.'’-]*\b/g;
const COMMON_CAPS = new Set(['Built', 'Cut', 'Wrote', 'Reduced', 'Improved', 'Designed', 'Developed', 'Created', 'Shipped', 'Launched', 'Raised', 'Increased', 'Implemented', 'Migrated', 'Automated', 'Optimized', 'Optimised', 'Delivered', 'Added', 'Made', 'Moved', 'Used', 'Grew', 'Saved', 'Won', 'Deployed', 'Trained', 'Analyzed', 'Analysed', 'Refactored', 'Rewrote', 'Scaled', 'Integrated', 'Partnered', 'Worked', 'Contributed', 'Helped', 'The', 'A', 'An', 'In', 'On', 'For', 'With', 'By', 'And', 'To', 'Of', 'As', 'Across', 'From', 'Using', 'Via', 'At']);

const PUFFERY = /\b(?:widely|highly|hugely|massively|significantly|dramatically|substantially|greatly|world-class|cutting-edge|best-in-class|industry-leading|seasoned|expert|extensive|proven|innovative|exceptional|outstanding|robust|seamless|scalable|enterprise-grade|mission-critical|large-scale)\b/gi;

const numbersIn = (s: string) => (s.match(NUMBER) || []).map((n) => n.replace(/\s/g, '').replace(/,/g, '').toLowerCase());
const ownershipIn = (s: string) => new Set((s.match(OWNERSHIP) || []).map((w) => w.toLowerCase().replace(/ing$|s$|ed$/, '')));
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Generic role words a summary may use to describe the person; never names of organisations or products.
const ROLE_WORDS = /^(?:frontend|front-end|backend|back-end|full-?stack|software|data|product|mobile|web|platform|cloud|ml|ai|engineer|developer|designer|analyst|scientist|intern|student|graduate|fresher)$/i;

/** Every problem that would make the rewrite say more than the original. Empty = honest.
 * `allowRoleWords` lets a summary call the person e.g. "Frontend engineer". */
export function checkRewrite(original: string, rewrite: string, { allowRoleWords = false } = {}): string[] {
  const problems: string[] = [];
  const srcNums = new Set(numbersIn(original));
  const newNums = numbersIn(rewrite).filter((n) => !srcNums.has(n));
  if (newNums.length) problems.push(`adds or changes a figure (${newNums.join(', ')})`);

  const srcTerms = new Set(termsIn(original));
  const newTerms = termsIn(rewrite).filter((t) => !srcTerms.has(t));
  if (newTerms.length) problems.push(`names a technology the original doesn't (${newTerms.join(', ')})`);

  const srcOwn = ownershipIn(original);
  const newOwn = [...ownershipIn(rewrite)].filter((w) => !srcOwn.has(w));
  if (newOwn.length) problems.push(`claims more ownership (“${newOwn.join('”, “')}”)`);

  const srcWords = new Set((original.match(PROPER) || []).map((w) => w.toLowerCase()));
  const srcLower = original.toLowerCase();
  // The first word of a sentence is capitalised by grammar, not because it names something.
  const sentenceStarts = new Set((rewrite.match(/(?:^|[.!?]\s+)([A-Z][a-z]+)/g) || []).map((m) => m.replace(/^[.!?\s]+/, '')));
  const newNames = (rewrite.match(PROPER) || []).filter(
    (w) =>
      !sentenceStarts.has(w) &&
      !COMMON_CAPS.has(w) &&
      !srcWords.has(w.toLowerCase()) &&
      !srcLower.includes(w.toLowerCase()) &&
      !srcTerms.has(w) &&
      !(allowRoleWords && ROLE_WORDS.test(w))
  );
  if (newNames.length) problems.push(`names something the original doesn't (${Array.from(new Set(newNames)).join(', ')})`);

  const srcPuff = new Set((original.match(PUFFERY) || []).map((w) => w.toLowerCase()));
  const newPuff = (rewrite.match(PUFFERY) || []).map((w) => w.toLowerCase()).filter((w) => !srcPuff.has(w));
  if (newPuff.length) problems.push(`inflates it (“${Array.from(new Set(newPuff)).join('”, “')}”)`);

  if (wordCount(rewrite) > Math.round(wordCount(original) * 1.35) + 6) problems.push('is padded well beyond the original');
  if (wordCount(rewrite) < 4) problems.push('drops most of the original');
  return problems;
}

// ---------- Ordering ----------

/** Most relevant facts first: proven requirements (musts count double), then job keywords, then metrics. */
export function rankFacts(facts: ResumeFact[], jobText: string, evidence: FitRequirement[] = []) {
  const jobTerms = new Set(termsIn(jobText));
  return facts
    .map((f, index) => {
      const proves = evidence.filter((r) => r.met && r.factId === f.id);
      const terms = termsIn(f.claim).filter((t) => jobTerms.has(t));
      const score = proves.reduce((n, r) => n + (r.kind === 'must' ? 4 : 2), 0) + terms.length + (/\d/.test(f.claim) ? 0.5 : 0);
      const why = proves.length
        ? `Proves “${proves[0].text}”${proves.length > 1 ? ` and ${proves.length - 1} more` : ''}`
        : terms.length
          ? `Mentions ${terms.slice(0, 3).join(', ')}, which the job names`
          : 'Less related to this job';
      return { fact: f, score, why, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Skills the job names come first; nothing is added that the resume doesn't list. */
export function tailorSkills(resumeSkills: string[], jobText: string, resumeText: string): string[] {
  const jobFirst = keywordMatch(jobText, `${resumeText}\n${resumeSkills.join(', ')}`).present;
  // Canonical names ("TypeScript", "Node.js"); anything the catalogue doesn't know keeps the user's casing.
  const canonical = (skill: string) => termsIn(skill)[0] || (/[A-Z]/.test(skill) ? skill : skill.charAt(0).toUpperCase() + skill.slice(1));
  const rest = Array.from(new Set(resumeSkills.map(canonical))).filter((s) => !jobFirst.includes(s));
  return [...jobFirst, ...rest];
}

// ---------- Tailoring ----------

export interface TailorInput {
  job: Pick<JobSnapshot, 'id' | 'title' | 'company' | 'description' | 'fitEvidence'>;
  facts: ResumeFact[];
  resumeText: string;
  skills: string[];
  useAI: boolean;
}

export async function tailorResume({ job, facts, resumeText, skills, useAI }: TailorInput): Promise<TailoredResume> {
  // Bullets are achievements; a role line, degree or skills list belongs in its own section.
  const achievements = facts.filter((f) => !['ROLE', 'EDUCATION', 'SKILL'].includes(f.category) && !/^(?:experience with|skills?\b|b\.?\s?tech|bachelor|master)/i.test(f.claim));
  if (achievements.length === 0) throw new Error('Add your resume first; tailoring only works with what it already says.');
  const jobText = `${job.title}\n${job.description}`;
  const ranked = rankFacts(achievements, jobText, job.fitEvidence);
  const km = keywordMatch(jobText, `${resumeText}\n${facts.map((f) => f.claim).join('\n')}`);

  let rewrites = new Map<string, string>();
  let summary: string | undefined;
  let summaryDroppedBecause: string | undefined;

  if (useAI) {
    const res = await routeLLMRequest({
      taskType: 'draft_writing',
      jsonMode: true,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `You tailor resume bullets to a job WITHOUT changing what they claim.
For each bullet, you may: lead with the result, use the job's wording for something the bullet already says, tighten it, fix grammar.
You may NOT: add or change any number, add a tool or technology, add a company or product name, upgrade ownership ("helped" stays "helped", "built" never becomes "led"), or add a new achievement. If a bullet can't be improved honestly, return it unchanged.
Also write a 2-sentence summary for the top of the resume using ONLY what the bullets say (no years of experience unless stated, no adjectives like "passionate" or "seasoned").
Return ONLY JSON: {"summary": string, "bullets": [{"id": "FACT-01", "text": string}]}`,
        },
        {
          role: 'user',
          content: `JOB: ${job.title} at ${job.company}
WHAT IT ASKS FOR: ${(job.fitEvidence || []).map((r) => r.text).join('; ') || km.present.concat(km.missing).join(', ')}

BULLETS:
${ranked.map(({ fact }) => `${fact.id}: ${fact.claim}`).join('\n')}`,
        },
      ],
    });
    const parsed = parseJsonLoose<{ summary?: string; bullets?: { id?: string; text?: string }[] }>(res.content);
    for (const b of parsed.bullets || []) {
      if (typeof b?.id === 'string' && typeof b.text === 'string' && facts.some((f) => f.id === b.id)) {
        rewrites.set(b.id, autoPurgeRoboticPhrases(b.text.trim().replace(/^[-•*]\s*/, '')));
      }
    }
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      const candidate = autoPurgeRoboticPhrases(parsed.summary.trim());
      // The summary is checked against everything the resume's facts say, taken together.
      const problems = checkRewrite(`${resumeText}\n${facts.map((f) => f.claim).join(' ')}`, candidate, { allowRoleWords: true }).filter(
        (p) => !p.startsWith('is padded')
      );
      if (problems.length) summaryDroppedBecause = `The suggested summary ${problems[0]}.`;
      else summary = candidate;
    }
  }

  const bullets: TailoredBullet[] = ranked.map(({ fact, why }) => {
    const suggestion = rewrites.get(fact.id);
    if (!suggestion || suggestion === fact.claim) return { factId: fact.id, original: fact.claim, text: fact.claim, changed: false, why };
    const problems = checkRewrite(fact.claim, suggestion);
    if (problems.length) {
      return { factId: fact.id, original: fact.claim, text: fact.claim, changed: false, keptOriginalBecause: `The suggested rewrite ${problems[0]}.`, why };
    }
    return { factId: fact.id, original: fact.claim, text: suggestion, changed: true, why };
  });

  return {
    jobId: job.id,
    summary,
    summaryDroppedBecause,
    bullets,
    skills: tailorSkills(skills, jobText, resumeText),
    covered: km.present,
    missing: km.missing,
    usedAI: useAI,
    createdAt: Date.now(),
  };
}
