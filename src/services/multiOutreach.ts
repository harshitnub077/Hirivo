// Writing to several people at one company: a founder, the likely hiring manager, a recruiter,
// the hiring inbox, someone you know. Each person gets their own email, written for what they do
// and backed by the user's resume facts. The user reviews every draft and presses Send in Gmail.
import type { LadderContact } from './contactLadder';
import { db, type JobSnapshot, type ResumeFact, type UserSettings, type VoiceProfile } from '../db';
import type { MailAttachment } from './gmail';
import { checkGrounding, generateProofLinkedDraft, removeUnsupported } from './proofWriter';
import { FREE_EMAIL_DOMAINS } from './scamShield';

export const MAX_RECIPIENTS = 5;

export type Audience = 'connection' | 'hiring-manager' | 'recruiter' | 'founder' | 'leader' | 'team' | 'inbox';

export const AUDIENCE_LABEL: Record<Audience, string> = {
  connection: 'Someone you know',
  'hiring-manager': 'Likely hiring manager',
  recruiter: 'Recruiter / HR',
  founder: 'Founder',
  leader: 'Leadership',
  team: 'On the team',
  inbox: 'Hiring inbox',
};

/** What to say to each kind of person; goes into the writer's prompt. */
const ANGLE: Record<Audience, string> = {
  connection: 'They know the sender. Warm and short: say you are applying for this role and ask if they would refer you or tell you who the hiring manager is.',
  'hiring-manager': 'They likely run the team that is hiring. Lead with the two results closest to the work, then ask for a 15-minute chat about the role.',
  recruiter: 'They screen candidates for this role. Name the exact role, say you are applying, give the two most relevant results, and ask about the next step or who to send the resume to.',
  founder: 'They run the company and get many emails. Three or four sentences: the role, the single strongest result, and one easy ask (15 minutes, or who to talk to).',
  leader: 'A senior leader, not necessarily hiring. Brief: the role, one strong result, and ask who the right person to talk to is.',
  team: 'They work on the team. Ask for a short chat about what the work is like and whether they would pass the application along; no hard sell.',
  inbox: "A shared hiring inbox. Name the exact role in the subject and first line, say you are applying, give the two most relevant results, and mention the resume.",
};

export interface Recipient {
  id: string;
  name: string;
  role?: string;
  email: string;
  emailStatus?: 'listed' | 'from-export' | 'guessed' | 'typed';
  audience: Audience;
  contactType: 'WARM_CONNECTION' | 'ALUMNI' | 'COLD_HIRING_MGR';
}

export function audienceOf(c: Pick<LadderContact, 'tier' | 'role'>): Audience {
  if (c.tier === 1) return 'connection';
  if (c.tier === 5) return 'inbox';
  const r = (c.role || '').toLowerCase();
  if (/recruit|talent|people (?:ops|partner|team)|\bhr\b|human resources|hiring/.test(r)) return 'recruiter';
  if (/founder|\bceo\b/.test(r)) return 'founder';
  if (/\b(head of|vp|vice president|director|manager|lead|cto|cpo|chief)\b/.test(r)) return /\b(cto|cpo|chief|vp|vice president|director)\b/.test(r) ? 'leader' : 'hiring-manager';
  return 'team';
}

const ORDER: Audience[] = ['connection', 'hiring-manager', 'recruiter', 'founder', 'inbox', 'leader', 'team'];

export function toRecipient(c: LadderContact): Recipient | null {
  if (!c.email) return null;
  const audience = audienceOf(c);
  // The ladder ranks "Likely hiring manager" from the job family; trust it over the title regex.
  const hm = /likely hiring manager/i.test(c.why) ? 'hiring-manager' : audience;
  return { id: c.id, name: c.tier === 5 ? '' : c.name, role: c.tier === 5 ? undefined : c.role, email: c.email, emailStatus: c.emailStatus, audience: hm, contactType: c.contactType };
}

/** Up to five people with an email, one of each kind first, then the most relevant of the rest. */
export function pickRecipients(ladder: LadderContact[], max = MAX_RECIPIENTS): Recipient[] {
  const all = ladder.map(toRecipient).filter((r): r is Recipient => r !== null);
  const seen = new Set<string>();
  const picked: Recipient[] = [];
  const take = (r: Recipient) => {
    const key = r.email.toLowerCase();
    if (seen.has(key) || picked.length >= max) return;
    seen.add(key);
    picked.push(r);
  };
  for (const a of ORDER) {
    const first = all.find((r) => r.audience === a && !seen.has(r.email.toLowerCase()));
    if (first) take(first);
  }
  for (const r of all) take(r);
  // Listed and exported addresses before guesses; the order the user sees is the order of priority.
  return picked.sort((a, b) => ORDER.indexOf(a.audience) - ORDER.indexOf(b.audience));
}

/** A typed-in person: business addresses only, and a plausible email. */
export function manualRecipient(name: string, role: string, email: string): Recipient {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('That email address doesn’t look right.');
  if (FREE_EMAIL_DOMAINS.includes(clean.split('@')[1])) throw new Error('Use their work email. Hirivo only writes to business addresses.');
  const r = { tier: 3 as const, role };
  return { id: `typed:${clean}`, name: name.trim(), role: role.trim() || undefined, email: clean, emailStatus: 'typed', audience: audienceOf(r), contactType: 'COLD_HIRING_MGR' };
}

export interface PersonDraft {
  recipient: Recipient;
  subject: string;
  body: string;
  unverified: number;
  factsCited: string[];
  /** Sentences Hirivo cut because the resume doesn't back them (shown to the user). */
  removed: string[];
}

/** Writes one email per person, one at a time (free AI tiers rate-limit bursts). */
export async function writeDrafts(
  input: { job: JobSnapshot; recipients: Recipient[]; facts: ResumeFact[]; voiceProfile?: VoiceProfile; settings: UserSettings; hook?: string },
  onProgress?: (done: number, total: number) => void
): Promise<PersonDraft[]> {
  const out: PersonDraft[] = [];
  const requirements = [...(input.job.fitEvidence || [])].sort((a, b) => Number(b.met) - Number(a.met)).map((r) => r.text);
  for (const [i, r] of input.recipients.entries()) {
    onProgress?.(i, input.recipients.length);
    const d = await generateProofLinkedDraft({
      jobTitle: input.job.title,
      companyName: input.job.company,
      recipientName: r.name || undefined,
      recipientRole: r.role || (r.audience === 'inbox' ? 'the hiring team inbox' : undefined),
      angle: ANGLE[r.audience],
      facts: input.facts,
      voiceProfile: input.voiceProfile,
      realSignalHook: input.hook,
      requirements,
      senderName: input.settings.userFullName,
      jobText: input.job.description,
    });
    // Several emails at once means less line-by-line attention, so unsupported sentences are cut
    // here (after the writer's own repair round) instead of waiting for the user to remove them.
    let body = d.emailBody;
    const removed = d.groundedSentences.filter((g) => !g.isGrounded).map((g) => g.sentence);
    const opts = { company: input.job.company, hasHook: Boolean(input.hook), hookText: input.hook, jobText: input.job.description };
    if (removed.length) body = removeUnsupported(body, input.facts, opts);
    const g = checkGrounding(body, input.facts, opts);
    out.push({ recipient: r, subject: d.emailSubject, body, unverified: g.unverifiedClaimsCount, factsCited: g.citedFactIds, removed });
  }
  onProgress?.(input.recipients.length, input.recipients.length);
  return out;
}

/** The uploaded resume as a mail attachment, or undefined when only text was pasted. */
export async function resumeAttachment(): Promise<MailAttachment | undefined> {
  const file = await db.resumeFiles.get('primary');
  if (!file) return undefined;
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: file.name, type: file.type || 'application/pdf', base64: btoa(binary) };
}
