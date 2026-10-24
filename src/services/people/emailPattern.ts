// Learns a company's email format from real addresses, so Hirivo can write to people whose address
// isn't listed. A format counts as confirmed only when a real (name, address) pair at the domain
// proves it, no other pair contradicts it, and the domain receives mail. Anything less stays a guess.

export interface EmailEvidence {
  name: string;
  email: string;
  source: 'site' | 'export' | 'github';
}

export interface LearnedPattern {
  id: PatternId;
  label: string; // "first.last@notion.com"
  domain: string;
  support: EmailEvidence[]; // the pairs that prove it
}

type Parts = { first: string; last: string };
const FORMATS = {
  'first.last': (p: Parts) => p.last && `${p.first}.${p.last}`,
  first: (p: Parts) => p.first,
  flast: (p: Parts) => p.last && `${p.first[0]}${p.last}`,
  firstlast: (p: Parts) => p.last && `${p.first}${p.last}`,
  first_last: (p: Parts) => p.last && `${p.first}_${p.last}`,
  'f.last': (p: Parts) => p.last && `${p.first[0]}.${p.last}`,
  firstl: (p: Parts) => p.last && `${p.first}${p.last[0]}`,
  'first.l': (p: Parts) => p.last && `${p.first}.${p.last[0]}`,
  'last.first': (p: Parts) => p.last && `${p.last}.${p.first}`,
  last: (p: Parts) => p.last,
} satisfies Record<string, (p: Parts) => string>;
export type PatternId = keyof typeof FORMATS;
// When the evidence fits several formats equally, the more common one wins.
const PRIOR = Object.keys(FORMATS) as PatternId[];

// Shared inboxes and role addresses say nothing about how people's addresses look.
const ROLE_LOCAL = /^(?:info|hello|hi|contact|support|help|careers?|jobs?|hiring|hr|talent|recruit\w*|people|team|admin|sales|press|media|marketing|legal|privacy|security|billing|accounts?|office|noreply|no-reply|notifications?|dev|engineering|founders?|ceo)$/;

export function nameParts(fullName: string): Parts | null {
  const words = fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)|,.*$/g, ' ') // "Priya Sharma (she/her)", "Priya Sharma, PHR"
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z]/g, ''))
    .filter((w) => w && !/^(?:dr|mr|mrs|ms|prof|sir|shri|smt|jr|sr)$/.test(w));
  if (!words.length || words[0].length < 2) return null;
  return { first: words[0], last: words.length > 1 ? words[words.length - 1] : '' };
}

const bare = (d: string) => d.toLowerCase().replace(/^www\./, '');
const atDomain = (email: string, domain: string) => {
  const host = email.toLowerCase().split('@')[1] || '';
  const d = bare(domain);
  return host === d || host.endsWith(`.${d}`);
};

/** The formats a real address fits (several when the name is short or ambiguous). */
export function formatsOf(name: string, email: string): PatternId[] {
  const parts = nameParts(name);
  const local = email.toLowerCase().split('@')[0].replace(/\+.*$/, '');
  if (!parts || !local || ROLE_LOCAL.test(local)) return [];
  return PRIOR.filter((id) => FORMATS[id](parts) === local);
}

/**
 * The format every informative pair agrees on, or undefined. A pair that fits no format (a
 * nickname, an old address) neither proves nor contradicts anything.
 */
export function learnPattern(evidence: EmailEvidence[], domain: string, { hasMx }: { hasMx?: boolean }): LearnedPattern | undefined {
  if (hasMx !== true) return undefined;
  const seen = new Set<string>();
  const informative = evidence
    .filter((e) => atDomain(e.email, domain) && !seen.has(e.email.toLowerCase()) && seen.add(e.email.toLowerCase()))
    .map((e) => ({ e, fits: formatsOf(e.name, e.email) }))
    .filter((x) => x.fits.length);
  if (!informative.length) return undefined;
  const agreed = PRIOR.filter((id) => informative.every((x) => x.fits.includes(id)));
  if (!agreed.length) return undefined; // the pairs disagree: no format is proven
  const id = agreed[0];
  return { id, label: `${id}@${bare(domain)}`, domain: bare(domain), support: informative.map((x) => x.e) };
}

/** Someone's address in a learned format, or undefined when their name can't fill it. */
export function applyPattern(pattern: LearnedPattern, name: string): string | undefined {
  const parts = nameParts(name);
  const local = parts ? FORMATS[pattern.id](parts) : '';
  return local ? `${local}@${pattern.domain}` : undefined;
}

/** "first.last@acme.com, seen in priya.shah@acme.com and 2 more". */
export function patternProof(p: LearnedPattern): string {
  const [one, ...rest] = p.support;
  return `${p.label}, seen in ${one.email}${rest.length ? ` and ${rest.length} more` : ''}`;
}
