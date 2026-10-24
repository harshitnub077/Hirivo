// Everything Hirivo knows about the people at a company, in one place: the company's own site,
// its YC page, its GitHub org, the user's LinkedIn export and any LinkedIn page the user read.
// Also learns the company's email format and prepares LinkedIn notes for the user to send.
import { db, type LinkedInConnection, type LinkedInTask, type ResumeFact } from '../../db';
import { buildLadder, companyMatches, type LadderContact } from '../contactLadder';
import { getCachedLookup, lookupCompanySite, type SiteLookup } from '../contacts/siteLookup';
import { audienceOf, type Audience } from '../multiOutreach';
import { learnPattern, type EmailEvidence, type LearnedPattern } from './emailPattern';
import { githubEmailEvidence } from './github';
import { linkedInNote } from './linkedinNote';
import { ycFounders, type Founder } from './yc';

export interface PeopleResearch {
  lookup?: SiteLookup;
  founders: Founder[];
  pattern?: LearnedPattern;
  ladder: LadderContact[];
}

export interface ResearchInput {
  company: string;
  jobTitle: string;
  domain?: string;
  college?: string;
  connections: LinkedInConnection[];
  hasMx?: boolean;
  canRead: boolean; // the user allowed reading the company's site
  force?: boolean;
  lookup?: SiteLookup; // already loaded (with pages the user read)
}

/** Real (name, address) pairs at the domain, the evidence for its email format. */
export function emailEvidence(domain: string, lookup: SiteLookup | undefined, connections: LinkedInConnection[], company: string): EmailEvidence[] {
  const at = (e?: string) => !!e && e.toLowerCase().endsWith(`@${domain}`);
  return [
    ...(lookup?.people || []).filter((p) => at(p.email)).map((p) => ({ name: p.name, email: p.email!, source: 'site' as const })),
    ...connections.filter((c) => at(c.email) && companyMatches(c.company, company)).map((c) => ({ name: c.fullName, email: c.email!, source: 'export' as const })),
  ];
}

export async function researchPeople(input: ResearchInput): Promise<PeopleResearch> {
  const { domain } = input;
  const lookup =
    input.lookup ||
    (domain ? (input.canRead ? await lookupCompanySite(domain, input.company, { force: input.force }).catch(() => undefined) : await getCachedLookup(domain)) : undefined);
  const founders = await ycFounders(input.company, domain).catch(() => [] as Founder[]);
  let pattern: LearnedPattern | undefined;
  if (domain && input.hasMx) {
    const evidence = emailEvidence(domain, lookup, input.connections, input.company);
    pattern = learnPattern(evidence, domain, { hasMx: input.hasMx });
    if (!pattern && lookup?.githubOrg) {
      const fromGithub = await githubEmailEvidence(lookup.githubOrg, domain).catch(() => []);
      pattern = learnPattern([...evidence, ...fromGithub], domain, { hasMx: input.hasMx });
    }
  }
  const ladder = buildLadder({ jobTitle: input.jobTitle, company: input.company, domain, college: input.college, connections: input.connections, lookup, domainHasMx: input.hasMx, founders, pattern });
  return { lookup, founders, pattern, ladder };
}

const ORDER: Audience[] = ['connection', 'hiring-manager', 'recruiter', 'founder', 'leader', 'team'];
const onLinkedIn = (c: LadderContact) => !!c.profileUrl && /linkedin\.com\/(?:in|pub)\//.test(c.profileUrl);

/** Up to `max` people with a LinkedIn profile: one of each kind first, then the most relevant. */
export function pickLinkedInPeople(ladder: LadderContact[], max = 5): LadderContact[] {
  const all = ladder.filter(onLinkedIn);
  const picked: LadderContact[] = [];
  for (const a of ORDER) {
    const first = all.find((c) => audienceOf(c) === a && !picked.includes(c));
    if (first && picked.length < max) picked.push(first);
  }
  for (const c of [...all].sort((a, b) => b.relevance - a.relevance)) if (picked.length < max && !picked.includes(c)) picked.push(c);
  return picked;
}

const SIXTY_DAYS = 60 * 86_400_000;

/** Adds LinkedIn notes to Pipeline for these people, skipping anyone noted in the last 60 days. */
export async function addLinkedInTasks(
  people: LadderContact[],
  job: { id: string; company: string; title: string; description?: string },
  facts: ResumeFact[],
  { autopilot = false } = {}
): Promise<LinkedInTask[]> {
  const recent = new Set((await db.linkedinTasks.toArray()).filter((t) => Date.now() - t.createdAt < SIXTY_DAYS).map((t) => t.profileUrl));
  const tasks: LinkedInTask[] = people
    .filter((c) => onLinkedIn(c) && !recent.has(c.profileUrl!))
    .map((c) => {
      const audience = audienceOf(c);
      return {
        id: `${job.id}|${c.profileUrl}`,
        jobId: job.id,
        company: job.company,
        jobTitle: job.title,
        name: c.name,
        role: c.role,
        profileUrl: c.profileUrl!,
        note: linkedInNote({ name: c.name, audience, company: job.company, jobTitle: job.title, facts, jobText: job.description?.slice(0, 2000) }),
        audience,
        status: 'todo',
        createdAt: Date.now(),
        autopilot,
      };
    });
  if (tasks.length) await db.linkedinTasks.bulkPut(tasks);
  return tasks;
}

/** Notes sent this calendar month: LinkedIn's free plan allows only a handful of personal notes. */
export async function notesSentThisMonth(now = new Date()): Promise<number> {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return (await db.linkedinTasks.where('status').equals('sent').toArray()).filter((t) => (t.doneAt || 0) >= start).length;
}
export const FREE_NOTES_PER_MONTH = 5;
