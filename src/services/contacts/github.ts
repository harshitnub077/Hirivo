// Public GitHub org members: engineers who can tell you about the team. Unauthenticated API
// (60 requests/hour per IP), so lookups are small and cached. No emails are collected.

export interface GithubMember {
  login: string;
  name?: string;
  profileUrl: string;
}

async function gh(path: string) {
  const res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}${res.status === 403 ? ' (hourly limit reached, try later)' : ''}`);
  return res.json();
}

/** Confirms the org exists; tries the homepage link first, then the domain's first label. */
export async function resolveOrg(candidates: (string | undefined)[]): Promise<string | undefined> {
  for (const org of Array.from(new Set(candidates.filter(Boolean) as string[]))) {
    const data = await gh(`/orgs/${encodeURIComponent(org)}`).catch(() => null);
    if (data?.login) return data.login as string;
  }
  return undefined;
}

export async function fetchOrgMembers(org: string, withNames = 6): Promise<GithubMember[]> {
  const list = ((await gh(`/orgs/${encodeURIComponent(org)}/members?per_page=12`)) || []) as { login: string; html_url: string }[];
  const members: GithubMember[] = list.map((m) => ({ login: m.login, profileUrl: m.html_url }));
  await Promise.all(
    members.slice(0, withNames).map(async (m) => {
      const user = await gh(`/users/${encodeURIComponent(m.login)}`).catch(() => null);
      if (typeof user?.name === 'string' && user.name.trim()) m.name = user.name.trim();
    })
  );
  return members;
}
