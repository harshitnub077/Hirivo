// The Real and Safety verdicts shown on the Verdict Strip. One definition, used by the strip,
// Daily 5 and anything else that decides whether a job is worth the user's time.
import type { JobSnapshot } from '../db';

export type VerdictTone = 'ok' | 'caution' | 'risk' | 'neutral';

const RANK: Record<VerdictTone, number> = { neutral: 0, ok: 1, caution: 2, risk: 3 };
export const worstTone = (a: VerdictTone, b: VerdictTone): VerdictTone => (RANK[a] >= RANK[b] ? a : b);

const band = (score: number, good: number, ok: number): VerdictTone => (score >= good ? 'ok' : score >= ok ? 'caution' : 'risk');

type VerdictJob = Pick<JobSnapshot, 'analyzedAt' | 'atsType' | 'ghostScore' | 'legitScore' | 'scamLevel'>;

/** Real: is the job still open on the company's own board? Doubtful = likely stale or ghost. */
export function realVerdict(job: VerdictJob): { tone: VerdictTone; label: string } {
  if (!(job.analyzedAt > 0)) return { tone: 'neutral', label: '—' };
  const ghost = job.ghostScore ?? 0;
  if (job.atsType === 'unknown' && ghost < 60) return { tone: 'neutral', label: 'Unconfirmed' };
  const tone = band(100 - ghost, 65, 40);
  return { tone, label: tone === 'ok' ? 'Live' : tone === 'caution' ? 'Aging' : 'Doubtful' };
}

/** Safety: the worse of the company checks (domain, mail) and Scam Shield. */
export function safetyVerdict(job: VerdictJob): { tone: VerdictTone; label: string } {
  const legit: VerdictTone = job.legitScore === undefined ? 'neutral' : band(job.legitScore, 70, 45);
  const scam: VerdictTone = job.scamLevel === 'risk' ? 'risk' : job.scamLevel === 'caution' ? 'caution' : job.scamLevel === 'clear' ? 'ok' : 'neutral';
  const tone = worstTone(legit, scam);
  const label =
    tone === 'risk' ? 'Risky' : tone === 'caution' ? 'Check' : tone === 'ok' ? (job.legitScore === undefined ? 'No flags' : 'Clear') : job.analyzedAt > 0 ? 'Add site' : '—';
  return { tone, label };
}
