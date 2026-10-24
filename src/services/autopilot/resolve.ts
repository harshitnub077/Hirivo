// A job found on LinkedIn, Naukri, Indeed or another portal is often also on the company's own
// Greenhouse, Lever or Ashby board, where Hirivo can fill and submit the form. This finds that copy
// by trying the company's likely board names and matching the role title.
import { fetchRoles, type AtsType } from '../atsFeeds';

const SUFFIX = /\b(?:private|pvt|limited|ltd|llp|inc|incorporated|corp(?:oration)?|co|company|technologies|technology|tech|labs?|software|solutions|services|systems|india|global|group|hq)\b\.?/gi;

/** Board names a company is likely to use: "Acme Labs Pvt Ltd" → acmelabs, acme-labs, acme. */
export function boardSlugs(company: string): string[] {
  const base = company.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const core = base.replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  const out = [base.replace(/ /g, ''), base.replace(/ /g, '-'), core.replace(/ /g, ''), core.replace(/ /g, '-'), core.split(' ')[0]];
  return Array.from(new Set(out.filter((s) => s.length >= 2))).slice(0, 4);
}

const LEVEL_NOISE = /\b(?:i{1,3}|iv|[1-4]|sr|jr|remote|hybrid|onsite|on-site|in-office|full[- ]?time|part[- ]?time|immediate joiner|urgent(?:ly)? hiring|fresher|freshers)\b/g;
const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(?:sde|swe)\b/g, 'software engineer')
    .replace(/\binternship\b/g, 'intern')
    .replace(LEVEL_NOISE, ' ')
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 1 && !/^(?:at|in|for|the|and|of|with|to|a|an)$/.test(w));

/** Whether two postings' titles name the same role ("SDE Intern" ≈ "Software Engineer Intern"). */
export function sameRole(a: string, b: string): boolean {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  // Both intern or both not: an internship and a full-time role are different jobs.
  if (x.has('intern') !== y.has('intern')) return false;
  return shared / Math.min(x.size, y.size) >= 0.8 && shared / Math.max(x.size, y.size) >= 0.5;
}

export interface ResolvedPosting {
  ats: AtsType;
  slug: string;
  url: string;
  title: string;
}

/** The same job on the company's own board, or null. At most 4 names × 3 boards are tried. */
export async function resolveCompanyPosting(company: string, title: string): Promise<ResolvedPosting | null> {
  for (const slug of boardSlugs(company)) {
    for (const ats of ['greenhouse', 'lever', 'ashby'] as AtsType[]) {
      const roles = await fetchRoles({ ats, slug }).catch(() => null);
      if (!roles?.length) continue;
      const match = roles.find((r) => sameRole(r.title, title));
      // The company's board exists; if the role isn't on it, a different board won't have it.
      return match ? { ats, slug, url: match.url, title: match.title } : null;
    }
  }
  return null;
}
