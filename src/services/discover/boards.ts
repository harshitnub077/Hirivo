// Free public job APIs. Each one asks for credit and a link back to the original posting,
// which the UI always shows ("via Remotive") and every Apply button honours.
// Remotive asks for at most 4 calls a day, so callers cache for 6 hours.
import type { RawJob } from './types';
import { htmlToText } from './hn';

const ts = (v: unknown): number | undefined => {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};

const clip = (html: unknown, n = 600) => (typeof html === 'string' ? htmlToText(html).slice(0, n) : undefined);

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}`);
  return res.json();
}

export async function fetchRemotive(): Promise<RawJob[]> {
  const data = await getJson('https://remotive.com/api/remote-jobs?limit=300');
  return (data.jobs || []).map((j: any) => ({
    source: 'remotive',
    sourceId: String(j.id),
    sourceLabel: 'Remotive',
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || 'Remote',
    remote: true,
    url: j.url,
    postedAt: ts(j.publication_date),
    salary: j.salary || undefined,
    tags: (j.tags || []).map((t: string) => t.toLowerCase()),
    snippet: clip(j.description),
  }));
}

export async function fetchRemoteOk(): Promise<RawJob[]> {
  const data = await getJson('https://remoteok.com/api');
  return (Array.isArray(data) ? data : [])
    .filter((j: any) => j && j.id && j.position)
    .map((j: any) => ({
      source: 'remoteok',
      sourceId: String(j.id),
      sourceLabel: 'Remote OK',
      title: j.position,
      company: j.company,
      location: j.location || 'Remote',
      remote: true,
      url: j.url,
      postedAt: ts(j.epoch) ?? ts(j.date),
      salary: j.salary_min ? `$${Math.round(j.salary_min / 1000)}k–$${Math.round((j.salary_max || j.salary_min) / 1000)}k` : undefined,
      tags: (j.tags || []).map((t: string) => t.toLowerCase()),
      snippet: clip(j.description),
    }));
}

// The feed returns 20 jobs per call, so search for the user's top roles instead of reading the latest 20.
export async function fetchHimalayas(targets: string[] = []): Promise<RawJob[]> {
  const queries = targets.slice(0, 3);
  const pages = queries.length
    ? await Promise.all(queries.map((q) => getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}`)))
    : [await getJson('https://himalayas.app/jobs/api?limit=20')];
  return pages.flatMap((d) => d.jobs || []).map((j: any) => ({
    source: 'himalayas',
    sourceId: String(j.guid || j.applicationLink),
    sourceLabel: 'Himalayas',
    title: j.title,
    company: j.companyName,
    location: (j.locationRestrictions || []).join(', ') || 'Anywhere',
    remote: true,
    url: j.applicationLink,
    postedAt: ts(j.pubDate),
    salary: j.minSalary ? `${j.currency || ''} ${j.minSalary}${j.maxSalary ? `–${j.maxSalary}` : ''}`.trim() : undefined,
    tags: [...(j.categories || []), ...(j.seniority || [])].map((t: string) => String(t).toLowerCase()),
    snippet: j.excerpt || clip(j.description),
  }));
}

export async function fetchJobicy(): Promise<RawJob[]> {
  const data = await getJson('https://jobicy.com/api/v2/remote-jobs?count=100');
  return (data.jobs || []).map((j: any) => ({
    source: 'jobicy',
    sourceId: String(j.id),
    sourceLabel: 'Jobicy',
    title: htmlToText(String(j.jobTitle || '')),
    company: j.companyName,
    location: j.jobGeo || 'Remote',
    remote: true,
    url: j.url,
    postedAt: ts(j.pubDate),
    tags: [...(Array.isArray(j.jobIndustry) ? j.jobIndustry : []), j.jobLevel].filter(Boolean).map((t: string) => htmlToText(String(t)).toLowerCase()),
    snippet: j.jobExcerpt ? htmlToText(j.jobExcerpt) : clip(j.jobDescription),
  }));
}

export async function fetchArbeitnow(): Promise<RawJob[]> {
  const data = await getJson('https://www.arbeitnow.com/api/job-board-api');
  return (data.data || []).map((j: any) => ({
    source: 'arbeitnow',
    sourceId: j.slug,
    sourceLabel: 'Arbeitnow',
    title: j.title,
    company: j.company_name,
    location: j.location || (j.remote ? 'Remote' : ''),
    remote: Boolean(j.remote),
    url: j.url,
    postedAt: ts(j.created_at),
    tags: (j.tags || []).map((t: string) => t.toLowerCase()),
    snippet: clip(j.description),
  }));
}
