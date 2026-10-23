import { routeLLMRequest } from '../llm/router';
import { ResumeFact, VoiceProfile } from '../db';
import { autoPurgeRoboticPhrases } from './phraseLinter';
import { parseJsonLoose } from '../llm/json';

export interface GroundedSentence {
  sentence: string;
  factIds: string[];
  isGrounded: boolean;
  warning?: string;
}

export interface ProofWriterResult {
  emailSubject: string;
  emailBody: string;
  linkedInNote: string;
  groundedSentences: GroundedSentence[];
  unverifiedClaimsCount: number;
  citedFactIds: string[];
}

export interface ProofWriterParams {
  jobTitle: string;
  companyName: string;
  recipientName?: string;
  recipientRole?: string;
  facts: ResumeFact[];
  voiceProfile?: VoiceProfile;
  realSignalHook?: string; // Recent blog post, GitHub release or news, with its source link
  requirements?: string[]; // what the job asks for, so the two most relevant facts get picked
  senderName?: string;
}

export const firstName = (name?: string) => (name || '').trim().split(/\s+/)[0] || '';

export async function generateProofLinkedDraft(params: ProofWriterParams): Promise<ProofWriterResult> {
  // Never invent facts: with no resume facts there is nothing true to say yet.
  if (params.facts.length === 0) {
    throw new Error('Add your resume in You → Resume first. Hirivo only writes claims it can prove.');
  }
  const effectiveFacts = params.facts;

  const factList = effectiveFacts.map((f) => `[${f.id}]: ${f.claim}`).join('\n');
  const first = firstName(params.recipientName);
  const greetingStyle = (params.voiceProfile?.preferredGreeting || 'Hi [Name],').replace('[Name]', first || 'there');
  const signoff = params.voiceProfile?.preferredSignoff || 'Best,';
  const avgSentenceLength = params.voiceProfile?.avgSentenceLength || 13;
  const sender = params.senderName?.trim() || '';

  const systemPrompt = `You write short cold emails from a job seeker to someone at a company. They must read like a thoughtful person wrote them in five minutes, not like a template or a resume.

STRUCTURE (80-130 words in the body, 3 short paragraphs):
1. Open with "${greetingStyle}". Then one or two sentences on why you're writing to them about this role. If a RECENT SIGNAL is given, reference it plainly in one clause (no gushing). Otherwise say something specific about the role or team.
2. The TWO facts most relevant to what the job needs. Concrete, with their numbers. Each claim is followed by its tag, e.g. "I cut checkout load time 38% [FACT-01]." Never list skills. Never use more than two facts.
3. One small, specific ask that's easy to say yes to (a 15-minute chat this week, or who the right person is). Then "${signoff}"${sender ? ` and "${sender}" on the next line` : ''}.

HARD RULES:
- Every claim about the sender carries a [FACT-xx] tag from the list. Nothing outside the list.
- Never state anything about the company (launches, news, funding, products, culture) unless it is in RECENT SIGNAL. If there is no signal, talk about the role instead.
- Average about ${avgSentenceLength} words per sentence. Plain words. Contractions are fine.
- Never write: "I hope this email finds you well", "I am writing to", "I would love to", "excited", "passionate", "keen", "I specialize in", "leverage", "align with", "accelerate", "add value", "esteemed", "delve", "Thank you for your time and consideration", "Respected Sir/Madam", "caught my eye", "my background fits", "I'm reaching out because".
- Subject: 3-6 words, specific to them, no clickbait, no "Application for".
- LinkedIn note: under 280 characters, first name, one fact with its tag, one ask.

Return ONLY JSON: {"emailSubject": string, "emailBody": string, "linkedInNote": string}`;

  const userPrompt = `ROLE: ${params.jobTitle} at ${params.companyName}
RECIPIENT: ${params.recipientName || 'the hiring team'}${params.recipientRole ? ` (${params.recipientRole})` : ''}
${params.requirements?.length ? `WHAT THE JOB NEEDS MOST:\n- ${params.requirements.slice(0, 6).join('\n- ')}\n` : ''}${params.realSignalHook ? `RECENT SIGNAL: ${params.realSignalHook}\n` : ''}
SENDER'S FACTS:
${factList}`;

  const res = await routeLLMRequest({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    taskType: 'draft_writing',
    jsonMode: true,
    temperature: 0.3,
  });

  const parsed: any = parseJsonLoose(res.content);

  let rawEmailBody = autoPurgeRoboticPhrases(parsed.emailBody || '');
  // Models often greet with the full name; people use first names.
  if (first && params.recipientName && params.recipientName.trim() !== first) {
    rawEmailBody = rawEmailBody.replace(new RegExp(`^(\\s*\\w+\\s+)${params.recipientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `$1${first}`);
  }
  // Make sure the email is signed.
  if (sender && !rawEmailBody.trimEnd().endsWith(sender) && !rawEmailBody.includes(`\n${sender}`)) {
    rawEmailBody = `${rawEmailBody.trimEnd()}\n${sender}`;
  }
  const emailSubject = autoPurgeRoboticPhrases(parsed.emailSubject || `Regarding ${params.jobTitle} at ${params.companyName}`);
  const linkedInNote = autoPurgeRoboticPhrases(parsed.linkedInNote || '');

  const grounding = checkGrounding(rawEmailBody, effectiveFacts, { company: params.companyName, hasHook: Boolean(params.realSignalHook) });

  return {
    emailSubject,
    emailBody: rawEmailBody,
    linkedInNote,
    ...grounding,
  };
}

// Verbs that signal a factual claim about the sender.
const CLAIM_VERBS =
  /\b(built|designed|developed|scaled|reduced|increased|led|managed|migrated|improved|implemented|architected|shipped|launched|grew|cut|saved|won|proficient|experienced|expert)\b/i;

const COMPANY_CLAIM_GENERIC =
  /\b(?:your|the) team(?:'s|’s)?\s+(?:focus|recent|work on|is building|are building|uses|use of|launch)|\brecently (?:launched|released|announced|raised|shipped|acquired)\b|\b(?:you|you've|you have|your company) (?:launched|released|announced|raised|shipped|acquired)\b/i;

/** Client-side grounding check. Re-run on every edit so hand-typed claims are caught too.
 * With `company`, statements about the company also need a source (a hook), or they're flagged. */
export function checkGrounding(body: string, facts: ResumeFact[], opts: { company?: string; hasHook?: boolean } = {}) {
  const companyClaim = opts.company
    ? new RegExp(`${COMPANY_CLAIM_GENERIC.source}|\\b${opts.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s|’s)?\\s+(?:recently |just |new )?(?:launched|released|announced|raised|shipped|acquired|focus|is building|uses)\\b`, 'i')
    : COMPANY_CLAIM_GENERIC;
  const validFactIds = new Set(facts.map((f) => f.id));
  const citedFactIds = new Set<string>();
  const groundedSentences: GroundedSentence[] = [];
  let unverifiedClaimsCount = 0;

  for (const raw of body.match(/[^.!?\n]+[.!?]*/g) || []) {
    const s = raw.trim();
    if (!s) continue;
    const valid = Array.from(s.matchAll(/\[(FACT-\d+)\]/g))
      .map((m) => m[1])
      .filter((id) => validFactIds.has(id));
    valid.forEach((id) => citedFactIds.add(id));

    if (opts.company !== undefined && companyClaim.test(s)) {
      // About the company, not the sender: it needs the hook as its source, not a resume fact.
      if (opts.hasHook) groundedSentences.push({ sentence: s, factIds: valid, isGrounded: true });
      else {
        unverifiedClaimsCount++;
        groundedSentences.push({ sentence: s, factIds: valid, isGrounded: false, warning: 'Says something about the company with no source. Add a hook from “Find recent news”, or cut it.' });
      }
    } else if (valid.length > 0) {
      groundedSentences.push({ sentence: s, factIds: valid, isGrounded: true });
    } else if (CLAIM_VERBS.test(s)) {
      unverifiedClaimsCount++;
      groundedSentences.push({ sentence: s, factIds: [], isGrounded: false, warning: 'Claim with no resume fact behind it.' });
    } else {
      groundedSentences.push({ sentence: s, factIds: [], isGrounded: true });
    }
  }
  return { groundedSentences, unverifiedClaimsCount, citedFactIds: Array.from(citedFactIds) };
}
