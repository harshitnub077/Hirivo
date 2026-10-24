// Filters and scores a job against the user's search without AI, so every number has plain reasons.
import type { MatchProfile, RawJob } from './types';
import { titleHasTarget, isGenericTarget } from '../targets';
import { cityOf, distanceKm } from './geo';

const INDIA = /india|bengaluru|bangalore|mumbai|delhi|ncr|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|kochi|jaipur/i;
const WORLDWIDE = /worldwide|anywhere|global|apac|asia|emea\s*&?\s*apac|remote\s*\(?any/i;
const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|manager|architect)\b/i;
const JUNIOR = /\b(intern|internship|junior|jr\.?|graduate|entry|new grad|fresher|trainee|associate)\b/i;
const INTERN = /\b(intern|interns|internship|trainee|apprentice(ship)?)\b/i;
// Sources that only list India-based roles (or were searched for the user's city).
const INDIA_SOURCES = new Set(['naukri', 'internshala', 'unstop']);
// Sources searched with the user's own keywords and location: their results are already on topic.
const SEARCHED = new Set(['linkedin', 'naukri', 'indeed', 'internshala', 'unstop']);

const isRemote = (job: Pick<RawJob, 'location' | 'remote'>) => job.remote || /remote|work from home|\bwfh\b/i.test(job.location);
const isHybrid = (job: Pick<RawJob, 'location'>) => /hybrid/i.test(job.location);

/** Whether a job's place fits the search, and how far it is from the search city when both are known. */
export function placeFits(job: Pick<RawJob, 'location' | 'remote' | 'source'>, p: MatchProfile): { ok: boolean; distanceKm?: number } {
  const s = p.search;
  const remote = isRemote(job);
  if (s.scope === 'remote') return { ok: remote };
  if (remote) {
    if (!s.workModes.includes('remote')) return { ok: false };
    return { ok: INDIA_SOURCES.has(job.source) || INDIA.test(job.location) || WORLDWIDE.test(job.location) || /^remote$/i.test(job.location.trim()) || job.source === 'linkedin' };
  }
  if (!s.workModes.includes(isHybrid(job) ? 'hybrid' : 'onsite') && !(isHybrid(job) && s.workModes.includes('onsite'))) return { ok: false };
  const city = cityOf(job.location);
  if (s.scope === 'india') return { ok: city ? city.country === 'India' : INDIA.test(job.location) || INDIA_SOURCES.has(job.source) };
  if (!p.center) return { ok: city ? city.country === 'India' : INDIA.test(job.location) };
  if (city) {
    const d = distanceKm(p.center, city);
    return { ok: d <= s.radiusKm, distanceKm: d };
  }
  // A place Hirivo can't pin down: trust sources that were asked for this city.
  return { ok: SEARCHED.has(job.source) && job.source !== 'unstop' };
}

/** Kept for older callers: the coarse India / remote / anywhere check. */
export function locationFits(job: Pick<RawJob, 'location' | 'remote'>, pref: MatchProfile['locationPreference']): boolean {
  if (pref === 'anywhere') return true;
  if (pref === 'remote') return job.remote;
  if (INDIA.test(job.location)) return true;
  return job.remote && (WORLDWIDE.test(job.location) || /^remote$/i.test(job.location.trim()));
}

const tokenize = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9+#.]+/g) || []).map((w) => w.replace(/\.$/, '')));

/** A target phrase in the title, or (for searched sources) one of its specific words. */
function titleMatch(title: string, p: MatchProfile, searched: boolean): string | undefined {
  const exact = p.targets.find((t) => titleHasTarget(title, t));
  if (exact || !searched) return exact;
  const words = p.targets.flatMap((t) => t.split(/\s+/)).filter((w) => w.length > 2 && !isGenericTarget(w));
  return words.find((w) => titleHasTarget(title, w));
}

export function scoreJob(job: RawJob, p: MatchProfile, now = Date.now()): { score: number; reasons: string[]; distanceKm?: number } | null {
  const s = p.search;
  const place = placeFits(job, p);
  if (!place.ok) return null;
  if (p.smallTeamsOnly && !job.smallTeamReason) return null;

  const internship = job.internship ?? INTERN.test(job.title);
  if (s.jobType === 'internship' && !internship) return null;
  if (s.jobType === 'fulltime' && internship) return null;
  if (s.minMonthlyPay && job.monthlyPay !== undefined && job.monthlyPay < s.minMonthlyPay) return null;

  const title = job.title.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const searched = SEARCHED.has(job.source);

  const titleHit = titleMatch(title, p, searched);
  if (job.kind === 'company') score += 25; // a small team that is hiring, worth a direct note
  else if (p.targets.length === 0) score += 20;
  else if (titleHit) {
    score += 50;
    reasons.push(`Title matches “${titleHit}”`);
  } else {
    return null; // not one of the roles the user asked for
  }

  const text = tokenize(`${job.title} ${job.tags.join(' ')} ${job.snippet || ''}`);
  const skillHits = p.skills.filter((sk) => (sk.includes(' ') ? `${job.title} ${job.snippet} ${job.tags.join(' ')}`.toLowerCase().includes(sk) : text.has(sk)));
  if (skillHits.length) {
    score += Math.min(30, skillHits.length * 8);
    reasons.push(`Uses ${skillHits.slice(0, 3).join(', ')}`);
  }

  if (job.postedAt) {
    const days = (now - job.postedAt) / 86_400_000;
    if (days > Math.max(s.postedWithinDays, 1) + 0.5) return null; // older than the user asked for
    score += days <= 1 ? 18 : days <= 3 ? 15 : days <= 7 ? 10 : days <= 21 ? 5 : 0;
    if (days <= 1) reasons.push('Posted in the last day');
    else if (days <= 3) reasons.push('Posted in the last 3 days');
  } else if (s.postedWithinDays <= 3 && !searched) {
    return null; // can't tell how fresh it is, and the user wants fresh
  }

  if (place.distanceKm !== undefined) {
    score += place.distanceKm <= 10 ? 6 : place.distanceKm <= 25 ? 4 : 2;
    if (place.distanceKm > 0) reasons.push(`${place.distanceKm} km away`);
  }

  if (job.smallTeamReason) {
    score += 5;
    reasons.push(`Small team (${job.teamSize} people)`);
  }

  const fresher = s.experience === 'fresher' || p.level === 'entry' || p.level === 'intern';
  if (fresher) {
    if (SENIOR.test(job.title)) {
      if (s.experience === 'fresher') return null;
      score -= 30;
      reasons.push('Senior role; likely above your level');
    } else if (JUNIOR.test(job.title)) {
      score += 10;
      reasons.push('Junior-friendly title');
    }
  } else if ((p.level === 'senior' || s.experience === '5+') && JUNIOR.test(job.title)) {
    score -= 20;
  }

  if (internship && s.jobType !== 'fulltime') reasons.push('Internship');
  if (job.monthlyPay) reasons.push(`₹${job.monthlyPay.toLocaleString('en-IN')}/month`);
  return { score: Math.max(0, Math.min(100, score)), reasons, distanceKm: place.distanceKm };
}
