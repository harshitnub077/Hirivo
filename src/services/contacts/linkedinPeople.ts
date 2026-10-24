// People on a LinkedIn page the user has open and asked Hirivo to read (a people search, or a
// company's People tab). Read once, on the user's click, from what is already on screen; Hirivo
// never browses, scrolls or clicks on LinkedIn. LinkedIn's class names change often, so this reads
// the visible text of each card instead: name first, then the headline.
import { cityOf } from '../discover/geo';
import { roleIsElsewhere, type TeamPerson } from './teamPage';

const NOISE = /^(?:view .*profile|•|·|\d+(?:st|nd|rd|th)\+?|(?:1st|2nd|3rd)(?:\+)? degree connection|connect|message|follow|following|pending|status is \w+|current:|past:|summary:|skills:|mutual connections?|.*mutual connections?|.*followers?|linkedin member|premium|open to work|hiring|provides services|send inmail|more|…|\.\.\.)$/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function leafLines(el: Element): string[] {
  const out: string[] = [];
  for (const node of Array.from(el.querySelectorAll('*'))) {
    if (node.children.length || /^(script|style|svg|path|noscript|img|button)$/i.test(node.tagName)) continue;
    if (node.closest('button, .visually-hidden, [class*="visually-hidden"]')) continue;
    const t = (node.textContent || '').replace(/\s+/g, ' ').replace(/^[•·]\s*/, '').trim();
    if (t && t.length <= 160 && !NOISE.test(t) && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

const cleanName = (s: string) => s.replace(/\(.*?\)|,.*$|\b(?:she|he|they)\/\w+\b/gi, '').replace(/[^\p{L}\p{M}' .-]/gu, ' ').replace(/\s+/g, ' ').trim();
const looksLikeName = (s: string) => {
  const n = cleanName(s);
  const words = n.split(' ');
  return words.length >= 2 && words.length <= 5 && words.every((w) => /^\p{Lu}/u.test(w) || /^(?:de|da|van|von|bin|al)$/.test(w)) && n.length <= 50;
};

export function linkedInProfileUrl(href: string): string | undefined {
  const m = href.match(/linkedin\.com\/in\/([^/?#]+)/) || href.match(/^\/in\/([^/?#]+)/);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1])}/` : undefined;
}

/** The people on the page who work at `company`, with their headline and profile link. */
export function parseLinkedInPeople(doc: Document, company: string, pageUrl: string): TeamPerson[] {
  const companyPage = /linkedin\.com\/company\/[^/]+\/people/.test(pageUrl);
  const own = norm(company);
  const people = new Map<string, TeamPerson>();
  for (const a of Array.from(doc.querySelectorAll('a[href*="/in/"]'))) {
    const profileUrl = linkedInProfileUrl(a.getAttribute('href') || '');
    if (!profileUrl || people.has(profileUrl)) continue;
    const card = a.closest('li') || a.parentElement?.parentElement?.parentElement;
    if (!card) continue;
    const lines = leafLines(card);
    const nameAt = lines.findIndex(looksLikeName);
    if (nameAt < 0) continue;
    const name = cleanName(lines[nameAt]);
    const rest = lines.slice(nameAt + 1).filter((l) => cleanName(l) !== name);
    const headline = rest.find((l) => !(cityOf(l) && l.split(/\s+/).length <= 5)) || '';
    // "Past: Recruiter at Razorpay" is someone who left.
    const mentionsCompany = own.length >= 2 && rest.some((l) => !/^past:/i.test(l) && norm(l).includes(own));
    if (!companyPage && !mentionsCompany) continue; // a search result for someone at another company
    const org = headline.match(/(?:\bat|@)\s+([^|,]+)$/)?.[1];
    if (headline && (roleIsElsewhere(headline, company) || (org && !norm(org).includes(own) && !own.includes(norm(org))))) continue;
    people.set(profileUrl, { name, role: headline.replace(/\s+at\s+[^|]+$/i, (m) => (norm(m).includes(own) ? '' : m)).trim(), profileUrl, page: 'LinkedIn' });
  }
  return [...people.values()];
}

/** A LinkedIn people search the user opens themselves (signed in as usual), then asks Hirivo to read. */
export function linkedInPeopleSearchUrl(company: string): string {
  const keywords = `"${company}" (recruiter OR "talent acquisition" OR HR OR founder OR "engineering manager" OR "hiring manager")`;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}&origin=GLOBAL_SEARCH_HEADER`;
}
