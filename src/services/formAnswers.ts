// AI answers for the application-form questions the profile can't settle: "Why do you want to
// work here?", "Tell us about a project", "Experience with Kafka?", a cover-letter box.
// Same rule as everywhere else in Hirivo: claims about the applicant come only from their resume
// facts, sentences the facts don't back are cut, and a question the resume can't answer honestly
// comes back as null so the user answers it.
import { db } from '../db';
import { getSettings } from '../db/settings';
import { routeLLMRequest } from '../llm/router';
import { parseJsonLoose } from '../llm/json';
import { checkGrounding, fixCompanyName, removeUnsupported, trimEmbellishment } from './proofWriter';
import { autoPurgeRoboticPhrases } from './phraseLinter';
import { stripCitations } from './outreach';
import type { AskQuestion, AskRequest, AskResponse } from '../content/profileTypes';

const LONG = (q: AskQuestion) => q.kind === 'textarea' || /cover letter|tell us|describe|explain|why\b|what (?:excites|interests|motivates)/i.test(q.label);
const COVER = (q: AskQuestion) => /cover letter/i.test(q.label);

/** Finds the saved job for this page, for its full description when the form page has none. */
async function savedJob(url: string) {
  const base = url.replace(/\/(apply|application)\/?(\?.*)?$/, '').replace(/[?#].*$/, '');
  const jobs = await db.jobs.toArray();
  return jobs.find((j) => j.url && (j.url.startsWith(base) || base.startsWith(j.url.replace(/[?#].*$/, ''))));
}

const lengthFor = (q: AskQuestion) => {
  if (COVER(q)) return '150-220 words, 3 short paragraphs, starting "Dear hiring team," and ending "Best," and the name';
  if (LONG(q)) return q.maxLength && q.maxLength < 700 ? `under ${Math.floor(q.maxLength / 6)} words` : '50-120 words, one or two short paragraphs';
  return q.maxLength ? `under ${q.maxLength} characters` : 'a few words, never more than one sentence';
};

/** Cleans one model answer: allowed options only for choices; grounded, human text for prose. */
export function finishAnswer(q: AskQuestion, raw: unknown, facts: { id: string; claim: string }[], company: string, jobText = ''): string | string[] | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (q.options.length) {
    const wanted = (Array.isArray(raw) ? raw : [raw]).map(String);
    const exact = wanted.map((w) => q.options.find((o) => o.toLowerCase() === w.toLowerCase().trim())).filter(Boolean) as string[];
    if (!exact.length) return null;
    return q.kind === 'checkboxes' ? exact : exact[0];
  }
  let text = fixCompanyName(trimEmbellishment(autoPurgeRoboticPhrases(String(raw).trim())), company);
  if (!text) return null;
  if (LONG(q)) {
    // Sentences that claim something the facts don't show are cut, not shipped.
    const asFacts = facts.map((f) => ({ ...f, category: 'PROJECT' as const, sourceSnippet: f.claim, verified: true }));
    const opts = { company, hasHook: false, jobText };
    const g = checkGrounding(text, asFacts, opts);
    if (g.unverifiedClaimsCount > 0) text = removeUnsupported(text, asFacts, opts);
  }
  text = stripCitations(text).replace(/[ \t]+/g, ' ').trim();
  if (q.maxLength && text.length > q.maxLength) text = text.slice(0, q.maxLength).replace(/\s+\S*$/, '');
  return text.length > 1 ? text : null;
}

export async function answerFormQuestions(req: AskRequest): Promise<AskResponse> {
  const [settings, facts, voice] = await Promise.all([getSettings(), db.facts.toArray(), db.voiceProfiles.get('default')]);
  if (!settings.groqApiKey && !settings.geminiApiKey && !settings.openrouterApiKey) {
    return { answers: {}, error: 'Add a free AI key in Hirivo → You → AI keys to write these answers.' };
  }
  if (facts.length === 0) return { answers: {}, error: 'Upload your resume in Hirivo first. Answers only use facts from it.' };

  const job = await savedJob(req.job.url);
  const description = (req.job.description || job?.description || '').slice(0, 4500);
  const company = req.job.company || job?.company || '';
  const title = req.job.title || job?.title || '';
  const profile = [
    settings.userFullName && `Name: ${settings.userFullName}`,
    settings.currentTitle && `Current title: ${settings.currentTitle}${settings.currentCompany ? ` at ${settings.currentCompany}` : ''}`,
    settings.yearsExperience !== undefined && `Years of experience: ${settings.yearsExperience}`,
    settings.userCollege && `Education: ${[settings.degree, settings.userCollege, settings.graduationYear].filter(Boolean).join(', ')}`,
    settings.skills?.length && `Skills: ${settings.skills.join(', ')}`,
    settings.preferredLocation && `Based in: ${settings.preferredLocation}`,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await routeLLMRequest({
    taskType: 'draft_writing',
    jsonMode: true,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: `You fill in a job application for a real person, in their own voice. Answers must read like a thoughtful human wrote them for THIS job: specific, plain, warm, no template phrases.

HONESTY (most important):
- Everything about the applicant comes ONLY from FACTS and PROFILE. Never invent skills, numbers, employers, tools, dates, salaries, preferences or availability.
- Each claim about the applicant in a long answer carries its fact tag, e.g. "I cut load time 38% [FACT-01]."
- Motivation questions ("Why do you want to work here?", "Why this role?", "What interests you?") are always answerable: connect the work described in JOB TEXT (or the role title) to one or two of the applicant's facts. Never null for these, and never invent facts about the company.
- If the question asks something FACTS and PROFILE don't show (a skill they don't list, a certification, a preference, a commitment like office days, a legal matter, salary, notice period, visa, references), answer null. A wrong answer on an application is worse than a blank.
- Choice questions: answer with one of the given options copied exactly (an array of options for checkbox lists), or null. "Yes" to a skill question only when a fact or the skills line shows it; otherwise null, not "No".
- Never say anything about the company that isn't in the JOB text.

STYLE for written answers: first person, answer the question in the first sentence, contractions fine${voice ? `, about ${voice.avgSentenceLength} words per sentence` : ''}, at most three facts. Never write: "I am writing to", "I would love to", "passionate", "excited", "keen", "leverage", "align with", "I believe I would be a great fit", "esteemed", "Thank you for your time and consideration", "dynamic", "synergy".
Cover letters sign off with "${settings.userFullName || 'the applicant'}".

Return ONLY JSON: {"answers": [{"id": string, "answer": string | string[] | null}]}`,
      },
      {
        role: 'user',
        content: `JOB: ${title} at ${company}
${description ? `JOB TEXT:\n${description}\n` : ''}
PROFILE:
${profile}

FACTS:
${facts.map((f) => `[${f.id}] ${f.claim}`).join('\n')}

QUESTIONS:
${req.questions
  .map((q) => `- id ${q.id} (${q.options.length ? `${q.kind === 'checkboxes' ? 'pick any of' : 'pick one of'}: ${q.options.slice(0, 40).map((o) => `"${o}"`).join(', ')}` : `write ${lengthFor(q)}`}): ${q.label}`)
  .join('\n')}`,
      },
    ],
  });

  const parsed = parseJsonLoose<{ answers?: { id?: string; answer?: unknown }[] }>(res.content);
  const answers: AskResponse['answers'] = {};
  for (const q of req.questions) {
    const a = (parsed.answers || []).find((x) => x?.id === q.id);
    answers[q.id] = finishAnswer(q, a?.answer, facts, company, description);
  }
  return { answers };
}
