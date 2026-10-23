export interface GhostJobCheckParams {
  jobTitle: string;
  companyName: string;
  companyDomain?: string;
  jobPostedDate?: string;
  sourceUrl: string;
  isReposted?: boolean;
}

export interface GhostJobResult {
  ghostScore: number; // 0-100 (higher = more likely ghost job)
  status: 'FRESH_LIVE' | 'MODERATE_RISK' | 'HIGH_GHOST_RISK';
  atsFound: boolean;
  atsType?: 'greenhouse' | 'lever' | 'ashby' | 'unknown';
  reasons: string[];
  liveJobCount?: number;
}

// Clean company name to standard slug format
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export async function checkGhostJob(params: GhostJobCheckParams): Promise<GhostJobResult> {
  const reasons: string[] = [];
  let ghostScore = 15; // Baseline low risk
  let atsFound = false;
  let atsType: GhostJobResult['atsType'] = 'unknown';
  let liveJobCount = 0;

  const slug = slugify(params.companyName);

  // 1. Try public Greenhouse API
  try {
    const ghRes = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
      method: 'GET',
    });
    if (ghRes.ok) {
      const data = await ghRes.json();
      if (Array.isArray(data.jobs)) {
        atsFound = true;
        atsType = 'greenhouse';
        liveJobCount = data.jobs.length;
        const normalizedTitle = params.jobTitle.toLowerCase();
        const matches = data.jobs.some((j: any) =>
          j.title?.toLowerCase().includes(normalizedTitle) ||
          normalizedTitle.includes(j.title?.toLowerCase())
        );

        if (matches) {
          reasons.push(`Verified live on company's Greenhouse ATS (${liveJobCount} open roles).`);
          ghostScore = 5;
        } else {
          reasons.push(`Company uses Greenhouse with ${liveJobCount} live listings, but this specific role is NOT on their board.`);
          ghostScore += 45;
        }
      }
    }
  } catch (err) {
    // Silent failover to Lever
  }

  // 2. Try Lever API if Greenhouse was not found
  if (!atsFound) {
    try {
      const leverRes = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
        method: 'GET',
      });
      if (leverRes.ok) {
        const jobs = await leverRes.json();
        if (Array.isArray(jobs) && jobs.length > 0) {
          atsFound = true;
          atsType = 'lever';
          liveJobCount = jobs.length;
          const normalizedTitle = params.jobTitle.toLowerCase();
          const matches = jobs.some((j: any) =>
            j.text?.toLowerCase().includes(normalizedTitle) ||
            normalizedTitle.includes(j.text?.toLowerCase())
          );

          if (matches) {
            reasons.push(`Verified active on Lever ATS feed.`);
            ghostScore = 5;
          } else {
            reasons.push(`Company Lever board is live (${liveJobCount} roles), but this title is missing.`);
            ghostScore += 45;
          }
        }
      }
    } catch (err) {
      // Continue
    }
  }

  // 3. Evaluate posting age and repost flags
  if (params.isReposted) {
    ghostScore += 25;
    reasons.push('Listing has been repeatedly reposted without hiring.');
  }

  if (params.jobPostedDate) {
    const lower = params.jobPostedDate.toLowerCase();
    if (lower.includes('30+') || lower.includes('month') || lower.includes('weeks ago')) {
      const isVeryOld = lower.includes('2 months') || lower.includes('3 months') || lower.includes('30+');
      if (isVeryOld) {
        ghostScore += 35;
        reasons.push(`Listing age is stale (${params.jobPostedDate}). High likelihood of evergreen resume harvesting.`);
      } else {
        ghostScore += 15;
        reasons.push(`Posted ${params.jobPostedDate}.`);
      }
    }
  }

  // Cap score between 0 and 100
  ghostScore = Math.min(100, Math.max(0, ghostScore));

  let status: GhostJobResult['status'] = 'FRESH_LIVE';
  if (ghostScore >= 60) {
    status = 'HIGH_GHOST_RISK';
  } else if (ghostScore >= 35) {
    status = 'MODERATE_RISK';
  }

  if (reasons.length === 0) {
    reasons.push('Standard active listing signals detected.');
  }

  return {
    ghostScore,
    status,
    atsFound,
    atsType,
    reasons,
    liveJobCount,
  };
}
