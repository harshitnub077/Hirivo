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
  realSignalHook?: string; // Recent blog post, GitHub commit, or company news
}

export async function generateProofLinkedDraft(params: ProofWriterParams): Promise<ProofWriterResult> {
  // Never invent facts: with no resume facts there is nothing true to say yet.
  if (params.facts.length === 0) {
    throw new Error('Add your resume in You → Resume first. Hirivo only writes claims it can prove.');
  }
  const effectiveFacts = params.facts;

  const factList = effectiveFacts.map((f) => `[${f.id}]: ${f.claim}`).join('\n');
  const greeting = params.voiceProfile?.preferredGreeting || 'Hi [Name],';
  const signoff = params.voiceProfile?.preferredSignoff || 'Best,';
  const avgSentenceLength = params.voiceProfile?.avgSentenceLength || 13;

  const systemPrompt = `You are Hirivo's Proof-Linked Outreach Engine.
Your task is to write a highly compelling, authentic cold outreach email and a short LinkedIn connection note.

CRITICAL GROUNDING RULES:
1. Every single claim, metric, tool experience, or achievement you state MUST be followed immediately by its bracketed fact ID, for example: "I reduced PostgreSQL p99 latency by 45% [FACT-01]."
2. You are FORBIDDEN from inventing ANY claim, skill, or experience not present in the provided fact list.
3. NEVER make generic ungrounded assertions like "I am deeply passionate about your mission" or "I am an innovative problem solver".
4. Adopt the user's stylistic voice profile: target ~${avgSentenceLength} words per sentence. Use the greeting format "${greeting}" and sign-off "${signoff}".
5. NO AI clichés or banned robotic phrases ("hope this email finds you well", "delve", "testament to", "spearheaded", "keen interest").

Return ONLY a valid JSON object matching this schema:
{
  "emailSubject": "<Concise, curiosity-inducing subject line in under 7 words>",
  "emailBody": "<The full email body with fact citations [FACT-xx]>",
  "linkedInNote": "<A concise LinkedIn note under 280 characters with fact citation>"
}`;

  const userPrompt = `TARGET JOB: ${params.jobTitle}
COMPANY: ${params.companyName}
RECIPIENT: ${params.recipientName || 'Hiring Manager'} ${params.recipientRole ? `(${params.recipientRole})` : ''}
${params.realSignalHook ? `RECENT VERIFIABLE SIGNAL/NEWS: ${params.realSignalHook}` : ''}

AVAILABLE GROUNDED RESUME FACTS:
${factList}

Generate the grounded outreach draft following all rules.`;

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

  const rawEmailBody = autoPurgeRoboticPhrases(parsed.emailBody || '');
  const emailSubject = autoPurgeRoboticPhrases(parsed.emailSubject || `Regarding ${params.jobTitle} at ${params.companyName}`);
  const linkedInNote = autoPurgeRoboticPhrases(parsed.linkedInNote || '');

  const grounding = checkGrounding(rawEmailBody, effectiveFacts);

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

/** Client-side grounding check. Re-run on every edit so hand-typed claims are caught too. */
export function checkGrounding(body: string, facts: ResumeFact[]) {
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

    if (valid.length > 0) {
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
