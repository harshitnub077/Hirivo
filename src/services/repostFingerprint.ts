// Repost fingerprint: remembers a hash of every job description the user analyzes, locally.
// The same description coming back on the same site under a new job id, or the same job
// reappearing with a newer posting date, is a sign of an evergreen or recycled listing.
// No network: hashing uses Web Crypto and storage is IndexedDB.
import { db, JobFingerprint } from '../db';
import type { ScamFinding } from './scamShield';

const DAY = 86_400_000;
const MIN_LENGTH = 200; // shorter texts are too generic to fingerprint

/** Strips what changes between reposts (dates, numbers, links, spacing, punctuation). */
export function normalizeDescription(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, ' ')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, ' ')
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/g, ' ')
    .replace(/\b(?:posted|reposted|ago|today|yesterday|days?|weeks?|months?|hours?|minutes?)\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-zऀ-ॿ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

export async function fingerprint(text: string): Promise<string | null> {
  const normalized = normalizeDescription(text);
  if (normalized.length < MIN_LENGTH) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Turns "3 weeks ago", "30+ days ago", "yesterday" or "2026-10-01" into a timestamp. */
export function parsePostedDate(raw: string | undefined, now = Date.now()): number | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase().trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const t = Date.parse(text);
    return Number.isNaN(t) ? undefined : t;
  }
  if (/just now|today|few (?:hours|minutes)/.test(text)) return now;
  if (/yesterday/.test(text)) return now - DAY;
  const m = text.match(/(\d+|an?)\+?\s*(minute|hour|day|week|month|year)s?/);
  if (!m) return undefined;
  const n = m[1].startsWith('a') ? 1 : Number(m[1]);
  const unit = { minute: 60_000, hour: 3_600_000, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY }[m[2] as 'day'];
  return now - n * unit;
}

/** The site part of a job id: "linkedin:123" → "linkedin", "jobs.lever.co/cred/abc" → "jobs.lever.co". */
export function sourceOf(jobId: string): string {
  return jobId.includes(':') && !jobId.includes('/') ? jobId.split(':')[0] : jobId.split('/')[0];
}

export interface RepostResult {
  postings: number; // distinct postings of this description on this site, including this one
  firstSeen: number;
  finding?: ScamFinding;
}

const shortDate = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Records this sighting and reports whether the description has been posted before. */
export async function recordFingerprint(
  job: { id: string; company: string; description: string; postedDate?: string },
  now = Date.now()
): Promise<RepostResult | null> {
  const hash = await fingerprint(job.description);
  if (!hash) return null;
  const source = sourceOf(job.id);
  const postedAt = parsePostedDate(job.postedDate, now);

  return db.transaction('rw', db.fingerprints, async () => {
    const rec: JobFingerprint = (await db.fingerprints.get(hash)) || { hash, firstSeen: now, lastSeen: now, reposts: 0, sightings: [] };
    const mine = rec.sightings.find((s) => s.jobId === job.id);
    let reposted = false;
    if (mine) {
      reposted = postedAt !== undefined && mine.postedAt !== undefined && postedAt - mine.postedAt > 3 * DAY;
      if (reposted) rec.reposts++;
      mine.postedAt = postedAt ?? mine.postedAt;
      mine.seenAt = now;
    } else {
      rec.sightings.push({ jobId: job.id, source, company: job.company, postedAt, seenAt: now });
    }
    rec.lastSeen = now;
    const earliestPost = Math.min(rec.firstSeen, ...rec.sightings.map((s) => s.postedAt ?? Infinity));
    rec.firstSeen = earliestPost;
    await db.fingerprints.put(rec);

    const sameSite = rec.sightings.filter((s) => s.source === source);
    const postings = sameSite.length + rec.reposts;
    if (postings < 2) return { postings, firstSeen: rec.firstSeen };
    return {
      postings,
      firstSeen: rec.firstSeen,
      finding: {
        tone: 'caution',
        text: `Same description seen ${postings} times since ${shortDate(rec.firstSeen)}${reposted ? ', and this listing was just re-dated' : ''}. Recycled listings are often evergreen or already filled.`,
      },
    };
  });
}
