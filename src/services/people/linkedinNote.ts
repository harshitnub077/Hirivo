// LinkedIn connection notes. Free accounts allow 200 characters, so these are written to fit,
// in plain words, and only ever quote the user's own resume facts. The user presses Send.
import type { ResumeFact } from '../../db';
import type { Audience } from '../multiOutreach';
import { firstName } from '../proofWriter';

export const NOTE_LIMIT = 200;

const shortTitle = (t: string) => t.replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s*[-–|,].*$/, '').replace(/\s+/g, ' ').trim();
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9+#]+/g) || []);

// Past-tense verbs that don't end in -ed.
const IRREGULAR = /^(?:Built|Led|Cut|Won|Drove|Ran|Wrote|Made|Grew|Taught|Brought|Sold|Set|Held|Took|Began|Spoke|Found|Fought|Kept|Lent|Met|Rebuilt|Rewrote|Overhauled|Taught|Spun|Hit|Beat|Bought|Gave|Got|Saw|Shot|Stood|Wound)$/;

/** A resume fact in first person ("Built X" → "I built X."), or undefined when it doesn't read as an action. */
export function factSentence(f: Pick<ResumeFact, 'claim'>): string | undefined {
  const c = f.claim.trim().replace(/\s*\[FACT-\d+\]/g, '').replace(/[.;]+$/, '');
  const verb = c.split(/\s+/)[0];
  if (!/^[A-Z][a-z]{2,}ed$/.test(verb) && !IRREGULAR.test(verb)) return undefined;
  return `I ${c[0].toLowerCase()}${c.slice(1)}.`;
}

/** The fact most related to the job that fits in `room` characters. */
function pickFact(facts: ResumeFact[], jobText: string, room: number): string | undefined {
  const job = words(jobText);
  return facts
    .filter((f) => f.verified !== false && f.category !== 'EDUCATION')
    .map((f) => ({ s: factSentence(f), overlap: [...words(f.claim)].filter((w) => job.has(w)).length, metric: f.category === 'METRIC' ? 1 : 0 }))
    .filter((x): x is { s: string; overlap: number; metric: number } => !!x.s && x.s.length <= room)
    .sort((a, b) => b.overlap - a.overlap || b.metric - a.metric || a.s.length - b.s.length)[0]?.s;
}

const OPEN: Record<Audience, (role: string, company: string) => string> = {
  connection: (role, company) => `I'm applying for the ${role} role at ${company}.`,
  'hiring-manager': (role, company) => `I'm applying for the ${role} role on your team at ${company}.`,
  recruiter: (role, company) => `I've applied for the ${role} role at ${company}.`,
  founder: (role, company) => `I'm applying for the ${role} role at ${company}.`,
  leader: (role, company) => `I'm applying for the ${role} role at ${company}.`,
  team: (role, company) => `I'm applying for the ${role} role at ${company} and would value your view of the team.`,
  inbox: (role, company) => `I'm applying for the ${role} role at ${company}.`,
};
const ASK: Record<Audience, string> = {
  connection: 'Would you be open to referring me?',
  'hiring-manager': 'Would you be open to connecting?',
  recruiter: 'Happy to share my resume. Open to connecting?',
  founder: 'Would love to connect.',
  leader: 'Would you be open to connecting?',
  team: 'Open to connecting?',
  inbox: 'Would you be open to connecting?',
};

export function linkedInNote(input: { name: string; audience: Audience; company: string; jobTitle: string; facts: ResumeFact[]; jobText?: string }): string {
  const hi = firstName(input.name) ? `Hi ${firstName(input.name)},` : 'Hi,';
  for (const role of [input.jobTitle.trim(), shortTitle(input.jobTitle)]) {
    const base = [hi, OPEN[input.audience](role, input.company), ASK[input.audience]];
    const room = NOTE_LIMIT - base.join(' ').length - 1;
    const fact = pickFact(input.facts, `${input.jobTitle} ${input.jobText || ''}`, room);
    const note = (fact ? [base[0], base[1], fact, base[2]] : base).join(' ');
    if (note.length <= NOTE_LIMIT) return note;
  }
  return `${hi} I'm applying for the ${shortTitle(input.jobTitle)} role at ${input.company}. ${ASK[input.audience]}`.slice(0, NOTE_LIMIT);
}
