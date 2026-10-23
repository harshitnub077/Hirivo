// Finds people on a company's own about/team pages. JSON-LD Person data first (most reliable),
// then a careful card heuristic. Investors and advisors are filtered out: someone listed as
// "Director at GitHub" on a startup's about page is a backer, not your hiring manager.

export interface TeamPerson {
  name: string;
  role: string; // '' when the page lists the person without a title
  email?: string; // only when the page itself lists it
  profileUrl?: string;
  page: string; // where we found them
}

export interface PageScan {
  people: TeamPerson[];
  inboxes: string[]; // generic hiring inboxes listed on the page (careers@, jobs@…)
  githubOrg?: string;
  feedUrl?: string;
}

const ROLE = /\b(?:co-?founder|founder|ceo|cto|coo|cfo|cpo|chief [a-z]+ officer|vp|vice president|head of|director|manager|lead|principal|staff|engineer|developer|designer|scientist|recruit\w*|talent|people (?:ops|partner|team)|hr\b|human resources|product|marketing|sales|growth|operations|president|partner|architect)\b/i;
const NOT_A_NAME = /\b(?:our|team|about|careers?|jobs?|join|read|learn|more|meet|the|company|leadership|contact|blog|press|news|privacy|terms|cookie|sign|log|get|start|book|demo|pricing|product|solutions?|resources?|customers?|investors?|backed|advisors?|board)\b/i;
const NAME = /^[A-Z][a-zA-Z'’.-]+(?:\s+(?:[A-Z][a-zA-Z'’.-]+|de|da|van|von|bin|al)){1,3}$/;
// Sections whose people are not staff: investors, advisors, customers quoted in testimonials.
const BACKER_HEADING = /\binvest|backer|backed by|advisor|angel|board of|our partners|supported by|funded by|customer|testimonial|what (?:our|people|they)|trusted by|loved by|stories|case stud|reviews?\b/i;
const NON_STAFF_CLASS = /testimonial|quote|review|story|stories|case-?stud|customer|logo|press|investor|backer|advisor|partner/i;
const INBOX = /^(?:careers?|jobs?|hiring|talent|recruit(?:ing|ment)?|hr|people|work|joinus|join)@/i;
const GITHUB_SKIP = new Set(['features', 'sponsors', 'about', 'pricing', 'enterprise', 'login', 'join', 'orgs', 'topics', 'marketplace', 'apps', 'site', 'contact', 'security']);

export const isPersonName = (s: string, company = '') => {
  const t = s.trim();
  if (!NAME.test(t) || NOT_A_NAME.test(t) || ROLE.test(t) || t.length > 40) return false;
  const words = t.split(/\s+/);
  if (/ing$/i.test(words[0])) return false; // "Launching Atlan AI", "Introducing …"
  if (words.some((w) => /^[A-Z]{2,}$/.test(w))) return false; // acronyms: "AI", "API"
  if (company && words.some((w) => w.toLowerCase() === company.toLowerCase())) return false;
  return true;
};

/** A role that names a different organisation ("Founder of Langbase") describes someone else's job. */
const DEPARTMENT = /^(?:engineering|product|design|data|analytics|strategy|marketing|sales|growth|operations|ops|finance|people|talent|hr|ai|ml|platform|security|infrastructure|research|partnerships|customer success|support|legal|brand|community|enterprise|india|apac|emea|americas|global|asia)(?:\s*(?:&|and)\s*\w+)?$/i;

/** A role that names a different organisation ("Founder of Langbase", "VP Data, Fox") is someone else's job. */
export function roleIsElsewhere(role: string, company: string): boolean {
  const own = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  const other = (org: string) => {
    const o = org.toLowerCase().replace(/[^a-z0-9]/g, '');
    return Boolean(o) && !(o.includes(own) || own.includes(o));
  };
  const m = role.match(/\b(?:at|of|@)\s+([A-Z][\w&.'’ -]{1,40})$/);
  if (m && !DEPARTMENT.test(m[1].trim())) return other(m[1]);
  const parts = role.split(',').map((p) => p.trim());
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/^[A-Z]/.test(last) && last.split(/\s+/).length <= 4 && !ROLE.test(last) && !DEPARTMENT.test(last)) return other(last);
  }
  return false;
}

function leafTexts(el: Element): string[] {
  const out: string[] = [];
  for (const node of Array.from(el.querySelectorAll('*'))) {
    if (node.children.length === 0 && !/^(script|style|svg|path|noscript)$/i.test(node.tagName)) {
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length <= 120) out.push(t);
    }
  }
  return out;
}

function underBackerHeading(el: Element): boolean {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    if (NON_STAFF_CLASS.test(`${node.getAttribute('class') || ''} ${node.id || ''}`)) return true;
    // A card that carries a quoted statement is a testimonial.
    if (depth <= 3 && /^[“"«]/.test((node.textContent || '').trim())) return true;
    const heading = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4');
    if (heading && BACKER_HEADING.test(heading.textContent || '')) return true;
    let sib = node.previousElementSibling;
    for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
      if (/^H[1-4]$/.test(sib.tagName) && BACKER_HEADING.test(sib.textContent || '')) return true;
    }
  }
  return false;
}

function jsonLdPeople(doc: Document, company: string, page: string): TeamPerson[] {
  const people: TeamPerson[] = [];
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent || '');
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const item = queue.shift();
      if (Array.isArray(item)) queue.push(...item);
      else if (item && typeof item === 'object') {
        const o = item as Record<string, any>;
        if (o['@type'] === 'Person' && typeof o.name === 'string' && isPersonName(o.name, company)) {
          const role = typeof o.jobTitle === 'string' ? o.jobTitle : '';
          const worksFor = typeof o.worksFor?.name === 'string' ? o.worksFor.name : '';
          if (!(worksFor && roleIsElsewhere(`at ${worksFor}`, company)) && !roleIsElsewhere(role, company)) {
            people.push({ name: o.name.trim(), role, profileUrl: typeof o.url === 'string' ? o.url : undefined, page });
          }
        }
        for (const v of Object.values(o)) if (v && typeof v === 'object') queue.push(v);
      }
    }
  }
  return people;
}

export function scanPage(doc: Document, company: string, domain: string, page: string): PageScan {
  const people = jsonLdPeople(doc, company, page);
  const seen = new Set(people.map((p) => p.name.toLowerCase()));

  // Card heuristic: a small block with a name line and a role line. Not on the homepage,
  // where named people are almost always customers, investors or authors rather than staff.
  const cards = page === '/' ? [] : Array.from(doc.querySelectorAll('li, article, figure, div, a'));
  for (const el of cards) {
    if (people.length >= 40) break;
    if (el.querySelectorAll('*').length > 40) continue;
    const lines = leafTexts(el);
    if (lines.length < 2 || lines.length > 6) continue;
    const name = lines.find((l) => isPersonName(l, company));
    if (!name || seen.has(name.toLowerCase())) continue;
    const role = lines.find((l) => l !== name && ROLE.test(l) && l.length <= 80) || '';
    if (!role || roleIsElsewhere(role, company) || underBackerHeading(el)) continue;
    const mail = el.querySelector('a[href^="mailto:"]')?.getAttribute('href')?.slice(7).split('?')[0];
    const link = Array.from(el.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href') || '')
      .find((h) => /linkedin\.com\/in\/|twitter\.com\/|x\.com\/|github\.com\//.test(h));
    seen.add(name.toLowerCase());
    people.push({ name, role, email: mail && mail.endsWith(`@${domain}`) ? mail : undefined, profileUrl: link, page });
  }

  const inboxes = Array.from(
    new Set(
      Array.from(doc.querySelectorAll('a[href^="mailto:"]'))
        .map((a) => (a.getAttribute('href') || '').slice(7).split('?')[0].toLowerCase())
        .filter((e) => INBOX.test(e) && e.endsWith(`@${domain}`))
    )
  );

  const githubOrg = Array.from(doc.querySelectorAll('a[href*="github.com/"]'))
    .map((a) => (a.getAttribute('href') || '').match(/github\.com\/([A-Za-z0-9-]+)\/?(?:$|[?#])/)?.[1])
    .find((org): org is string => Boolean(org) && !GITHUB_SKIP.has(org!.toLowerCase()));

  const feed = doc.querySelector('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]')?.getAttribute('href') || undefined;

  return { people, inboxes, githubOrg, feedUrl: feed };
}
