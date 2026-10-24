// Daily 5: each morning, the five best open roles from Discover (which includes the watchlist)
// and the jobs the user has analyzed. Ranked by fit, freshness and a warm path. A role whose
// Real verdict is Doubtful, or whose Safety verdict is Risky, is never picked.
import { db, DailyPick, DailyPicks, DiscoveredJob, JobSnapshot } from '../db';
import { companyMatches } from './contactLadder';
import { realVerdict, safetyVerdict, VerdictTone } from './verdicts';
import { parsePostedDate } from './repostFingerprint';

const DAY = 86_400_000;
export const DAILY_COUNT = 5;
const MAX_PER_COMPANY = 2;

export interface Candidate {
  id: string;
  source: 'analyzed' | 'discovered';
  title: string;
  company: string;
  location?: string;
  url: string;
  fit?: number; // honest fit score, when analyzed
  match?: number; // Discover's keyword match score
  postedAt?: number;
  warm: boolean;
  saved?: boolean;
  smallTeamReason?: string;
  real: VerdictTone;
  safety: VerdictTone;
}

/** Local calendar day, so "today" means the user's today, not UTC's. */
export function localDayKey(t = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The next 8:00 local time after `now`. */
export function nextDailyAt(now = Date.now(), hour = 8): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Pure ranking. Exported for tests. */
export function pickDaily5(candidates: Candidate[], { now = Date.now(), recentIds = new Set<string>() } = {}): DailyPick[] {
  const scored = candidates
    .filter((c) => c.real !== 'risk' && c.safety !== 'risk')
    .map((c) => {
      const reasons: string[] = [];
      let score = c.fit !== undefined ? c.fit * 0.55 : c.match !== undefined ? c.match * 0.5 : 25;
      if (c.fit !== undefined) reasons.push(`${c.fit}% fit`);
      const days = c.postedAt ? (now - c.postedAt) / DAY : undefined;
      if (days !== undefined) {
        if (days > 45) return null; // stale, not worth a morning slot
        score += days <= 3 ? 25 : days <= 7 ? 18 : days <= 14 ? 10 : days <= 30 ? 4 : 0;
        if (days <= 7) reasons.push(days < 1 ? 'posted today' : `posted ${Math.round(days)} d ago`);
      } else score += 6;
      if (c.warm) {
        score += 20;
        reasons.push('you know someone there');
      }
      if (c.real === 'ok') {
        score += 5;
        reasons.push('live on their board');
      }
      if (c.real === 'caution') score -= 5;
      if (c.smallTeamReason) {
        score += 5;
        reasons.push(c.smallTeamReason);
      }
      if (c.saved) {
        score += 8;
        reasons.push('you saved it');
      }
      if (recentIds.has(c.id)) score -= 15; // let new roles through instead of repeating yesterday
      return { c, score: Math.round(score), reasons };
    })
    .filter((x): x is { c: Candidate; score: number; reasons: string[] } => x !== null)
    .sort((a, b) => b.score - a.score);

  const perCompany = new Map<string, number>();
  const picks: DailyPick[] = [];
  for (const { c, score, reasons } of scored) {
    const key = c.company.toLowerCase();
    if ((perCompany.get(key) ?? 0) >= MAX_PER_COMPANY) continue;
    perCompany.set(key, (perCompany.get(key) ?? 0) + 1);
    picks.push({ id: c.id, source: c.source, title: c.title, company: c.company, location: c.location, url: c.url, score, reasons, warm: c.warm });
    if (picks.length === DAILY_COUNT) break;
  }
  return picks;
}

const sameRole = (a: { company: string; title: string }, b: { company: string; title: string }) =>
  companyMatches(a.company, b.company) && a.title.toLowerCase().replace(/[^a-z0-9]/g, '') === b.title.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Builds candidates from analyzed jobs and the Discover feed. */
export async function gatherCandidates(): Promise<Candidate[]> {
  const [jobs, discovered, connections, outreach] = await Promise.all([
    db.jobs.toArray(),
    db.discovered.toArray(),
    db.connections.toArray(),
    db.outreach.toArray(),
  ]);
  const contacted = new Set(outreach.map((o) => o.jobId));
  const warmAt = (company: string) => connections.some((c) => companyMatches(c.company, company));

  const analyzed: Candidate[] = jobs
    .filter((j: JobSnapshot) => j.analyzedAt > 0 && !contacted.has(j.id) && j.title && j.company)
    .map((j) => ({
      id: j.id,
      source: 'analyzed',
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      fit: j.fitScore,
      postedAt: j.atsPublishedAt ? Date.parse(j.atsPublishedAt) : parsePostedDate(j.postedDate, j.analyzedAt),
      warm: warmAt(j.company),
      real: realVerdict(j).tone,
      safety: safetyVerdict(j).tone,
    }));

  const fromFeed: Candidate[] = discovered
    .filter((d: DiscoveredJob) => d.kind !== 'company' && (d.status === 'new' || d.status === 'saved'))
    // If the user analyzed the same role, its verdicts and fit win (a Doubtful role stays out).
    .filter((d) => !analyzed.some((a) => sameRole(a, d)))
    .map((d) => {
      const twin = jobs.find((j) => j.analyzedAt > 0 && sameRole(j, d));
      return {
        id: d.id,
        source: 'discovered' as const,
        title: d.title,
        company: d.company,
        location: d.location,
        url: d.url,
        match: d.score,
        postedAt: d.postedAt,
        warm: warmAt(d.company),
        saved: d.status === 'saved',
        smallTeamReason: d.smallTeamReason,
        real: twin ? realVerdict(twin).tone : ('neutral' as VerdictTone),
        safety: twin ? safetyVerdict(twin).tone : ('neutral' as VerdictTone),
      };
    });

  return [...analyzed, ...fromFeed];
}

/** Picks and saves today's five. Returns the saved row. */
export async function buildDaily5(now = Date.now()): Promise<DailyPicks> {
  const recent = await db.daily.where('date').anyOf(localDayKey(now - DAY), localDayKey(now - 2 * DAY)).toArray();
  const recentIds = new Set(recent.flatMap((r) => r.picks.map((p) => p.id)));
  const picks = pickDaily5(await gatherCandidates(), { now, recentIds });
  const row: DailyPicks = { date: localDayKey(now), createdAt: now, picks };
  await db.daily.put(row);
  return row;
}
