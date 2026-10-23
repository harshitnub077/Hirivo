// The contact ladder: who to message for a job, best first, and why.
//   1. People you know there (your LinkedIn export)
//   2. Alumni of your college (tagged when your export includes schools; otherwise a search you run)
//   3. People on the company's own site, ranked by how close they are to the hiring decision
//   4. Engineers in the company's public GitHub org
//   5. The careers inbox
// Business emails only. Guessed addresses are always labelled as guesses.
import type { LinkedInConnection } from '../db';
import { generateEmailPermutations } from './contactInference';
import type { SiteLookup } from './contacts/siteLookup';

export type EmailStatus = 'listed' | 'from-export' | 'guessed';

export interface LadderContact {
  id: string;
  tier: 1 | 2 | 3 | 4 | 5;
  name: string;
  role?: string;
  why: string;
  email?: string;
  emailStatus?: EmailStatus;
  profileUrl?: string;
  contactType: 'WARM_CONNECTION' | 'ALUMNI' | 'COLD_HIRING_MGR';
  relevance: number;
}

export const TIER_LABELS: Record<LadderContact['tier'], string> = {
  1: 'People you know',
  2: 'Alumni',
  3: 'On their website',
  4: 'Engineers on GitHub',
  5: 'Careers inbox',
};

type Family = 'engineering' | 'design' | 'product' | 'data' | 'sales' | 'marketing' | 'other';

export function jobFamily(title: string): Family {
  const t = title.toLowerCase();
  if (/data (?:scien|analy|engineer)|machine learning|\bml\b|analytics|\bai\b/.test(t)) return 'data';
  if (/design|ux|ui\b/.test(t)) return 'design';
  if (/product manager|\bpm\b|product owner/.test(t)) return 'product';
  if (/engineer|developer|sde|swe|devops|sre|frontend|backend|full ?stack|mobile|android|ios|qa|test/.test(t)) return 'engineering';
  if (/sales|account exec|business development|bdr|sdr/.test(t)) return 'sales';
  if (/marketing|growth|content|seo/.test(t)) return 'marketing';
  return 'other';
}

const FAMILY_WORDS: Record<Family, RegExp> = {
  engineering: /engineer|technolog|tech lead|cto|platform|infrastructure|developer|architect/i,
  design: /design|ux|creative/i,
  product: /product|cpo/i,
  data: /data|analytics|machine learning|\bml\b|\bai\b|scien/i,
  sales: /sales|revenue|business development|account/i,
  marketing: /marketing|growth|brand|content|cmo/i,
  other: /$^/,
};

/** 0–100: how close someone with this role is to hiring for this job. Exported for tests. */
export function roleRelevance(role: string, jobTitle: string): { score: number; label: string } {
  const r = role.toLowerCase();
  const family = jobFamily(jobTitle);
  const inFamily = FAMILY_WORDS[family].test(role);
  const leader = /\b(head of|vp|vice president|director|manager|lead|chief|cto|cpo|cmo)\b/.test(r);
  if (leader && inFamily) return { score: 100, label: 'Likely hiring manager' };
  if (/recruit|talent|people (?:ops|partner)|\bhr\b|human resources/.test(r)) return { score: 85, label: 'Recruiter' };
  if (/founder|\bceo\b/.test(r)) return { score: 70, label: 'Founder' };
  if (/\b(head of|vp|vice president|director|chief|cto|cpo|cmo)\b/.test(r)) return { score: 50, label: 'Leadership' };
  if (inFamily) return { score: 45, label: 'On the team' };
  if (leader) return { score: 25, label: 'At the company' }; // an office manager won't hire an engineer
  return { score: 20, label: 'At the company' };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function companyMatches(connectionCompany: string, company: string): boolean {
  const a = norm(connectionCompany);
  const b = norm(company);
  if (!a || !b || a.length < 2 || b.length < 2) return false;
  return a === b || a.includes(b) || (b.includes(a) && a.length >= 4);
}

export interface LadderInput {
  jobTitle: string;
  company: string;
  domain?: string;
  college?: string;
  connections: LinkedInConnection[];
  lookup?: SiteLookup;
  domainHasMx?: boolean;
}

export function buildLadder(input: LadderInput): LadderContact[] {
  const out: LadderContact[] = [];
  const college = input.college ? norm(input.college) : '';

  for (const c of input.connections.filter((c) => companyMatches(c.company, input.company))) {
    const sharedSchool = college && c.school && norm(c.school).includes(college);
    out.push({
      id: `conn:${c.id}`,
      tier: 1,
      name: c.fullName,
      role: c.position,
      why: `You're connected on LinkedIn${c.connectedOn ? ` since ${c.connectedOn}` : ''}${sharedSchool ? `, and you both went to ${input.college}` : ''}. A referral from them beats any cold email.`,
      email: c.email || undefined,
      emailStatus: c.email ? 'from-export' : undefined,
      profileUrl: c.url,
      contactType: 'WARM_CONNECTION',
      relevance: roleRelevance(c.position || '', input.jobTitle).score + (sharedSchool ? 10 : 0),
    });
  }

  const people = input.lookup?.people || [];
  for (const p of people) {
    const rel = p.role ? roleRelevance(p.role, input.jobTitle) : { score: 30, label: 'At the company' };
    const listed = p.email;
    const guess = !listed && input.domain ? generateEmailPermutations(p.name, input.domain)[0]?.email : undefined;
    out.push({
      id: `site:${p.name}`,
      tier: 3,
      name: p.name,
      role: p.role || undefined,
      why: `${rel.label}${p.role ? `: ${p.role}` : ''}. Listed on ${input.domain}${p.page === '/' ? '' : p.page}.`,
      email: listed || guess,
      emailStatus: listed ? 'listed' : guess ? 'guessed' : undefined,
      profileUrl: p.profileUrl,
      contactType: 'COLD_HIRING_MGR',
      relevance: rel.score,
    });
  }

  for (const m of input.lookup?.githubMembers || []) {
    out.push({
      id: `gh:${m.login}`,
      tier: 4,
      name: m.name || m.login,
      role: `@${m.login} on GitHub`,
      why: `Public member of github.com/${input.lookup!.githubOrg}. An engineer who can tell you about the team; reach out through their GitHub profile.`,
      profileUrl: m.profileUrl,
      contactType: 'COLD_HIRING_MGR',
      relevance: m.name ? 20 : 10,
    });
  }

  if (input.domain) {
    const listed = input.lookup?.inboxes[0];
    const email = listed || (input.domainHasMx !== false ? `careers@${input.domain}` : undefined);
    if (email) {
      out.push({
        id: `inbox:${email}`,
        tier: 5,
        name: 'Hiring team',
        role: email,
        why: listed ? `${email} is listed on their website.` : `A common hiring inbox, guessed; ${input.domain} does receive email.`,
        email,
        emailStatus: listed ? 'listed' : 'guessed',
        contactType: 'COLD_HIRING_MGR',
        relevance: 0,
      });
    }
  }

  return out.sort((a, b) => a.tier - b.tier || b.relevance - a.relevance);
}

/** A Google search for alumni at the company; the user runs it, Hirivo never scrapes LinkedIn. */
export function alumniSearchUrl(company: string, college: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${company}" "${college}"`)}`;
}
