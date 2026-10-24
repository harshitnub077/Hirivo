// "Apply automatically to new matches": after each saved search, the best new jobs go to Autopilot
// by themselves, within the user's limits. Nothing is handed over unless the user turned this on.
import { db, type AutopilotJob, type DiscoveredJob, type UserSettings } from '../../db';
import { enqueue, jobIdOf } from './queue';

export const AUTO_DEFAULTS = { minScore: 60, perCompanyPerWeek: 2 };
const WEEK = 7 * 86_400_000;
const startOfDay = (now: number) => new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();

/**
 * Which new matches to hand over: real jobs (not "company is hiring" rows) at or above the minimum
 * score, best first, never one already handed over or applied to, at most two roles per company a
 * week, and within the daily limit when the user set one (no limit otherwise).
 */
export function pickAutoMatches(rows: DiscoveredJob[], queue: AutopilotJob[], settings: Pick<UserSettings, 'autopilot'>, now = Date.now()): DiscoveredJob[] {
  const ap = settings.autopilot;
  if (!ap?.enabled || !ap.autoApply) return [];
  const minScore = ap.minScore ?? AUTO_DEFAULTS.minScore;
  const queued = new Set(queue.map((q) => q.id));
  const today = queue.filter((q) => q.auto && q.createdAt >= startOfDay(now)).length;
  const room = ap.dailyLimit ? Math.max(0, ap.dailyLimit - today) : Infinity;
  const perCompany = new Map<string, number>();
  for (const q of queue) if (now - q.createdAt < WEEK) perCompany.set(q.company.toLowerCase(), (perCompany.get(q.company.toLowerCase()) || 0) + 1);

  const picked: DiscoveredJob[] = [];
  for (const j of [...rows].sort((a, b) => b.score - a.score)) {
    if (picked.length >= room) break;
    if ((j.kind || 'job') !== 'job' || j.status !== 'new' || j.score < minScore || queued.has(jobIdOf(j.url))) continue;
    const c = j.company.toLowerCase();
    if ((perCompany.get(c) || 0) >= AUTO_DEFAULTS.perCompanyPerWeek) continue;
    perCompany.set(c, (perCompany.get(c) || 0) + 1);
    picked.push(j);
  }
  return picked;
}

/** Hands new matches to Autopilot; `since` limits it to jobs first seen in this search. */
export async function autoEnqueueNewMatches(settings: Pick<UserSettings, 'autopilot'>, { since = 0, now = Date.now() } = {}): Promise<DiscoveredJob[]> {
  const rows = (await db.discovered.where('status').equals('new').toArray()).filter((j) => j.firstSeenAt >= since);
  const picked = pickAutoMatches(rows, await db.autopilot.toArray(), settings, now);
  if (picked.length) await enqueue(picked.map((j) => ({ url: j.url, title: j.title, company: j.company })), { auto: true });
  return picked;
}
