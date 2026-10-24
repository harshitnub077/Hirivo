// Interview Pack: built when someone replies. What the company does (from its own homepage and
// linked news, with sources), likely questions for the role, the user's three strongest resume
// facts for it, and three good questions to ask. Facts are only ever the user's own; the company
// summary may not state a figure its sources don't.
import { db } from '../db';
import type { InterviewPack, JobSnapshot, OutreachRecord, ResumeFact } from '../db';
import { getSettings } from '../db/settings';
import { fetchText } from './siteAccess';
import { routeLLMRequest } from '../llm/router';
import { parseJsonLoose } from '../llm/json';
import { jobFamily } from './contactLadder';
import { rankFacts } from './resumeTailor';
import { figuresIn } from './proofWriter';
import { findHooks, type Hook } from './hookFinder';

export interface HomepageMeta {
  url: string;
  title?: string;
  description?: string;
}

const QUESTION_BANK: Record<ReturnType<typeof jobFamily>, string[]> = {
  engineering: [
    'Walk me through a system you built end to end. What would you change now?',
    'How do you find and fix a performance problem in production?',
    'Tell me about a bug that took you a long time to solve.',
    'How do you decide what to test, and what not to?',
    'Design a simplified version of one of our core features.',
  ],
  data: [
    'Walk me through an analysis that changed a decision.',
    'How do you check that a metric means what you think it means?',
    'Tell me about messy data you had to clean. What did you do?',
    'How would you measure the success of one of our products?',
    'Explain a model or method you used to a non-technical person.',
  ],
  design: [
    'Walk me through a project from problem to shipped design.',
    'Tell me about feedback that changed your design.',
    'How do you work with engineers when a design is hard to build?',
    'Critique one of our screens. What would you change?',
    'How do you know a design worked after launch?',
  ],
  product: [
    'Tell me about a product decision you made with incomplete data.',
    'How do you decide what not to build?',
    'Walk me through how you would improve one of our features.',
    'Tell me about a launch that didn’t go as planned.',
    'How do you work with engineering on scope and deadlines?',
  ],
  sales: [
    'Walk me through a deal you won and why it closed.',
    'Tell me about a deal you lost. What did you learn?',
    'How do you research a prospect before the first call?',
    'Sell me our product in two minutes.',
    'How do you manage your pipeline week to week?',
  ],
  marketing: [
    'Tell me about a campaign you ran and how you measured it.',
    'How would you grow awareness for us with a small budget?',
    'Walk me through a piece of content you are proud of.',
    'What channel would you test first for us, and why?',
    'Tell me about an experiment that failed.',
  ],
  other: [
    'Walk me through the work you are most proud of.',
    'Tell me about a problem you solved with little guidance.',
    'How do you prioritise when everything feels urgent?',
    'What would you want to learn in your first three months here?',
    'Tell me about a time you had to learn something fast.',
  ],
};

const BEHAVIOURAL = ['Why this company, and why now?', 'Tell me about a disagreement with a teammate and how it ended.', 'What are you looking for in your next role?'];

export function defaultQuestions(jobTitle: string): string[] {
  return [...QUESTION_BANK[jobFamily(jobTitle)], ...BEHAVIOURAL].slice(0, 8);
}

export function defaultAskThem(hooks: Hook[]): string[] {
  const asks = [
    'What does great look like in this role after the first 90 days?',
    'What is the biggest problem the team is working on right now?',
    'How does the team decide what to build next?',
  ];
  if (hooks[0]) asks[2] = `I read “${hooks[0].title}”. How does that change the team’s priorities this year?`;
  return asks;
}

/** Reads the description a company gives its own homepage. */
export function parseHomepageMeta(html: string, url: string): HomepageMeta {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() || undefined;
  return {
    url,
    title: doc.querySelector('title')?.textContent?.trim() || meta('meta[property="og:site_name"]'),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
  };
}

const achievementsOf = (facts: ResumeFact[]) => facts.filter((f) => !['ROLE', 'EDUCATION', 'SKILL'].includes(f.category));

export interface PackInput {
  outreach: Pick<OutreachRecord, 'companyName' | 'jobTitle'>;
  job?: Pick<JobSnapshot, 'title' | 'description' | 'fitEvidence'>;
  facts: ResumeFact[];
  homepage?: HomepageMeta;
  hooks: Hook[];
  useAI: boolean;
}

export async function buildInterviewPack({ outreach, job, facts, homepage, hooks, useAI }: PackInput): Promise<InterviewPack> {
  const title = job?.title || outreach.jobTitle;
  const jd = job?.description || '';
  const ranked = rankFacts(achievementsOf(facts), `${title}\n${jd}`, job?.fitEvidence).map((r) => r.fact.id);
  const sources = [
    ...(homepage?.description ? [{ title: homepage.title || `${outreach.companyName} homepage`, url: homepage.url }] : []),
    ...hooks.slice(0, 4).map((h) => ({ title: h.title, url: h.url })),
  ];
  const sourceText = [homepage?.title, homepage?.description, ...hooks.map((h) => h.title), jd].filter(Boolean).join('\n');
  const fallbackBrief = homepage?.description || '';

  const pack: InterviewPack = {
    createdAt: Date.now(),
    companyBrief: fallbackBrief,
    sources,
    questions: defaultQuestions(title),
    strongestFacts: ranked.slice(0, 3),
    askThem: defaultAskThem(hooks),
    usedAI: false,
  };
  if (!useAI) return pack;

  const res = await routeLLMRequest({
    taskType: 'fit_analysis',
    jsonMode: true,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `You prepare a candidate for an interview. Use ONLY the sources given; never add facts about the company.
Return ONLY JSON:
{"companyBrief": string (2-3 plain sentences: what the company does and anything recent, only from SOURCES; no numbers that SOURCES don't contain),
 "questions": string[] (8 likely interview questions for THIS role, specific to the job description, mixing technical and behavioural),
 "strongestFactIds": string[] (the 3 FACT ids that best answer what this role needs),
 "askThem": string[] (3 thoughtful questions the candidate should ask, at least one tied to a SOURCE)}`,
      },
      {
        role: 'user',
        content: `ROLE: ${title} at ${outreach.companyName}
JOB DESCRIPTION: ${jd.slice(0, 3500) || '(not available)'}
SOURCES:
${[homepage?.description ? `Homepage: ${homepage.description}` : '', ...hooks.slice(0, 4).map((h) => `${h.sourceLabel} (${new Date(h.date).toISOString().slice(0, 10)}): ${h.title}`)].filter(Boolean).join('\n') || '(none)'}
CANDIDATE FACTS:
${achievementsOf(facts).map((f) => `[${f.id}] ${f.claim}`).join('\n')}`,
      },
    ],
  });
  const p = parseJsonLoose<{ companyBrief?: string; questions?: unknown[]; strongestFactIds?: unknown[]; askThem?: unknown[] }>(res.content);

  const known = new Set(facts.map((f) => f.id));
  const chosen = (Array.isArray(p.strongestFactIds) ? p.strongestFactIds : []).filter((id): id is string => typeof id === 'string' && known.has(id));
  const strongest = Array.from(new Set([...chosen, ...ranked])).slice(0, 3);

  const brief = typeof p.companyBrief === 'string' ? p.companyBrief.trim() : '';
  const sourceFigures = new Set(figuresIn(sourceText));
  const briefOk = brief && sources.length > 0 && figuresIn(brief).every((n) => sourceFigures.has(n));

  const strings = (v: unknown[] | undefined, n: number, fallback: string[]) => {
    const list = (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 8).map((x) => x.trim());
    return list.length >= Math.min(3, n) ? list.slice(0, n) : fallback;
  };

  return {
    ...pack,
    companyBrief: briefOk ? brief : fallbackBrief,
    questions: strings(p.questions, 8, pack.questions),
    strongestFacts: strongest,
    askThem: strings(p.askThem, 3, pack.askThem),
    usedAI: true,
  };
}

export function packAsText(pack: InterviewPack, facts: ResumeFact[], company: string, role: string): string {
  const claim = (id: string) => facts.find((f) => f.id === id)?.claim || id;
  return [
    `Interview pack: ${role} at ${company}`,
    '',
    'What they do',
    pack.companyBrief || '(No description found. Read their homepage before the call.)',
    ...pack.sources.map((s) => `  Source: ${s.title} ${s.url}`),
    '',
    'Likely questions',
    ...pack.questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'Your strongest proof',
    ...pack.strongestFacts.map((id) => `- ${claim(id)}`),
    '',
    'Ask them',
    ...pack.askThem.map((q) => `- ${q}`),
  ].join('\n');
}

/** Gathers sources, builds the pack and saves it on the outreach record. Side panel only (uses DOMParser). */
export async function prepareInterviewPack(outreach: OutreachRecord, { siteAllowed }: { siteAllowed: boolean }): Promise<InterviewPack> {
  const job = await db.jobs.get(outreach.jobId);
  const domain = job?.companyDomain;
  const homepage = domain && siteAllowed ? await fetchText(`https://${domain}`).then((r) => (r.ok ? parseHomepageMeta(r.text, r.url) : undefined)) : undefined;
  const context = [homepage?.title, homepage?.description, job?.description?.slice(0, 2500)].filter(Boolean).join('\n');
  const [hooks, facts, settings] = await Promise.all([
    findHooks({ company: outreach.companyName, domain, siteAllowed, context }).catch(() => [] as Hook[]),
    db.facts.toArray(),
    getSettings(),
  ]);
  const useAI = Boolean(settings.groqApiKey || settings.geminiApiKey || settings.openrouterApiKey);
  const pack = await buildInterviewPack({ outreach, job, facts, homepage, hooks, useAI }).catch(() =>
    buildInterviewPack({ outreach, job, facts, homepage, hooks, useAI: false })
  );
  await db.outreach.update(outreach.id, { interviewPack: pack });
  return pack;
}
