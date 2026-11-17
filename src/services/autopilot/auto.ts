// "Apply automatically to new matches": after each saved search, the best new jobs go to Autopilot
// by themselves, within the user's limits. Nothing is handed over unless the user turned this on.
import { db, type AutopilotJob, type DiscoveredJob, type UserSettings } from '../../db';
import { enqueue, jobIdOf } from './queue';
import { isExcluded } from '../targetFilter';

/**
 * Volume limits that keep automatic applying from looking like spam to recruiters and job boards:
 * 10 a day unless the user picks another number, and never more than 25 however it's set.
 */
export const AUTO_DEFAULTS = { minScore: 60, perCompanyPerWeek: 2, dailyLimit: 10, maxDailyLimit: 25, minFit: 50 };

/** The day's limit after the default and the ceiling. */
export function effectiveDailyLimit(dailyLimit: number | undefined): number {
  return Math.min(dailyLimit && dailyLimit > 0 ? dailyLimit : AUTO_DEFAULTS.dailyLimit, AUTO_DEFAULTS.maxDailyLimit);
}

/** Why an automatically handed-over job should stop at the Fit check, or undefined to go on. */
export function lowFitReason(item: { auto?: boolean; force?: boolean }, fitScore: number | undefined, minFit = AUTO_DEFAULTS.minFit): string | undefined {
  if (!item.auto || item.force || fitScore === undefined || fitScore >= minFit) return undefined;
  return `fit ${fitScore}% is below your minimum of ${minFit}% for automatic applications.`;
}
const WEEK = 7 * 86_400_000;
const startOfDay = (now: number) => new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();

/**
 * Which new matches to hand over: real jobs (not "company is hiring" rows) at or above the minimum
 * score, best first, never one already handed over or applied to, at most two roles per company a
 * week, never an excluded company or title word, and within the daily limit (10 unless set, 25 at most).
 */
export function pickAutoMatches(
  rows: DiscoveredJob[],
  queue: AutopilotJob[],
  settings: Pick<UserSettings, 'autopilot' | 'excludeCompanies' | 'excludeTitleWords'>,
  now = Date.now()
): DiscoveredJob[] {
  const ap = settings.autopilot;
  if (!ap?.enabled || !ap.autoApply) return [];
  const minScore = ap.minScore ?? AUTO_DEFAULTS.minScore;
  const queued = new Set(queue.map((q) => q.id));
  const today = queue.filter((q) => q.auto && q.createdAt >= startOfDay(now)).length;
  const room = Math.max(0, effectiveDailyLimit(ap.dailyLimit) - today);
  const perCompany = new Map<string, number>();
  for (const q of queue) if (now - q.createdAt < WEEK) perCompany.set(q.company.toLowerCase(), (perCompany.get(q.company.toLowerCase()) || 0) + 1);

  const picked: DiscoveredJob[] = [];
  for (const j of [...rows].sort((a, b) => b.score - a.score)) {
    if (picked.length >= room) break;
    if ((j.kind || 'job') !== 'job' || j.status !== 'new' || j.score < minScore || queued.has(jobIdOf(j.url))) continue;
    if (isExcluded(j, settings)) continue;
    const c = j.company.toLowerCase();
    if ((perCompany.get(c) || 0) >= AUTO_DEFAULTS.perCompanyPerWeek) continue;
    perCompany.set(c, (perCompany.get(c) || 0) + 1);
    picked.push(j);
  }
  return picked;
}

/** Hands new matches to Autopilot; `since` limits it to jobs first seen in this search. */
export async function autoEnqueueNewMatches(settings: Pick<UserSettings, 'autopilot' | 'excludeCompanies' | 'excludeTitleWords'>, { since = 0, now = Date.now() } = {}): Promise<DiscoveredJob[]> {
  const rows = (await db.discovered.where('status').equals('new').toArray()).filter((j) => j.firstSeenAt >= since);
  const picked = pickAutoMatches(rows, await db.autopilot.toArray(), settings, now);
  if (picked.length) await enqueue(picked.map((j) => ({ url: j.url, title: j.title, company: j.company })), { auto: true });
  return picked;
}
