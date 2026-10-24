// Answers application questions ("Why us?", "Tell us about a project") and writes cover letters,
// with the same rule as outreach: every claim about the applicant cites a resume fact, and
// nothing is said about the company without a sourced hook.
import { routeLLMRequest } from '../llm/router';
import { parseJsonLoose } from '../llm/json';
import type { ResumeFact, VoiceProfile } from '../db';
import { checkGrounding } from './proofWriter';
import { autoPurgeRoboticPhrases } from './phraseLinter';

export type AnswerMode = 'answer' | 'cover';

export const QUESTION_PRESETS = [
  'Why do you want to work here?',
  'Tell us about a project you are proud of.',
  'Why are you a good fit for this role?',
  'Describe a hard problem you solved.',
];

export interface AnswerParams {
  mode: AnswerMode;
  question?: string;
  jobTitle: string;
  companyName: string;
  facts: ResumeFact[];
  requirements?: string[];
  hook?: string;
  voiceProfile?: VoiceProfile;
  senderName?: string;
}

export async function writeAnswer(p: AnswerParams) {
  if (p.facts.length === 0) throw new Error('Add your resume first. Answers only use facts your resume backs up.');
  if (p.mode === 'answer' && !p.question?.trim()) throw new Error('Paste the question from the application form.');

  const length = p.mode === 'cover' ? '170-240 words in 3-4 short paragraphs' : '60-140 words, one or two short paragraphs';
  const res = await routeLLMRequest({
    taskType: 'draft_writing',
    jsonMode: true,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: `You write ${p.mode === 'cover' ? 'a cover letter' : 'an answer to a job application question'} for a job seeker. It must sound like a specific person, not a template.
- Length: ${length}. First person, plain words, contractions fine${p.voiceProfile ? `, about ${p.voiceProfile.avgSentenceLength} words per sentence` : ''}.
- Use at most THREE facts, the ones most relevant to what the job needs. Each claim about the applicant is followed by its tag, e.g. "I cut load time 38% [FACT-01]." Nothing outside the facts.
- Never state anything about the company unless it is in RECENT SIGNAL. Otherwise write about the role and the work.
- Answer the actual question first, in the first sentence. No restating the question.
- Never write: "I am writing to", "I would love to", "passionate", "excited", "keen", "leverage", "align with", "I believe I would be a great fit", "Thank you for your time and consideration", "esteemed".
${p.mode === 'cover' ? `- Start with "Dear hiring team," and end with "Best," and ${p.senderName ? `"${p.senderName}"` : 'the applicant name'} on the next line.` : '- No greeting or sign-off.'}
Return ONLY JSON: {"text": string}`,
      },
      {
        role: 'user',
        content: `ROLE: ${p.jobTitle} at ${p.companyName}
${p.mode === 'answer' ? `QUESTION: ${p.question}\n` : ''}${p.requirements?.length ? `WHAT THE JOB NEEDS:\n- ${p.requirements.slice(0, 6).join('\n- ')}\n` : ''}${p.hook ? `RECENT SIGNAL: ${p.hook}\n` : ''}
FACTS:
${p.facts.map((f) => `[${f.id}]: ${f.claim}`).join('\n')}`,
      },
    ],
  });
  const text = autoPurgeRoboticPhrases(String(parseJsonLoose<{ text?: string }>(res.content).text || ''));
  if (!text) throw new Error('The answer came back empty. Try again.');
  return { text, grounding: checkGrounding(text, p.facts, { company: p.companyName, hasHook: Boolean(p.hook) }) };
}
