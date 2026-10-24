import { routeLLMRequest } from '../llm/router';
import { ResumeFact, VoiceProfile } from '../db';
import { autoPurgeRoboticPhrases } from './phraseLinter';
import { parseJsonLoose } from '../llm/json';
import { termsIn } from './keywordMatch';

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
  /** Who this person is and what to ask them (founder, recruiter, hiring manager…). */
  angle?: string;
  /** The job posting, a valid source for sentences that describe the role. */
  jobText?: string;
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
3. One small, specific ask that's easy to say yes to (a 15-minute chat this week, or who the right person is). If HOW TO WRITE TO THEM gives an ask, use that one. Then "${signoff}"${sender ? ` and "${sender}" on the next line` : ''}.

HARD RULES:
- Every claim about the sender carries a [FACT-xx] tag from the list. Nothing outside the list.
- Restate each fact as it is. Never add what it "demonstrates", what it "required", or a skill it doesn't name. If the facts don't fit this job, say less rather than stretch them.
- Never state anything about the company (launches, news, funding, products, culture) unless it is in RECENT SIGNAL. If there is no signal, talk about the role instead.
- Average about ${avgSentenceLength} words per sentence. Plain words. Contractions are fine.
- Never write: "I hope this email finds you well", "I am writing to", "I would love to", "excited", "passionate", "keen", "I specialize in", "leverage", "align with", "accelerate", "add value", "esteemed", "delve", "Thank you for your time and consideration", "Respected Sir/Madam", "caught my eye", "my background fits", "I'm reaching out because".
- Subject: 3-6 words, specific to them, no clickbait, no "Application for".
- LinkedIn note: under 280 characters, first name, one fact with its tag, one ask.

Return ONLY JSON: {"emailSubject": string, "emailBody": string, "linkedInNote": string}`;

  const userPrompt = `ROLE: ${params.jobTitle} at ${params.companyName}
RECIPIENT: ${params.recipientName || 'the hiring team'}${params.recipientRole ? ` (${params.recipientRole})` : ''}
${params.angle ? `HOW TO WRITE TO THEM: ${params.angle}\n` : ''}${params.requirements?.length ? `WHAT THE JOB NEEDS MOST:\n- ${params.requirements.slice(0, 6).join('\n- ')}\n` : ''}${params.realSignalHook ? `RECENT SIGNAL: ${params.realSignalHook}\n` : ''}
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

  const finish = (raw: any) => {
    let body = trimEmbellishment(autoPurgeRoboticPhrases(raw.emailBody || ''));
    // Models often greet with the full name; people use first names.
    if (first && params.recipientName && params.recipientName.trim() !== first) {
      body = body.replace(new RegExp(`^(\\s*\\w+\\s+)${params.recipientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `$1${first}`);
    }
    // Make sure the email is signed.
    if (sender && !body.trimEnd().endsWith(sender) && !body.includes(`\n${sender}`)) body = `${body.trimEnd()}\n${sender}`;
    body = fixCompanyName(autoCite(body, effectiveFacts), params.companyName)
      // "…this week? Best," → the sign-off on its own line.
      .replace(/([.!?])[ \t]+((?:Best|Thanks|Thank you|Regards|Best regards|Warm regards|Cheers),)[ \t]*\n/g, '$1\n\n$2\n');
    return {
      emailSubject: autoPurgeRoboticPhrases(raw.emailSubject || `Regarding ${params.jobTitle} at ${params.companyName}`),
      emailBody: body,
      linkedInNote: autoPurgeRoboticPhrases(raw.linkedInNote || ''),
      ...checkGrounding(body, effectiveFacts, { company: params.companyName, hasHook: Boolean(params.realSignalHook), hookText: params.realSignalHook, jobText: params.jobText }),
    };
  };

  let draft = finish(parseJsonLoose(res.content));

  // One repair round: send the unsupported sentences back and keep whichever draft claims less.
  if (draft.unverifiedClaimsCount > 0) {
    const flagged = draft.groundedSentences.filter((g) => !g.isGrounded).map((g) => `- "${g.sentence}" (${g.warning})`).join('\n');
    try {
      const retry = await routeLLMRequest({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: res.content },
          { role: 'user', content: `These sentences say things the facts don't support:\n${flagged}\nRewrite the email without them. Do not replace them with other claims. Same JSON.` },
        ],
        taskType: 'draft_writing',
        jsonMode: true,
        temperature: 0.2,
        skipCache: true,
      });
      const repaired = finish(parseJsonLoose(retry.content));
      if (repaired.unverifiedClaimsCount < draft.unverifiedClaimsCount && repaired.emailBody.trim()) draft = repaired;
    } catch {
      /* keep the first draft; its flags are shown to the user */
    }
  }

  return draft;
}

/** Removes the sentences the grounding check flagged (the user's one-click fix). */
export function removeUnsupported(body: string, facts: ResumeFact[], opts: Parameters<typeof checkGrounding>[2] = {}): string {
  const bad = new Set(checkGrounding(body, facts, opts).groundedSentences.filter((g) => !g.isGrounded).map((g) => g.sentence));
  return body
    .replace(SENTENCES, (sentence) => (bad.has(sentence.trim()) ? '' : sentence))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const contentWords = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9%.+#]{3,}/g) || []).map((w) => w.replace(/\.$/, '')));

/** Adds the missing [FACT-xx] tag to a sentence that plainly restates one of the facts.
 * Only tags; never changes words. A sentence that matches no fact stays untagged and gets flagged. */
export function autoCite(body: string, facts: ResumeFact[]): string {
  return body.replace(SENTENCES, (sentence) => {
    if (/\[FACT-\d+\]/.test(sentence) || !CLAIM_VERBS.test(sentence)) return sentence;
    const words = contentWords(sentence);
    let best: { id: string; share: number } | undefined;
    for (const f of facts) {
      const fw = contentWords(f.claim);
      const shared = [...fw].filter((w) => words.has(w)).length;
      const share = fw.size ? shared / fw.size : 0;
      // Numbers in the sentence must all come from the fact.
      const factFigures = new Set(figuresIn(f.claim));
      if (figuresIn(sentence).some((n) => !factFigures.has(n))) continue;
      if (share >= 0.55 && (!best || share > best.share)) best = { id: f.id, share };
    }
    if (!best) return sentence;
    return sentence.replace(/(\s*)([.!?]?)$/, ` [${best.id}]$2$1`);
  });
}

// Verbs and phrasings that signal a factual claim about the sender. "I have three years of admin
// experience" and "I handle travel logistics daily" are claims too, even with no digit in them.
const CLAIM_VERBS =
  /\b(built|designed|developed|scaled|reduced|increased|led|managed|migrated|improved|implemented|architected|shipped|launched|grew|cut|saved|won|proficient|experienced|expert|handle[sd]?|handling|manage|managing|coordinate[sd]?|coordinating|specialize[sd]?|skilled|fluent|certified|familiar with)\b|\bI(?:'ve|’ve| have| had)\b[^.!?]*\b(?:experience|expertise|background|skills?|track record)\b|\bI(?:'ve|’ve| have| had| spent)\s+(?:\w+\s+){0,2}(?:years?|months?)\b|\byears? of\b[^.!?]*\bexperience\b|\bmy (?:\w+ ){0,3}(?:experience|expertise|background) (?:in|with|delivering|building|leading|managing|running)\b/i;

// "…cut AWS spend 22%, demonstrating strong Excel skills [FACT-06]": the add-on claims what the
// fact never said. Cut from the participle to the tag or the end of the sentence.
const EMBELLISH = /,?\s+(?:demonstrating|showing|proving|highlighting|reflecting|showcasing|underscoring|which (?:required|demanded|involved|taught me|shows|showed|demonstrates|demonstrated|proves|highlights|reflects))\b[^.!?\[]*/gi;

/** Removes "…, demonstrating X" style add-ons from sentences, keeping the fact and its tag. */
export function trimEmbellishment(text: string): string {
  return text.replace(EMBELLISH, '').replace(/([^\s(])\s*(\[FACT-\d+\])/g, '$1 $2');
}

const FRAMING = new Set('about which while where their there these those every daily recently currently previously before after through using across within other another years really also still always often worked working project projects company team teams role roles where'.split(' '));
const contentWordsOf = (s: string) =>
  (s.toLowerCase().replace(/\[fact-\d+\]/g, ' ').match(/[a-z][a-z-]{4,}/g) || []).map((w) => w.replace(/(?:ing|ed|es|s)$/, '')).filter((w) => !FRAMING.has(w));

/** A cited sentence that says clearly more than its facts: a new technology, or several new words. */
function saysMoreThan(sentence: string, cited: ResumeFact[]): string | undefined {
  const source = cited.map((f) => f.claim).join(' ');
  const srcTerms = new Set(termsIn(source));
  const newTerms = termsIn(sentence.replace(/\[FACT-\d+\]/g, '')).filter((t) => !srcTerms.has(t));
  if (newTerms.length) return `Names ${newTerms.join(', ')}, which ${cited.map((f) => f.id).join(' / ')} doesn't mention.`;
  const srcWords = new Set(contentWordsOf(source));
  const novel = Array.from(new Set(contentWordsOf(sentence).filter((w) => !srcWords.has(w))));
  if (novel.length >= 4) return `Says more than ${cited.map((f) => f.id).join(' / ')} does (“${novel.slice(0, 4).join('”, “')}”…).`;
  return undefined;
}

/** Sentences, without splitting "1.5", "Node.js" or "e.g." apart. */
export const SENTENCES = /(?:[^.!?\n]|[.!?](?=[0-9A-Za-z]))+[.!?]*/g;

/** Figures in a text, normalised ("1.5 M" → "1.5m"), ignoring fact tags and scheduling ("15-minute chat"). */
export function figuresIn(text: string): string[] {
  const cleaned = text.replace(/\[FACT-\d+\]/g, ' ').replace(/\b\d+\s?[-‑–]?\s?(?:minutes?|mins?|hours?|hrs?|days?|weeks?)\b/gi, ' ');
  return (cleaned.match(/\d+(?:[.,]\d+)*(?:\s?(?:%|x\b|k\b|m\b|mn\b|b\b|bn\b|l\b|cr\b|lakhs?\b|crores?\b|million\b|billion\b))?/gi) || []).map((n) =>
    n.toLowerCase().replace(/\s+/g, '').replace(/,/g, '').replace(/million$/, 'm').replace(/billion$/, 'b')
  );
}

const COMPANY_CLAIM_GENERIC =
  /\b(?:your|the|its) (?:team(?:'s|’s)? |role(?:'s|’s)? )?focus on\b|\b(?:your|the) team(?:'s|’s)?\s+(?:focus|recent|work on|is building|are building|uses|use of|launch)|\brecently (?:launched|released|announced|raised|shipped|acquired)\b|\b(?:you|you've|you have|your company) (?:launched|released|announced|raised|shipped|acquired)\b/i;

/** Client-side grounding check. Re-run on every edit so hand-typed claims are caught too.
 * With `company`, statements about the company also need a source (a hook), or they're flagged. */
// First-person claims ("I have…", "I led…", "my experience…"). "I noticed the team needs…" is not one.
const SENDER_CLAIM = /\bI(?:'ve|’ve|'m|’m| have| had| am| was| built| led| managed| handled| ran| shipped| cut| reduced| grew)\b|\bmy\b/i;

/** A sentence that mostly restates the job posting ("the role focuses on outbound prospecting"). */
function restatesJob(sentence: string, jobText: string): boolean {
  const words = Array.from(new Set(contentWordsOf(sentence)));
  if (words.length < 2) return false;
  const job = new Set(contentWordsOf(jobText));
  return words.filter((w) => job.has(w)).length / words.length >= 0.6;
}

export function checkGrounding(body: string, facts: ResumeFact[], opts: { company?: string; hasHook?: boolean; hookText?: string; jobText?: string } = {}) {
  const companyClaim = opts.company
    ? new RegExp(`${COMPANY_CLAIM_GENERIC.source}|\\b${opts.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s|’s)?\\s+(?:recently |just |new )?(?:launched|released|announced|raised|shipped|acquired|focus|is building|uses)\\b`, 'i')
    : COMPANY_CLAIM_GENERIC;
  const validFactIds = new Set(facts.map((f) => f.id));
  const citedFactIds = new Set<string>();
  const groundedSentences: GroundedSentence[] = [];
  let unverifiedClaimsCount = 0;

  const sourceFigures = new Set(figuresIn(`${facts.map((f) => f.claim).join(' ')} ${opts.hookText || ''}`));
  for (const raw of body.match(SENTENCES) || []) {
    const s = raw.trim();
    if (!s) continue;
    const valid = Array.from(s.matchAll(/\[(FACT-\d+)\]/g))
      .map((m) => m[1])
      .filter((id) => validFactIds.has(id));
    valid.forEach((id) => citedFactIds.add(id));

    // A figure the facts (and the linked hook) never mention is an invented claim, whatever the verb.
    const strayFigure = figuresIn(s).find((n) => !sourceFigures.has(n));
    if (strayFigure) {
      unverifiedClaimsCount++;
      groundedSentences.push({ sentence: s, factIds: valid, isGrounded: false, warning: `Has a figure (${strayFigure}) that isn't in your resume facts.` });
      continue;
    }

    if (opts.company !== undefined && companyClaim.test(s)) {
      // About the company, not the sender: it needs the hook (or the job posting itself) as its source.
      if (opts.hasHook || (opts.jobText && restatesJob(s, opts.jobText))) groundedSentences.push({ sentence: s, factIds: valid, isGrounded: true });
      else {
        unverifiedClaimsCount++;
        groundedSentences.push({ sentence: s, factIds: valid, isGrounded: false, warning: 'Says something about the company with no source. Add a hook from “Find recent news”, or cut it.' });
      }
    } else if (valid.length > 0) {
      const extra = saysMoreThan(s, facts.filter((f) => valid.includes(f.id)));
      if (extra) {
        unverifiedClaimsCount++;
        groundedSentences.push({ sentence: s, factIds: valid, isGrounded: false, warning: extra });
      } else groundedSentences.push({ sentence: s, factIds: valid, isGrounded: true });
    } else if (CLAIM_VERBS.test(s) && !(opts.jobText && restatesJob(s, opts.jobText) && !SENDER_CLAIM.test(s))) {
      unverifiedClaimsCount++;
      groundedSentences.push({ sentence: s, factIds: [], isGrounded: false, warning: 'Claim with no resume fact behind it.' });
    } else {
      groundedSentences.push({ sentence: s, factIds: [], isGrounded: true });
    }
  }
  return { groundedSentences, unverifiedClaimsCount, citedFactIds: Array.from(citedFactIds) };
}

const editDistance = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

/** Models sometimes misspell the company ("work at Palentir"). A typo of their own name can't go out.
 * Only near-misses where a company name belongs ("at X", "join X", "X's") are corrected, so
 * ordinary words like "Nation" next to "Notion" are left alone. */
export function fixCompanyName(text: string, company: string): string {
  const name = company.trim().split(/\s+/)[0];
  if (!name || name.length < 4) return text;
  const limit = name.length >= 8 ? 2 : 1;
  const near = (w: string) => w.toLowerCase() !== name.toLowerCase() && editDistance(w.toLowerCase(), name.toLowerCase()) <= limit;
  return text
    .replace(/\b(at|to|join|joining|with|for|about|from) ([A-Z][\w-]{3,})\b/g, (m, lead, w) => (near(w) ? `${lead} ${name}` : m))
    .replace(/\b([A-Z][\w-]{3,})(['’]s)\b/g, (m, w, s) => (near(w) ? `${name}${s}` : m));
}
