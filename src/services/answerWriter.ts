// Answers application questions ("Why us?", "Tell us about a project") and writes cover letters,
// with the same rule as outreach: every claim about the applicant cites a resume fact, and
// nothing is said about the company without a sourced hook.
import { routeLLMRequest, type LLMMessage } from '../llm/router';
import { parseJsonLoose } from '../llm/json';
import type { ResumeFact, VoiceProfile } from '../db';
import { checkGrounding, trimEmbellishment } from './proofWriter';
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
  jobText?: string;
}

export async function writeAnswer(p: AnswerParams) {
  if (p.facts.length === 0) throw new Error('Add your resume first. Answers only use facts your resume backs up.');
  if (p.mode === 'answer' && !p.question?.trim()) throw new Error('Paste the question from the application form.');

  const length = p.mode === 'cover' ? '170-240 words in 3-4 short paragraphs' : '60-140 words, one or two short paragraphs';
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `You write ${p.mode === 'cover' ? 'a cover letter' : 'an answer to a job application question'} for a job seeker. It must sound like a specific person, not a template.
- Length: ${length}. First person, plain words, contractions fine${p.voiceProfile ? `, about ${p.voiceProfile.avgSentenceLength} words per sentence` : ''}.
- Use at most THREE facts, the ones most relevant to what the job needs. Each claim about the applicant is followed by its tag, e.g. "I cut load time 38% [FACT-01]." Nothing outside the facts.
- If the facts don't match this kind of role, never fill the gap: no experience, tools or duties the facts don't show. Say what honestly carries over, briefly.
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
  ];
  const res = await routeLLMRequest({ taskType: 'draft_writing', jsonMode: true, temperature: 0.4, messages });
  const clean = (content: string) => trimEmbellishment(autoPurgeRoboticPhrases(String(parseJsonLoose<{ text?: string }>(content).text || '')));
  const ground = (t: string) => checkGrounding(t, p.facts, { company: p.companyName, hasHook: Boolean(p.hook), hookText: p.hook, jobText: p.jobText });
  let text = clean(res.content);
  if (!text) throw new Error('The answer came back empty. Try again.');
  let grounding = ground(text);

  // One repair round, as for emails: send back what the facts don't support and keep the better one.
  // On jobs far from the resume, models fill the gap with invented experience; this catches most of it.
  if (grounding.unverifiedClaimsCount > 0) {
    const flagged = grounding.groundedSentences.filter((g) => !g.isGrounded).map((g) => `- "${g.sentence}" (${g.warning})`).join('\n');
    try {
      const retry = await routeLLMRequest({
        taskType: 'draft_writing',
        jsonMode: true,
        temperature: 0.2,
        skipCache: true,
        messages: [
          ...messages,
          { role: 'assistant', content: res.content },
          { role: 'user', content: `These sentences claim things the facts don't support:\n${flagged}\nRewrite without them. If the facts don't fit this role, say less and talk about what honestly carries over. Same JSON.` },
        ],
      });
      const repaired = clean(retry.content);
      const g2 = ground(repaired);
      if (repaired && g2.unverifiedClaimsCount < grounding.unverifiedClaimsCount) [text, grounding] = [repaired, g2];
    } catch {
      /* keep the first answer; its flags are shown */
    }
  }
  return { text, grounding };
}
