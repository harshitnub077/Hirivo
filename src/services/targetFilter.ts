// The user's exclusions: companies and title words they never want to see or apply to.
import { titleHasTarget } from './targets';

/** "Acme, Inc." and "acme inc" are the same company; legal suffixes and punctuation don't count. */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|gmbh|plc|technologies|technology|labs)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Exclusions {
  excludeCompanies?: string[];
  excludeTitleWords?: string[];
}

/** The exclusion a job hits, or undefined. Title words match whole words ("intern" spares "international"). */
export function exclusionFor(job: { company: string; title: string }, ex: Exclusions): string | undefined {
  const company = normalizeCompany(job.company || '');
  const badCompany = (ex.excludeCompanies || []).find((c) => normalizeCompany(c) && normalizeCompany(c) === company);
  if (badCompany) return `company ${badCompany}`;
  const word = (ex.excludeTitleWords || []).map((w) => w.trim().toLowerCase()).find((w) => w && titleHasTarget(job.title || '', w));
  return word ? `title word "${word}"` : undefined;
}

export const isExcluded = (job: { company: string; title: string }, ex: Exclusions) => exclusionFor(job, ex) !== undefined;

/** Comma-separated text from a settings box → a clean list. */
export function parseList(text: string): string[] {
  return Array.from(new Set(text.split(',').map((s) => s.trim()).filter(Boolean)));
}
