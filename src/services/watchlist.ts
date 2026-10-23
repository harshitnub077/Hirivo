// Watchlist Radar: companies the user follows, read straight from their public ATS feeds.
// Nothing here is scored or "verified" by hand; every role shown exists on the company's board.
import { db, WatchedRole, WatchlistCompany } from '../db';
import { AtsRef, fetchRoles, parseAtsUrl } from './atsFeeds';
import seeds from './watchlistSeeds.json';

export interface SeedCompany extends AtsRef {
  name: string;
  region: string;
  openRolesAtCheck: number;
}

export const SEED_COMPANIES: SeedCompany[] = seeds.companies as SeedCompany[];
export const SEEDS_VERIFIED_AT: string = seeds.verifiedAt;

const HISTORY_LIMIT = 40;

export function companyId(ref: AtsRef) {
  return `${ref.ats}:${ref.slug.toLowerCase()}`;
}

export async function addCompany(input: string | SeedCompany): Promise<WatchlistCompany> {
  const ref: AtsRef | null = typeof input === 'string' ? parseAtsUrl(input) : input;
  if (!ref) {
    throw new Error('Paste the company careers link from Greenhouse, Lever or Ashby (for example jobs.lever.co/cred).');
  }
  const id = companyId(ref);
  const existing = await db.watchlist.get(id);
  if (existing) return existing;

  const name = typeof input === 'string' ? prettifySlug(ref.slug) : input.name;
  const company: WatchlistCompany = {
    id,
    name,
    ats: ref.ats,
    slug: ref.slug,
    addedAt: Date.now(),
    status: 'pending',
    roles: [],
    newRoleIds: [],
    roleCountHistory: [],
  };
  await db.watchlist.put(company);
  return refreshCompany(company);
}

export async function refreshCompany(company: WatchlistCompany): Promise<WatchlistCompany> {
  let next: WatchlistCompany;
  try {
    const roles = await fetchRoles(company);
    if (roles === null) {
      next = { ...company, status: 'not_found', lastCheckedAt: Date.now() };
    } else {
      // A role is "new" only if we had already looked at this board before and hadn't seen it.
      const known = new Set(company.roles.map((r) => r.id));
      const fresh = company.lastCheckedAt ? roles.filter((r) => !known.has(r.id)).map((r) => r.id) : [];
      next = {
        ...company,
        status: 'ok',
        roles,
        lastCheckedAt: Date.now(),
        newRoleIds: Array.from(new Set([...company.newRoleIds.filter((id) => roles.some((r) => r.id === id)), ...fresh])),
        roleCountHistory: [...company.roleCountHistory, { at: Date.now(), count: roles.length }].slice(-HISTORY_LIMIT),
      };
    }
  } catch {
    next = { ...company, status: 'error', lastCheckedAt: Date.now() };
  }
  await db.watchlist.put(next);
  return next;
}

/** Refreshes every company; returns roles that are new since the last check. */
export async function refreshAll(): Promise<{ company: WatchlistCompany; role: WatchedRole }[]> {
  const companies = await db.watchlist.toArray();
  const found: { company: WatchlistCompany; role: WatchedRole }[] = [];
  for (const c of companies) {
    const before = new Set(c.newRoleIds);
    const after = await refreshCompany(c);
    for (const role of after.roles) {
      if (after.newRoleIds.includes(role.id) && !before.has(role.id)) found.push({ company: after, role });
    }
  }
  return found;
}

export async function markSeen(id: string) {
  await db.watchlist.update(id, { newRoleIds: [] });
}

export async function removeCompany(id: string) {
  await db.watchlist.delete(id);
}

export function matchesTargets(title: string, targets: string[] | undefined): boolean {
  const words = (targets || []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (words.length === 0) return true;
  const t = title.toLowerCase();
  return words.some((w) => t.includes(w));
}

/** Hiring pulse: compares today's open-role count with the oldest one in the last 30 days. */
export function hiringPulse(c: WatchlistCompany): { trend: 'growing' | 'steady' | 'shrinking'; delta: number } | null {
  const monthAgo = Date.now() - 30 * 86_400_000;
  const window = c.roleCountHistory.filter((h) => h.at >= monthAgo);
  if (window.length < 2) return null;
  const delta = window[window.length - 1].count - window[0].count;
  const pct = window[0].count ? delta / window[0].count : 0;
  return { trend: pct > 0.1 ? 'growing' : pct < -0.1 ? 'shrinking' : 'steady', delta };
}

function prettifySlug(slug: string) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
