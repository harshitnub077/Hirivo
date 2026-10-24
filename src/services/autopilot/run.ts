// Autopilot: for each job the user hands over, start to finish with no clicks:
//   1. read the posting (ATS API, or the page itself),
//   2. find the company's website and run the Real / Safety / Fit checks,
//   3. research the people there and recent news,
//   4. write and send one email per verified address (through the user's own Gmail),
//   5. open the application, fill every question, and submit when nothing needs the user.
// Runs in the offscreen document (it needs DOMParser). Tabs, Gmail and notifications are done by
// the background worker through `AutopilotHost`, so this file can be tested without Chrome.
// Limits that hold whatever the settings: no LinkedIn automation, verified addresses only, no
// sentence the resume doesn't back, no consent ticked and no CAPTCHA touched for the user.
import { db, type AutopilotJob, type JobSnapshot } from '../../db';
import { getSettings } from '../../db/settings';
import type { ExtractedJobData } from '../../content/extractJob';
import { atsPosting, findCompanyDomain, type PostingDetails } from './details';
import { jobIdOf, logStep, nextQueued, requeueStale, setJob } from './queue';
import { runJobChecks } from '../jobChecks';
import { addLinkedInTasks, pickLinkedInPeople, researchPeople } from '../people';
import { patternProof } from '../people/emailPattern';
import { AUDIENCE_LABEL, pickRecipients, writeDrafts } from '../multiOutreach';
import { findHooks, hookForWriter } from '../hookFinder';
import { dailyCapStatus, recordOutreach, stripCitations } from '../outreach';
import { gmailConnected } from '../gmail';
import { setJobStatus } from '../discover';
import { companyDomainOf } from '../companyDomain';
import { linkedInPosting } from '../discover/sources/linkedin';
import { resolveCompanyPosting } from './resolve';

export interface ApplyReport {
  status: 'submitted' | 'ready' | 'needs-you' | 'failed';
  filled: number;
  written: number;
  left: { label: string; note?: string; required: boolean }[];
  needs?: string;
  tabId?: number;
  error?: string;
}

export interface AutopilotHost {
  /** Reads a job page in a background tab (sites outside the ATS APIs). */
  readPage(url: string): Promise<ExtractedJobData | null>;
  /** Saves a Gmail draft (resume attached if asked) and sends it. */
  sendEmail(m: { to: string; subject: string; body: string; attachResume: boolean }): Promise<{ draftId: string; threadId: string }>;
  /**
   * Opens the application in a background tab, fills it, and submits if `submit` and nothing needs
   * the user. Without `keepTab` the tab is closed when the user has to finish (it refills on reopen).
   */
  apply(url: string, submit: boolean, keepTab?: boolean): Promise<ApplyReport>;
  notify(title: string, message: string, jobId: string): Promise<void>;
  /** Whether the user let Hirivo read any website (company sites, careers pages). */
  canReadAnySite(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

const FORM_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|recruitee\.com|bamboohr\.com|keka\.com|darwinbox\.in|zohorecruit\.(com|in)|freshteam\.com)$/;
// Addresses Autopilot may email: listed publicly, in the user's own export, or in the company's
// email format proven by real addresses at that domain. Plain guesses never.
const VERIFIED = new Set(['listed', 'from-export', 'pattern-confirmed']);
const words = (s: string) => stripCitations(s).split(/\s+/).filter(Boolean).length;
// Job portals: read (LinkedIn logged-out only), never applied on. The company's own board is used
// when the same job is there.
const PORTALS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)naukri\.com$/, 'Naukri'],
  [/(^|\.)indeed\.com$/, 'Indeed'],
  [/(^|\.)internshala\.com$/, 'Internshala'],
  [/(^|\.)unstop\.com$/, 'Unstop'],
  [/(^|\.)(foundit\.in|wellfound\.com|instahyre\.com|cutshort\.io)$/, 'the job site'],
];
export const portalOf = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return PORTALS.find(([re]) => re.test(h))?.[1];
  } catch {
    return undefined;
  }
};
/** A person doesn't send applications seconds apart: 1-3 minutes between jobs. */
export const PACE_MS = { min: 60_000, spread: 120_000 };

let running = false;

/** Works through the queue one job at a time. Safe to call repeatedly; only one run at a time. */
export async function runQueue(host: AutopilotHost): Promise<void> {
  if (running) return;
  running = true;
  try {
    await requeueStale();
    for (let job = await nextQueued(); job; job = await nextQueued()) {
      const settings = await getSettings();
      if (!settings.autopilot?.enabled) break;
      try {
        await processJob(job, host);
      } catch (err: any) {
        await logStep(job.id, `Stopped: ${err?.message || err}`, 'risk', { status: 'failed', stage: undefined });
      }
      if (await nextQueued()) await host.sleep(PACE_MS.min + Math.random() * PACE_MS.spread);
    }
  } finally {
    running = false;
  }
}

async function readPosting(item: AutopilotJob, host: AutopilotHost, canRead: boolean): Promise<{ details: PostingDetails; hints: string[] } | null> {
  const fromApi = await atsPosting(item.url).catch(() => null);
  if (fromApi) return { details: { ...fromApi, company: fromApi.company || item.company }, hints: [] };
  if (portalOf(item.url) === 'LinkedIn') {
    // Logged-out only: never a LinkedIn tab with the user's session.
    const li = await linkedInPosting(item.url);
    return li ? { details: { ...li, applyUrl: item.url }, hints: [] } : null;
  }
  if (!canRead && !FORM_HOSTS.test(new URL(item.url).hostname) && !portalOf(item.url)) return null;
  const page = await host.readPage(item.url);
  if (!page || page.description.length < 120) return null;
  return {
    details: { title: page.title || item.title, company: page.company || item.company, location: page.location, description: page.description, applyUrl: page.atsUrl || item.url, postedAt: page.postedDate },
    hints: [page.companyDomain || ''].filter(Boolean),
  };
}

export async function processJob(item: AutopilotJob, host: AutopilotHost): Promise<void> {
  const id = item.id;
  const stage = (text: string) => setJob(id, { status: 'working', stage: text });
  const settings = await getSettings();
  const ap = settings.autopilot!;

  // Portals are never applied on. Use the company's own posting when the same job is there.
  const portal = portalOf(item.url);
  if (portal) {
    const known = (await db.jobs.get(id))?.atsUrl;
    let target = known && FORM_HOSTS.test(new URL(known).hostname) ? known : undefined;
    if (!target) {
      await stage(`Looking for this job on ${item.company}’s own board`);
      const found = await resolveCompanyPosting(item.company, item.title).catch(() => null);
      if (found) {
        target = found.url;
        await logStep(id, `Found it on ${item.company}’s own ${found.ats[0].toUpperCase()}${found.ats.slice(1)} board, so Hirivo can apply there.`, 'ok');
      }
    }
    if (target) {
      item = { ...item, url: target };
      await setJob(id, { url: target });
    }
  }

  await stage('Reading the job');
  const canRead = await host.canReadAnySite();
  const posting = await readPosting(item, host, canRead);
  if (!posting) {
    await logStep(id, canRead ? 'Couldn’t read this job page.' : 'Couldn’t read this job. Allow Hirivo to read websites in You → Autopilot.', 'risk', { status: 'failed', stage: undefined });
    return;
  }
  const { details } = posting;
  await logStep(id, `Read “${details.title}” at ${details.company}.`, 'ok', { title: details.title, company: details.company });

  // ---- company and checks ----
  await stage('Checking the company');
  const facts = await db.facts.toArray();
  const [resume, connections] = await Promise.all([db.resumes.get('primary'), db.connections.toArray()]);
  const previous = await db.jobs.get(id);
  const domain = canRead
    ? await findCompanyDomain(details.company, [previous?.companyDomain, ...posting.hints, details.applyUrl]).catch(() => undefined)
    : companyDomainOf(previous?.companyDomain) || posting.hints.map((h) => companyDomainOf(h)).find(Boolean);
  const job: JobSnapshot = {
    ...previous,
    id,
    url: item.url,
    title: details.title,
    company: details.company,
    companyDomain: domain,
    location: details.location,
    description: details.description,
    postedDate: details.postedAt?.slice(0, 10),
    atsUrl: FORM_HOSTS.test(new URL(details.applyUrl).hostname) ? details.applyUrl : previous?.atsUrl,
    analyzedAt: previous?.analyzedAt ?? 0,
  };
  const { job: checked, fitError } = await runJobChecks(job, { resume, facts, settings });
  await db.jobs.put(checked);
  await setJob(id, { companyDomain: domain });
  await logStep(
    id,
    [
      domain ? `Company site: ${domain}.` : 'Company website not found.',
      checked.fitScore !== undefined ? `Fit ${checked.fitScore}%.` : fitError ? `Fit check failed (${fitError}).` : '',
      checked.scamLevel === 'clear' ? 'No scam signs.' : checked.scamLevel === 'caution' ? 'Scam Shield: check the listing.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    checked.scamLevel === 'risk' ? 'risk' : 'ok'
  );
  if (!item.force && checked.scamLevel === 'risk') {
    const why = checked.scamFindings?.find((f) => f.tone === 'risk')?.text || 'Scam Shield flagged this listing.';
    await logStep(id, `Skipped to protect you: ${why}`, 'risk', { status: 'skipped', stage: undefined });
    await host.notify(`Skipped ${details.company}`, why, id);
    return;
  }
  if (!item.force && (checked.ghostScore ?? 0) >= 60 && checked.atsType !== 'unknown') {
    await logStep(id, `Skipped: ${checked.ghostReasons?.[0] || 'the role looks closed on the company’s own board.'}`, 'caution', { status: 'skipped', stage: undefined });
    return;
  }

  // ---- people, emails and LinkedIn notes ----
  const emailed: string[] = [...item.emailed];
  const wantNotes = ap.linkedinNotes !== false;
  if (ap.sendEmails || wantNotes) {
    await stage('Researching people');
    const { lookup, ladder, founders, pattern } = await researchPeople({
      company: details.company,
      jobTitle: details.title,
      domain,
      college: settings.userCollege,
      connections,
      hasMx: checked.legitDetails?.hasMx,
      canRead,
    });
    const people = ladder.filter((c) => c.tier <= 3);
    await logStep(
      id,
      [
        people.length ? `Found ${people.length} ${people.length === 1 ? 'person' : 'people'}${founders.length ? ` (${founders.length} from ${details.company}'s YC page)` : ''}.` : 'No people found on the company’s site.',
        pattern ? `Email format: ${patternProof(pattern)}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      'neutral'
    );
    const gmail = ap.sendEmails && (await gmailConnected());
    if (ap.sendEmails && !gmail) {
      await logStep(id, 'Emails skipped: connect Gmail in You → Gmail so Autopilot can send them.', 'caution');
    } else if (ap.sendEmails) {
      const sentBefore = new Set((await db.outreach.toArray()).filter((o) => Date.now() - o.createdAt < 60 * 86_400_000).map((o) => o.recipientEmail.toLowerCase()));
      const recipients = pickRecipients(
        ladder.filter((c) => c.emailStatus && VERIFIED.has(c.emailStatus) && !sentBefore.has((c.email || '').toLowerCase())),
        Math.max(1, Math.min(5, ap.peoplePerCompany || 3))
      );
      if (!recipients.length) {
        await logStep(id, `No verified email addresses ${domain ? `on ${domain}` : 'found'}; guessed addresses are never emailed automatically.`, 'neutral');
      } else {
        await logStep(id, `Writing to ${recipients.map((r) => `${r.name || 'the hiring inbox'} (${AUDIENCE_LABEL[r.audience]})`).join(', ')}.`, 'neutral');
        const hooks = await findHooks({ company: details.company, domain, githubOrg: lookup?.githubOrg, feedUrl: lookup?.feedUrl, siteAllowed: canRead, context: details.description.slice(0, 2500) }).catch(() => []);
        const drafts = await writeDrafts({ job: checked, recipients, facts, voiceProfile: await db.voiceProfiles.get('default'), settings, hook: hooks[0] ? hookForWriter(hooks[0]) : undefined });
        for (const [i, d] of drafts.entries()) {
          if (d.unverified > 0 || words(d.body) < 35) {
            await logStep(id, `Didn’t send to ${d.recipient.email}: the email couldn’t be written from your resume alone.`, 'caution');
            continue;
          }
          const { used, cap } = await dailyCapStatus();
          if (used >= cap) {
            await logStep(id, `Today’s email limit (${cap}) is reached; raise it in You → Profile. The rest were not sent.`, 'caution');
            break;
          }
          if (i > 0) await host.sleep(30_000 + Math.random() * 60_000); // a person doesn't send five emails in one second
          await stage(`Emailing ${d.recipient.name || d.recipient.email}`);
          const sent = await host.sendEmail({ to: d.recipient.email, subject: d.subject, body: stripCitations(d.body), attachResume: true });
          const record = await recordOutreach({
            jobId: id,
            companyName: details.company,
            jobTitle: details.title,
            recipientName: d.recipient.name || 'Hiring team',
            recipientEmail: d.recipient.email,
            contactType: d.recipient.contactType,
            channel: 'email',
            subject: d.subject,
            body: stripCitations(d.body),
            factsCited: d.factsCited,
            gmailDraftId: sent.draftId,
            gmailThreadId: sent.threadId,
          });
          await db.outreach.update(record.id, { autopilot: true });
          emailed.push(d.recipient.email);
          await logStep(id, `Sent to ${d.recipient.name || 'the hiring team'} <${d.recipient.email}>.`, 'ok', { emailed: [...emailed] });
        }
      }
    }
    if (wantNotes) {
      const tasks = await addLinkedInTasks(pickLinkedInPeople(ladder), { id, company: details.company, title: details.title, description: details.description }, facts, { autopilot: true });
      if (tasks.length) await logStep(id, `Prepared ${tasks.length} LinkedIn ${tasks.length === 1 ? 'note' : 'notes'} in Pipeline (${tasks.map((t) => t.name).join(', ')}). Open each and press Send.`, 'neutral');
    }
  }

  // ---- the application ----
  const applyUrl = details.applyUrl;
  if (!FORM_HOSTS.test(new URL(applyUrl).hostname)) {
    const where = portalOf(applyUrl);
    const needs = where ? `Apply on ${where}` : 'Apply on the company site';
    await logStep(id, where ? `${needs} yourself (Hirivo doesn’t apply on job portals): ${applyUrl}` : `Apply on their site: ${applyUrl}`, 'caution', { status: 'needs-you', needs, stage: undefined });
    // Automatic hand-overs are summed up after each search instead of one notification per job.
    if (!item.auto) await host.notify(`${details.company}: ${needs.toLowerCase()}`, emailed.length ? `Emailed ${emailed.length} ${emailed.length === 1 ? 'person' : 'people'}. The application isn't on a form Hirivo can fill.` : `The application isn't on a form Hirivo can fill.`, id);
    return;
  }
  await stage('Filling the application');
  // Automatic runs close the tab when it needs the user, so tabs don't pile up; it refills on reopen.
  const report = await host.apply(applyUrl, ap.submitForms, !item.auto);
  const summary = `Filled ${report.filled} answers${report.written ? `, wrote ${report.written} from your resume` : ''}.`;
  if (report.status === 'submitted') {
    await logStep(id, `${summary} Submitted.`, 'ok', { status: 'done', applied: true, stage: undefined, needs: undefined });
    await markApplied(item.url, applyUrl);
    await host.notify(`Applied to ${details.company}`, `${details.title}. ${summary}${emailed.length ? ` Emailed ${emailed.length}.` : ''}`, id);
  } else if (report.status === 'failed') {
    await logStep(id, `Couldn’t fill the form: ${report.error || 'unknown error'}.`, 'risk', { status: 'failed', stage: undefined, tabId: report.tabId });
  } else {
    const needs = report.status === 'ready' ? 'Press Submit' : report.needs || 'Finish the form';
    await logStep(id, `${summary} ${needs}${report.left.filter((l) => l.required).length ? `: ${report.left.filter((l) => l.required).map((l) => l.label).slice(0, 3).join('; ')}` : ''}.`, 'caution', {
      status: 'needs-you',
      needs,
      stage: undefined,
      tabId: report.tabId,
    });
    await host.notify(`${details.company}: one step left`, `${needs}. The form is open in a tab and everything else is filled.`, id);
  }
}

async function markApplied(...urls: string[]) {
  const keys = new Set(urls.map(jobIdOf));
  for (const d of await db.discovered.toArray()) if (keys.has(jobIdOf(d.url)) && d.status !== 'applied') await setJobStatus(d.id, 'applied');
}
