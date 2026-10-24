// Founders of YC companies, from the company's public page on ycombinator.com: names, titles and
// LinkedIn links the founders published themselves.
import { cached, fetchText } from '../siteAccess';
import { loadYcList } from '../discover/yc';

export interface Founder {
  name: string;
  title: string;
  linkedinUrl?: string;
}

const WEEK = 7 * 86_400_000;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const hostOf = (url: string) => {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Reads founders from the page's embedded data (`data-page` JSON). */
export function parseYcCompanyPage(html: string): { name: string; website: string; founders: Founder[] } | null {
  const raw = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-page]')?.getAttribute('data-page');
  if (!raw) return null;
  try {
    const company = JSON.parse(raw)?.props?.company;
    if (!company?.name) return null;
    const founders: Founder[] = (company.founders || [])
      .filter((f: any) => typeof f?.full_name === 'string' && f.full_name.trim())
      .map((f: any) => ({
        name: f.full_name.trim(),
        title: String(f.title || 'Founder').trim(),
        linkedinUrl: /linkedin\.com\//.test(f.linkedin_url || '') ? String(f.linkedin_url).replace(/^http:/, 'https:') : undefined,
      }));
    return { name: company.name, website: company.website || '', founders };
  } catch {
    return null;
  }
}

const slugsFor = (company: string) =>
  Array.from(new Set([company.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), norm(company)])).filter(Boolean);

/**
 * The founders when the company is a YC company, else []. Uses the hiring list's slug when it has
 * one, otherwise tries the company's name as the slug and checks the page is the same company
 * (same website, or the exact name when the website isn't known).
 */
export async function ycFounders(company: string, domain?: string): Promise<Founder[]> {
  const site = domain?.replace(/^www\./, '');
  const list = await loadYcList().catch(() => []);
  const hit = (site && list.find((c) => c.website && hostOf(c.website) === site)) || list.find((c) => norm(c.name) === norm(company));
  const slugs = hit ? [hit.slug] : slugsFor(company);
  return cached(`ycf:${slugs[0]}:${site || ''}`, WEEK, async () => {
    for (const slug of slugs) {
      const page = await fetchText(`https://www.ycombinator.com/companies/${slug}`);
      const parsed = page.ok ? parseYcCompanyPage(page.text) : null;
      if (!parsed) continue;
      const same = hit || (site ? hostOf(parsed.website) === site : norm(parsed.name) === norm(company));
      if (same) return parsed.founders;
    }
    return [];
  });
}
