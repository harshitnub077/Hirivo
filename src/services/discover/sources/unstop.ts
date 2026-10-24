// Unstop (formerly Dare2Compete): internships and fresher jobs from its public search API.
import type { MatchProfile, RawJob, SearchHost } from '../types';
import { monthlyPay } from './common';

export function unstopUrls(p: MatchProfile): string[] {
  const kinds = p.search.jobType === 'internship' ? ['internships'] : p.search.jobType === 'fulltime' ? ['jobs'] : ['internships', 'jobs'];
  return kinds.flatMap((k) =>
    p.queries.slice(0, 2).map((q) => `https://unstop.com/api/public/opportunity/search-result?opportunity=${k}&page=1&per_page=30&oppstatus=open&searchTerm=${encodeURIComponent(q)}`)
  );
}

export function parseUnstop(json: any, kind: 'internships' | 'jobs'): RawJob[] {
  const list: any[] = json?.data?.data || [];
  return list
    .filter((x) => x?.id && x?.title)
    .map((x) => {
      const cities = [...(x.jobDetail?.locations || []), x.address_with_country_logo?.city].filter(Boolean).map(String);
      const remote = x.region === 'online' || /work from home|remote/i.test(cities.join(' '));
      const pay = x.jobDetail?.show_salary ? `${x.jobDetail?.min_salary || ''}-${x.jobDetail?.max_salary || ''} ${x.jobDetail?.paid_salary_type || ''}` : '';
      return {
        source: 'unstop' as const,
        sourceId: String(x.id),
        sourceLabel: 'Unstop',
        title: String(x.title),
        company: String(x.organisation?.name || ''),
        location: cities.join(', ') || (remote ? 'Remote' : 'India'),
        remote,
        url: `https://unstop.com/${String(x.public_url || x.seo_url || '').replace(/^\//, '')}`,
        postedAt: Date.parse(x.approved_date || x.updated_at) || undefined,
        salary: pay.trim() || undefined,
        monthlyPay: pay ? monthlyPay(pay) : undefined,
        tags: (x.required_skills || []).map((s: any) => String(s?.name || s?.skill || s).toLowerCase()).filter((s: string) => s && s !== '[object object]'),
        internship: kind === 'internships',
        applyVia: 'unstop' as const,
      };
    });
}

export async function searchUnstop(p: MatchProfile, host: SearchHost): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const url of unstopUrls(p)) {
    const res = await host.fetchText(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!res.ok) continue;
    try {
      out.push(...parseUnstop(JSON.parse(res.text), url.includes('opportunity=internships') ? 'internships' : 'jobs'));
    } catch {
      /* skip a malformed page */
    }
  }
  return out;
}
