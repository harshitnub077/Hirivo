// Which Discover job a board's "application received" page belongs to. Pure, so it can be tested.

/** "greenhouse.io/acme" for boards.greenhouse.io/acme/jobs/1: the board host plus its first path segment. */
export function boardKey(u: string): string {
  try {
    const url = new URL(u);
    return `${url.hostname.replace(/^(job-boards|boards)\./, '')}/${url.pathname.split('/').filter(Boolean)[0] || ''}`;
  } catch {
    return '';
  }
}

const pathOf = (u: string) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
};

/**
 * The applying job whose board matches the confirmation page, or undefined. There is no fallback:
 * a submission on an unrelated board must not mark some other job applied.
 */
export function matchAppliedJob<J extends { url: string }>(applying: J[], pageUrl: string): J | undefined {
  const key = boardKey(pageUrl);
  if (!key) return undefined;
  const sameBoard = applying.filter((j) => boardKey(j.url) === key);
  if (sameBoard.length <= 1) return sameBoard[0];
  // Two jobs on one company board: the confirmation page usually sits under the job's own path.
  const page = pathOf(pageUrl);
  const underJob = sameBoard.filter((j) => {
    const p = pathOf(j.url);
    return p !== '' && (page === p || page.startsWith(`${p}/`));
  });
  return underJob.length === 1 ? underJob[0] : undefined;
}
