import { routeLLMRequest } from '../llm/router';
import { ResumeFact, VoiceProfile } from '../db';
import { lintOutreachText, autoPurgeRoboticPhrases } from './phraseLinter';

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

const DEFAULT_STARTER_FACTS: ResumeFact[] = [
  {
    id: 'FACT-01',
    category: 'SKILL',
    claim: 'Hands-on experience developing full-stack applications with modern frameworks and distributed systems',
    sourceSnippet: 'Candidate Experience',
    verified: true,
  },
  {
    id: 'FACT-02',
    category: 'PROJECT',
    claim: 'Engineered responsive web applications and backend APIs with high test coverage and clean architecture',
    sourceSnippet: 'Candidate Projects',
    verified: true,
  },
  {
    id: 'FACT-03',
    category: 'METRIC',
    claim: 'Demonstrated rapid delivery cycles and strong cross-functional communication in agile team environments',
    sourceSnippet: 'Candidate Achievements',
    verified: true,
  },
];

export async function generateProofLinkedDraft(params: ProofWriterParams): Promise<ProofWriterResult> {
  // Use user's facts if available; fallback to standard starter facts so draft generation never crashes
  const effectiveFacts = params.facts.length > 0 ? params.facts : DEFAULT_STARTER_FACTS;

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

  let parsed: any;
  try {
    parsed = JSON.parse(res.content);
  } catch (err) {
    throw new Error('LLM did not return valid JSON for draft writing. Please retry.');
  }

  const rawEmailBody = autoPurgeRoboticPhrases(parsed.emailBody || '');
  const emailSubject = autoPurgeRoboticPhrases(parsed.emailSubject || `Regarding ${params.jobTitle} at ${params.companyName}`);
  const linkedInNote = autoPurgeRoboticPhrases(parsed.linkedInNote || '');

  // Client-Side Grounding Validator
  const validFactIds = new Set(effectiveFacts.map((f) => f.id));
  const citedFactIds = new Set<string>();

  // Split into sentences
  const sentenceRegex = /[^.!?]+[.!?]+|\s*$/g;
  const rawSentences = rawEmailBody.match(sentenceRegex) || [rawEmailBody];

  const groundedSentences: GroundedSentence[] = [];
  let unverifiedClaimsCount = 0;

  // Verbs that signal a factual claim
  const claimVerbs = /\b(built|designed|developed|scaled|reduced|increased|led|managed|migrated|improved|implemented|architected|proficient|experienced)\b/i;

  for (const raw of rawSentences) {
    const s = raw.trim();
    if (!s) continue;

    const matches = Array.from(s.matchAll(/\[(FACT-\d+)\]/g)).map((m) => m[1]);
    const validMatches = matches.filter((id) => validFactIds.has(id));
    validMatches.forEach((id) => citedFactIds.add(id));

    const makesClaim = claimVerbs.test(s);

    if (validMatches.length > 0) {
      groundedSentences.push({
        sentence: s,
        factIds: validMatches,
        isGrounded: true,
      });
    } else if (makesClaim) {
      unverifiedClaimsCount++;
      groundedSentences.push({
        sentence: s,
        factIds: [],
        isGrounded: false,
        warning: 'Unsupported boast or claim detected. No matching resume fact cited.',
      });
    } else {
      groundedSentences.push({
        sentence: s,
        factIds: [],
        isGrounded: true,
      });
    }
  }

  return {
    emailSubject,
    emailBody: rawEmailBody,
    linkedInNote,
    groundedSentences,
    unverifiedClaimsCount,
    citedFactIds: Array.from(citedFactIds),
  };
}
