// Hacker News "Ask HN: Who is hiring?" — a monthly thread where companies (often small and
// under the radar) post roles directly. Read through the public Algolia HN API.
import type { RawJob } from './types';

const ROLE_WORDS =
  /engineer|developer|designer|scientist|analyst|manager|sre|devops|intern|frontend|front-end|backend|back-end|full[- ]?stack|ml|ai|researcher|architect|lead|swe|programmer|product|data/i;

export function decodeEntities(html: string): string {
  return html
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<(?:p|br|li|\/li|div|\/div|h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim();
}

/** Parses one top-level comment. Returns null when it isn't a job post. */
export function parseHnPost(comment: { id: number; text?: string | null; created_at_i?: number }): RawJob | null {
  if (!comment.text) return null;
  const firstHtml = comment.text.split('<p>')[0];
  const header = htmlToText(firstHtml);
  const parts = header.split(/\s+[|—–]\s+|\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const company = parts[0].replace(/\s*\(.*?\)\s*$/, '').slice(0, 80);
  const title = parts.slice(1).find((p) => ROLE_WORDS.test(p) && p.length < 140) || '';
  if (!title) return null;
  const location = parts
    .slice(1)
    .filter((p) => p !== title && !/https?:|www\.|\.\w{2,4}(\/|$)/i.test(p) && /remote|onsite|on-site|hybrid|[A-Z][a-z]+,\s?[A-Z]|india|bangalore|bengaluru|london|new york|sf|berlin/i.test(p))
    .join(' · ');
  const href = comment.text.match(/href="([^"]+)"/)?.[1];
  const hnUrl = `https://news.ycombinator.com/item?id=${comment.id}`;
  const body = htmlToText(comment.text);

  return {
    source: 'hn',
    sourceId: String(comment.id),
    sourceLabel: 'HN Who is hiring',
    sourceUrl: hnUrl,
    title,
    company,
    location: location || 'See post',
    remote: /remote/i.test(header),
    url: href ? decodeEntities(href) : hnUrl,
    postedAt: comment.created_at_i ? comment.created_at_i * 1000 : undefined,
    salary: header.match(/[$€£₹]\s?\d[\d,.]*\s?[kK]?(?:\s?(?:-|to|–)\s?[$€£₹]?\s?\d[\d,.]*\s?[kK]?)?/)?.[0],
    tags: [],
    snippet: body.slice(0, 600),
  };
}

export async function fetchHn(): Promise<RawJob[]> {
  const search = await fetch('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6');
  if (!search.ok) throw new Error(`HN search ${search.status}`);
  const story = (await search.json()).hits?.find((h: any) => /^Ask HN: Who is hiring\?/i.test(h.title));
  if (!story) return [];
  const res = await fetch(`https://hn.algolia.com/api/v1/items/${story.objectID}`);
  if (!res.ok) throw new Error(`HN thread ${res.status}`);
  const thread = await res.json();
  return (thread.children || []).map(parseHnPost).filter((j: RawJob | null): j is RawJob => j !== null);
}
