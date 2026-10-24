// Sending without OAuth: Hirivo opens a prefilled Gmail compose window and the user presses Send.
// No Gmail scopes means no Google verification, no token handling, and nothing sent behind the
// user's back. Follow-ups are tracked locally and surfaced as notifications.
import { db, OutreachRecord } from '../db';
import { getSettings, patchSettings, todayKey } from '../db/settings';

const DAY = 86_400_000;
export const FOLLOWUP_DAYS = [4, 9] as const;

export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function mailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function openUrl(url: string) {
  if (typeof chrome !== 'undefined' && chrome.tabs) await chrome.tabs.create({ url });
  else window.open(url, '_blank');
}

/** Strips [FACT-xx] citations so the recipient never sees them. */
export function stripCitations(text: string): string {
  return text.replace(/\s*\[FACT-\d+\]/g, '').replace(/[ \t]+\n/g, '\n');
}

export interface NewOutreach {
  jobId: string;
  companyName: string;
  jobTitle: string;
  recipientName: string;
  recipientEmail: string;
  contactType: OutreachRecord['contactType'];
  channel: 'email' | 'linkedin';
  subject: string;
  body: string;
  linkedInNote?: string;
  factsCited: string[];
  gmailDraftId?: string;
  gmailThreadId?: string;
}

export async function dailyCapStatus() {
  const s = await getSettings();
  const used = s.lastSendDate === todayKey() ? s.todaySendCount : 0;
  return { used, cap: s.dailySendCap || 15 };
}

/** Records the outreach and counts it against the daily cap. Throws when the cap is reached. */
export async function recordOutreach(input: NewOutreach): Promise<OutreachRecord> {
  const { used, cap } = await dailyCapStatus();
  if (used >= cap) {
    throw new Error(`You've reached today's limit of ${cap} messages. Fewer, better messages get more replies; pick this up tomorrow.`);
  }
  const now = Date.now();
  const record: OutreachRecord = {
    id: crypto.randomUUID(),
    jobId: input.jobId,
    companyName: input.companyName,
    jobTitle: input.jobTitle,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail,
    contactType: input.contactType,
    channel: input.channel,
    emailSubject: input.subject,
    emailBody: input.body,
    linkedInNote: input.linkedInNote || '',
    factsCited: input.factsCited,
    status: 'SENT',
    createdAt: now,
    followup1Date: now + FOLLOWUP_DAYS[0] * DAY,
    followup2Date: now + FOLLOWUP_DAYS[1] * DAY,
    followupsDone: 0,
    notifiedStage: 0,
    ...(input.gmailThreadId ? { gmailDraftId: input.gmailDraftId, gmailThreadId: input.gmailThreadId } : {}),
  };
  await db.outreach.put(record);
  await patchSettings({ todaySendCount: used + 1, lastSendDate: todayKey() });
  return record;
}

/** 0 = nothing due, 1 = first follow-up due, 2 = final follow-up due. */
export function dueFollowupStage(r: OutreachRecord, now = Date.now()): 0 | 1 | 2 {
  if (r.status === 'REPLIED' || r.status === 'CLOSED') return 0;
  const done = r.followupsDone ?? 0;
  if (done < 1 && now >= r.followup1Date) return 1;
  if (done < 2 && now >= r.followup2Date) return 2;
  return 0;
}

export function followupText(r: OutreachRecord, stage: 1 | 2, senderName: string) {
  const first = r.recipientName.split(' ')[0] || 'there';
  const sign = senderName || '';
  const body =
    stage === 1
      ? `Hi ${first},\n\nBumping my note below about the ${r.jobTitle} role in case it got buried. Happy to send anything that would help.\n\nThanks,\n${sign}`
      : `Hi ${first},\n\nI'll close the loop here. If the ${r.jobTitle} role isn't a fit right now, no worries at all. If it is, I'd value 15 minutes whenever suits you.\n\nThanks for reading,\n${sign}`;
  return { subject: `Re: ${r.emailSubject}`, body: `${body}\n\n---\n${stripCitations(r.emailBody)}` };
}

export async function markFollowupSent(r: OutreachRecord, stage: 1 | 2) {
  await db.outreach.update(r.id, { followupsDone: stage, notifiedStage: stage });
}

export async function setOutreachStatus(r: OutreachRecord, status: 'REPLIED' | 'CLOSED' | 'SENT') {
  await db.outreach.update(r.id, { status, repliedAt: status === 'REPLIED' ? Date.now() : r.repliedAt });
}
