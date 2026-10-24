// The Real, Safety and Fit checks for one job, shared by the Now view and Autopilot.
import type { JobSnapshot, ResumeFact, ResumeRecord, UserSettings } from '../db';
import { checkGhostJob } from './ghostJobShield';
import { checkLegitimacy } from './legitimacyScorer';
import { analyzeJobFit } from './fitAdvisor';
import { checkScam } from './scamShield';
import { recordFingerprint } from './repostFingerprint';
import { companyDomainOf } from './companyDomain';

export interface CheckInput {
  resume: ResumeRecord | null | undefined;
  facts: ResumeFact[];
  settings: UserSettings;
}

/** Runs every check and returns the updated job. `fitError` is set when only the fit step failed. */
export async function runJobChecks(job: JobSnapshot, { resume, facts, settings }: CheckInput): Promise<{ job: JobSnapshot; fitError?: string }> {
  const domain = companyDomainOf(job.companyDomain) || companyDomainOf(job.url);
  const hasKey = Boolean(settings.groqApiKey || settings.geminiApiKey || settings.openrouterApiKey);
  const fitWanted = hasKey && (facts.length > 0 || !!resume);
  const [ghost, legit, fit] = await Promise.all([
    checkGhostJob({
      jobTitle: job.title,
      companyName: job.company,
      sourceUrl: job.url,
      atsUrl: job.atsUrl,
      jobPostedDate: job.postedDate,
      isReposted: job.isReposted,
    }),
    checkLegitimacy({ domain, companyName: job.company }),
    fitWanted
      ? analyzeJobFit(job.title, job.company, job.description, resume ?? null, facts, { yearsExperience: settings.yearsExperience, skills: settings.skills }).catch((e: Error) => e)
      : null,
  ]);
  const fitResult = fit instanceof Error ? null : fit;
  // Domain age and mail records are shown from legit itself, so Scam Shield only reads the listing here.
  const scam = checkScam({ title: job.title, description: job.description, companyDomain: domain });
  const repost = await recordFingerprint(job).catch(() => null);
  const scamFindings = [...scam.findings, ...(repost?.finding ? [repost.finding] : [])];
  const scamLevel = scamFindings.some((f) => f.tone === 'risk') ? 'risk' : scamFindings.length ? 'caution' : 'clear';
  return {
    fitError: fit instanceof Error ? fit.message : undefined,
    job: {
      ...job,
      ghostScore: ghost.ghostScore,
      ghostReasons: ghost.reasons,
      atsType: ghost.atsType,
      atsSlug: ghost.atsSlug,
      atsPublishedAt: ghost.atsPublishedAt,
      scamLevel,
      scamFindings,
      companyDomain: domain,
      legitScore: domain && legit.checked ? legit.score : undefined,
      legitDetails: domain && legit.checked ? { domainAgeDays: legit.domainAgeDays, hasMx: legit.hasMx, mailProvider: legit.mailProvider, isFreeEmail: legit.isFreeEmail } : undefined,
      ...(fitResult
        ? {
            fitScore: fitResult.matchScore,
            fitVerdict: fitResult.verdict,
            honestAdvice: fitResult.honestAdvice,
            dealbreakers: fitResult.dealbreakers,
            matchingStrengths: fitResult.matchingStrengths,
            skillGaps: fitResult.skillGaps,
            fitEvidence: fitResult.evidence,
            // Requirement ids change between runs; keep a sprint only once it's done (its fact stays).
            proofSprint: job.proofSprint?.completedAt ? job.proofSprint : undefined,
          }
        : {}),
      analyzedAt: Date.now(),
    },
  };
}
