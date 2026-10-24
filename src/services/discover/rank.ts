// Scores a job against the user without AI, so every number has plain reasons behind it.
import type { MatchProfile, RawJob } from './types';
import { titleHasTarget } from '../targets';

const INDIA = /india|bengaluru|bangalore|mumbai|delhi|ncr|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|kochi|jaipur/i;
const WORLDWIDE = /worldwide|anywhere|global|apac|asia|emea\s*&?\s*apac|remote\s*\(?any/i;
const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|manager|architect)\b/i;
const JUNIOR = /\b(intern|internship|junior|jr\.?|graduate|entry|new grad|fresher|trainee|associate)\b/i;

export function locationFits(job: Pick<RawJob, 'location' | 'remote'>, pref: MatchProfile['locationPreference']): boolean {
  if (pref === 'anywhere') return true;
  if (pref === 'remote') return job.remote;
  // India-first: Indian locations, or remote roles open to India.
  if (INDIA.test(job.location)) return true;
  return job.remote && (WORLDWIDE.test(job.location) || /^remote$/i.test(job.location.trim()));
}

const tokenize = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9+#.]+/g) || []).map((w) => w.replace(/\.$/, '')));

export function scoreJob(job: RawJob, p: MatchProfile, now = Date.now()): { score: number; reasons: string[] } | null {
  if (!locationFits(job, p.locationPreference)) return null;
  if (p.smallTeamsOnly && !job.smallTeamReason) return null;

  const title = job.title.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const titleHit = p.targets.find((t) => titleHasTarget(title, t));
  if (job.kind === 'company') score += 25; // a small team that is hiring, worth a direct note
  else if (p.targets.length === 0) score += 20;
  else if (titleHit) {
    score += 50;
    reasons.push(`Title matches “${titleHit}”`);
  } else {
    return null; // not one of the roles the user asked for
  }

  const text = tokenize(`${job.title} ${job.tags.join(' ')} ${job.snippet || ''}`);
  const skillHits = p.skills.filter((s) => (s.includes(' ') ? `${job.title} ${job.snippet} ${job.tags.join(' ')}`.toLowerCase().includes(s) : text.has(s)));
  if (skillHits.length) {
    score += Math.min(30, skillHits.length * 8);
    reasons.push(`Uses ${skillHits.slice(0, 3).join(', ')}`);
  }

  if (job.postedAt) {
    const days = (now - job.postedAt) / 86_400_000;
    if (days > 45) return null; // stale listings are not worth a slot in the feed
    score += days <= 3 ? 15 : days <= 7 ? 10 : days <= 21 ? 5 : 0;
    if (days <= 3) reasons.push('Posted in the last 3 days');
  }

  if (job.smallTeamReason) {
    score += 5;
    reasons.push(`Small team (${job.teamSize} people)`);
  }

  if (p.level === 'entry' || p.level === 'intern') {
    if (SENIOR.test(job.title)) {
      score -= 30;
      reasons.push('Senior role; likely above your level');
    } else if (JUNIOR.test(job.title)) {
      score += 10;
      reasons.push('Junior-friendly title');
    }
  } else if (p.level === 'senior' && JUNIOR.test(job.title)) {
    score -= 20;
  }

  if (INDIA.test(job.location) && p.locationPreference === 'india') score += 5;
  return { score: Math.max(0, Math.min(100, score)), reasons };
}
