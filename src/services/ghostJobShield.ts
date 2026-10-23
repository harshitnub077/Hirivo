import { daysSince, fetchRoles, findMatchingRole, parseAtsUrl, AtsRef } from './atsFeeds';

export interface GhostJobCheckParams {
  jobTitle: string;
  companyName: string;
  sourceUrl: string;
  atsUrl?: string;
  jobPostedDate?: string; // as shown on the job board, e.g. "3 weeks ago"
  isReposted?: boolean;
}

export interface GhostJobResult {
  ghostScore: number; // 0-100, higher = more likely stale or fake
  status: 'FRESH_LIVE' | 'MODERATE_RISK' | 'HIGH_GHOST_RISK' | 'UNKNOWN';
  atsFound: boolean;
  atsType?: AtsRef['ats'] | 'unknown';
  atsSlug?: string;
  atsPublishedAt?: string;
  boardWasGuessed: boolean;
  reasons: string[];
  liveJobCount?: number;
}

const slugGuesses = (name: string) => {
  const base = name.toLowerCase().replace(/\b(inc|llc|ltd|pvt|private|limited|technologies|labs)\b\.?/g, '');
  return Array.from(new Set([base.replace(/[^a-z0-9]/g, ''), base.trim().replace(/[^a-z0-9]+/g, '-')])).filter(Boolean);
};

export async function checkGhostJob(params: GhostJobCheckParams): Promise<GhostJobResult> {
  const reasons: string[] = [];
  let score = 30; // unknown until proven either way
  let boardWasGuessed = false;

  // 1. Prefer the board the page itself links to. Guess from the name only as a last resort.
  let ref = parseAtsUrl(params.atsUrl) || parseAtsUrl(params.sourceUrl);
  let roles = ref ? await fetchRoles(ref).catch(() => null) : null;
  if (!roles) {
    for (const slug of slugGuesses(params.companyName)) {
      for (const ats of ['greenhouse', 'lever', 'ashby'] as const) {
        const found = await fetchRoles({ ats, slug }).catch(() => null);
        if (found && found.length > 0) {
          ref = { ats, slug };
          roles = found;
          boardWasGuessed = true;
          break;
        }
      }
      if (roles) break;
    }
  }

  let atsPublishedAt: string | undefined;
  if (ref && roles) {
    const match = findMatchingRole(roles, params.jobTitle, params.sourceUrl);
    const where = `${params.companyName}'s ${ref.ats[0].toUpperCase()}${ref.ats.slice(1)} board`;
    if (match) {
      score = 8;
      atsPublishedAt = match.publishedAt;
      const age = daysSince(match.publishedAt);
      reasons.push(`Listed on ${where} right now.`);
      if (age !== undefined) {
        if (age > 90) {
          score += 35;
          reasons.push(`Open for ${age} days on the company's own board. Roles this old are often evergreen or already filled.`);
        } else if (age > 45) {
          score += 15;
          reasons.push(`Open for ${age} days. Still live, but not fresh.`);
        } else {
          reasons.push(`Posted ${age} day${age === 1 ? '' : 's'} ago on the company's board.`);
        }
      }
    } else {
      score = 70;
      reasons.push(`${where} has ${roles.length} open roles, but not this one. It may be closed, or posted only on the job board.`);
    }
    if (boardWasGuessed) reasons.push('Board found by name; double-check it belongs to this company.');
  } else {
    reasons.push('No public Greenhouse, Lever or Ashby board found, so the company board could not confirm this role.');
  }

  if (params.isReposted) {
    score += 20;
    reasons.push('The job board marks this listing as reposted.');
  }
  const posted = params.jobPostedDate?.toLowerCase() || '';
  if (/(\d+|a)\s+months?\s+ago|30\+\s*days/.test(posted)) {
    score += 15;
    reasons.push(`Job board shows it was posted "${params.jobPostedDate}".`);
  }

  score = Math.min(100, Math.max(0, score));
  const status: GhostJobResult['status'] = !roles
    ? 'UNKNOWN'
    : score >= 60
      ? 'HIGH_GHOST_RISK'
      : score >= 35
        ? 'MODERATE_RISK'
        : 'FRESH_LIVE';

  return {
    ghostScore: score,
    status,
    atsFound: !!roles,
    atsType: ref?.ats ?? 'unknown',
    atsSlug: ref?.slug,
    atsPublishedAt,
    boardWasGuessed,
    reasons,
    liveJobCount: roles?.length,
  };
}
