// Real addresses at the company's domain from its public GitHub commits. Used only as evidence of
// the email format; these people are not contacted, and their addresses are not stored.
import { cached } from '../siteAccess';
import type { EmailEvidence } from './emailPattern';

const WEEK = 7 * 86_400_000;

async function gh(path: string) {
  const res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

export function commitEvidence(commits: any[], domain: string): EmailEvidence[] {
  const d = domain.toLowerCase().replace(/^www\./, '');
  const out = new Map<string, EmailEvidence>();
  for (const c of commits) {
    for (const who of [c?.commit?.author, c?.commit?.committer]) {
      const email = String(who?.email || '').toLowerCase();
      const name = String(who?.name || '').trim();
      const host = email.split('@')[1] || '';
      if (!name.includes(' ') || /noreply/.test(email) || !(host === d || host.endsWith(`.${d}`))) continue;
      out.set(email, { name, email, source: 'github' });
    }
  }
  return [...out.values()];
}

/** Up to 3 GitHub calls: recently pushed repos, then commits of the two most recent. */
export function githubEmailEvidence(org: string, domain: string): Promise<EmailEvidence[]> {
  return cached(`ghmail:${org}:${domain}`, WEEK, async () => {
    const repos = ((await gh(`/orgs/${encodeURIComponent(org)}/repos?sort=pushed&per_page=5`)) || []) as { name: string; fork: boolean }[];
    const out: EmailEvidence[] = [];
    for (const r of repos.filter((r) => !r.fork).slice(0, 2)) {
      const commits = await gh(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(r.name)}/commits?per_page=50`).catch(() => []);
      out.push(...commitEvidence(commits, domain));
      if (out.length >= 3) break;
    }
    return out;
  });
}
