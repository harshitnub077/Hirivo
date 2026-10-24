// Resume import: read a PDF, DOCX or text file, pull out contact details without AI,
// then (if a key is set) let the model structure facts, skills and role suggestions.
// Every fact the model returns must be traceable to the resume text, or it is dropped.
import { isGenericTarget } from './targets';
import { unzipSync, strFromU8 } from 'fflate';
import { db, ResumeFact, UserSettings } from '../db';
import { getSettings, patchSettings } from '../db/settings';
import { routeLLMRequest } from '../llm/router';
import { parseJsonLoose } from '../llm/json';

export interface ContactInfo {
  fullName?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
}

export interface SuggestedRole {
  title: string;
  keywords: string[];
  level: 'intern' | 'entry' | 'mid' | 'senior';
  why: string;
}

export interface ResumeProfile extends ContactInfo {
  location?: string;
  country?: string;
  college?: string;
  degree?: string;
  graduationYear?: string;
  currentCompany?: string;
  currentTitle?: string;
  yearsExperience?: number;
  skills: string[];
  facts: ResumeFact[];
  roles: SuggestedRole[];
  usedAI: boolean;
}

// ---------- File reading ----------

export async function readResumeFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return readPdf(await file.arrayBuffer());
  if (name.endsWith('.docx')) return readDocx(new Uint8Array(await file.arrayBuffer()));
  if (/\.(txt|md|text)$/.test(name) || file.type.startsWith('text/')) return file.text();
  throw new Error('Use a PDF, DOCX or TXT file. Old .doc files: open in Word or Google Docs and save as PDF.');
}

async function readPdf(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      } else if (item.str && !item.str.endsWith(' ')) line += ' ';
    }
    if (line) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n'));
  }
  const text = pages.join('\n').trim();
  if (text.length < 80) throw new Error('This PDF has almost no text (it may be a scanned image). Export it from Word or Google Docs as a text PDF.');
  return text;
}

export function readDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('This DOCX file has no document body.');
  return strFromU8(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

// ---------- Deterministic extraction (works without AI) ----------

export function extractContactInfo(text: string): ContactInfo {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = text
    .match(/\+?\(?\d[\d\s().-]{8,16}\d/g)
    ?.map((p) => p.trim())
    .find((p) => p.replace(/\D/g, '').length >= 10 && p.replace(/\D/g, '').length <= 13 && !/\d{4}\s*[-–]\s*\d{4}/.test(p));
  const url = (re: RegExp) => {
    const m = text.match(re)?.[0];
    return m ? (m.startsWith('http') ? m : `https://${m}`).replace(/[).,;]+$/, '') : undefined;
  };
  const linkedinUrl = url(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i);
  const githubUrl = url(/(?:https?:\/\/)?github\.com\/[A-Za-z0-9_-]+\/?(?![A-Za-z0-9_/-])/i);
  // Remove emails first so "name.me@gmail.com" is never read as the site "name.me".
  const withoutEmails = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
  // Lowercase hosts of 3+ characters only, so degrees like "B.Tech" or "M.Sc" never look like sites.
  const portfolioUrl = (withoutEmails.match(/(?:https?:\/\/)?(?:www\.)?(?<![\w.])[a-z0-9-]{3,}\.(?:dev|me|io|in|app|tech|site|xyz|vercel\.app|netlify\.app|github\.io)(?![\w])(?:\/[^\s]*)?/g) || [])
    .map((u) => (u.startsWith('http') ? u : `https://${u}`))
    .find((u) => !/linkedin|github\.com|gmail|outlook|yahoo/i.test(u) && !(email && u.includes(email.split('@')[1])));

  const fullName = text
    .split('\n')
    .slice(0, 5)
    .map((l) => l.trim())
    .find((l) => /^[A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(l) && !/resume|curriculum|vitae|profile/i.test(l));

  return { fullName, email, phone, linkedinUrl, githubUrl, portfolioUrl };
}

const COLLEGE = /\b(IIT|IIIT|NIT|BITS|IIM|VIT|SRM|DTU|NSUT|[A-Z][\w.&' -]*(?:University|College|Institute|Vidyalaya|Polytechnic)(?: of [A-Z][\w ]+)?)\b[\w ,.'&-]*/;

/** Finds the college line ("B.Tech, IIT Delhi" → "IIT Delhi"). */
export function extractCollege(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const m = line.match(COLLEGE);
    if (m) {
      return m[0]
        .replace(/\s*[,|·(].*$/, '')
        .replace(/\s+\d{4}.*$/, '')
        .trim() || undefined;
    }
  }
  return undefined;
}

const ACTION_VERB =
  /\b(built|led|designed|reduced|increased|developed|improved|managed|scaled|architected|implemented|created|engineered|launched|shipped|grew|cut|saved|won|automated|migrated|mentored|optimi[sz]ed|deployed|trained|analy[sz]ed)\b/i;

export function extractFactsHeuristic(text: string): ResumeFact[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*▪◦●➢►]\s*/, '').trim())
    .filter((l) => l.length > 25 && l.length < 320);
  const bullets = lines.filter((l) => ACTION_VERB.test(l));
  return (bullets.length ? bullets : lines).slice(0, 20).map((claim, i) => ({
    id: `FACT-${String(i + 1).padStart(2, '0')}`,
    category: /\d/.test(claim) ? 'METRIC' : 'PROJECT',
    claim,
    sourceSnippet: claim,
    verified: true,
  }));
}

const SKILL_WORDS = [
  'javascript', 'typescript', 'react', 'next.js', 'node.js', 'express', 'vue', 'angular', 'html', 'css', 'tailwind',
  'python', 'django', 'flask', 'fastapi', 'java', 'spring', 'kotlin', 'swift', 'go', 'golang', 'rust', 'c++', 'c#', '.net',
  'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'kafka', 'graphql', 'docker', 'kubernetes', 'aws', 'gcp', 'azure',
  'terraform', 'linux', 'git', 'machine learning', 'deep learning', 'pytorch', 'tensorflow', 'pandas', 'numpy', 'nlp',
  'llm', 'data analysis', 'power bi', 'tableau', 'excel', 'figma', 'flutter', 'react native', 'android', 'ios', 'selenium',
];

export function extractSkillsHeuristic(text: string): string[] {
  const lower = text.toLowerCase();
  return SKILL_WORDS.filter((s) => new RegExp(`(^|[^a-z])${s.replace(/[.+#]/g, '\\$&')}([^a-z]|$)`).test(lower));
}

const ROLE_RULES: { title: string; keywords: string[]; when: string[] }[] = [
  { title: 'Frontend Engineer', keywords: ['frontend', 'front end', 'react', 'ui engineer'], when: ['react', 'vue', 'angular', 'css', 'next.js'] },
  { title: 'Full Stack Engineer', keywords: ['full stack', 'fullstack', 'software engineer'], when: ['node.js', 'express', 'django', 'next.js'] },
  { title: 'Backend Engineer', keywords: ['backend', 'back end', 'sde', 'software engineer'], when: ['java', 'spring', 'go', 'golang', 'python', 'kafka', 'postgresql'] },
  { title: 'Data Analyst', keywords: ['data analyst', 'business analyst', 'analytics'], when: ['power bi', 'tableau', 'excel', 'sql', 'pandas'] },
  { title: 'ML Engineer', keywords: ['machine learning', 'ml engineer', 'ai engineer', 'data scientist'], when: ['pytorch', 'tensorflow', 'machine learning', 'deep learning', 'llm', 'nlp'] },
  { title: 'Mobile Developer', keywords: ['android', 'ios', 'mobile', 'flutter', 'react native'], when: ['flutter', 'android', 'ios', 'swift', 'kotlin', 'react native'] },
  { title: 'DevOps Engineer', keywords: ['devops', 'sre', 'platform engineer', 'cloud engineer'], when: ['docker', 'kubernetes', 'terraform', 'aws', 'gcp', 'azure'] },
  { title: 'QA / Test Engineer', keywords: ['qa', 'test engineer', 'sdet', 'quality'], when: ['selenium'] },
];

export function suggestRolesHeuristic(skills: string[], yearsExperience = 0): SuggestedRole[] {
  const level: SuggestedRole['level'] = yearsExperience >= 5 ? 'senior' : yearsExperience >= 2 ? 'mid' : yearsExperience >= 0.5 ? 'entry' : 'entry';
  return ROLE_RULES.map((r) => ({ r, hits: r.when.filter((w) => skills.includes(w)) }))
    .filter((x) => x.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length)
    .slice(0, 4)
    .map(({ r, hits }) => ({ title: r.title, keywords: r.keywords, level, why: `Your resume mentions ${hits.slice(0, 3).join(', ')}.` }));
}

// ---------- Hallucination guard ----------

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9%+#.]{3,}/g) || []).map((w) => w.replace(/\.$/, ''));

/** True when most of the claim's words appear in the source text (default: 80% of them). */
export function isTraceable(claim: string, sourceText: string, minShare = 0.8, minWords = 3): boolean {
  const pool = new Set(words(sourceText));
  const claimWords = words(claim);
  if (claimWords.length < minWords) return false;
  const found = claimWords.filter((w) => pool.has(w)).length;
  return found / claimWords.length >= minShare;
}

// ---------- AI structuring ----------

async function structureWithAI(text: string): Promise<Omit<ResumeProfile, 'usedAI'> | null> {
  const res = await routeLLMRequest({
    taskType: 'fit_analysis',
    jsonMode: true,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You turn a resume into JSON for a job-search tool. Copy text; never invent.
Return ONLY this JSON:
{
 "fullName": string|null, "location": string|null (city), "country": string|null, "college": string|null, "degree": string|null (as written, e.g. "B.Tech, Computer Science"), "graduationYear": string|null (4 digits),
 "currentCompany": string|null (most recent employer, null if a student), "currentTitle": string|null (most recent job title), "yearsExperience": number,
 "skills": string[] (max 25, lowercase, only ones written in the resume),
 "facts": [{"claim": string, "category": "METRIC"|"PROJECT"|"ROLE"|"SKILL"|"EDUCATION"}] (8-20 strongest achievement lines, copied nearly word for word, keep numbers exactly),
 "roles": [{"title": string, "keywords": string[] (2-4 lowercase phrases of 1-3 words that appear in matching job titles, like "backend" or "site reliability"; never a lone generic word such as "engineer", "senior" or "developer", and never a phrase split into single words), "level": "intern"|"entry"|"mid"|"senior", "why": string (one short sentence citing the resume)}] (3-5 realistic roles for this person right now)
}
yearsExperience counts paid work and internships only (internships count as a quarter). Students with no work: 0.`,
      },
      { role: 'user', content: text.slice(0, 9000) },
    ],
  });
  const p = parseJsonLoose<any>(res.content);
  const facts: ResumeFact[] = (Array.isArray(p.facts) ? p.facts : [])
    .filter((f: any) => typeof f?.claim === 'string' && isTraceable(f.claim, text))
    .slice(0, 20)
    .map((f: any, i: number) => ({
      id: `FACT-${String(i + 1).padStart(2, '0')}`,
      category: ['METRIC', 'PROJECT', 'ROLE', 'SKILL', 'EDUCATION'].includes(f.category) ? f.category : 'PROJECT',
      claim: f.claim.trim(),
      sourceSnippet: f.claim.trim(),
      verified: true,
    }));
  const lowerText = text.toLowerCase();
  // Short details are kept only when they appear in the resume as written.
  const copied = (v: unknown) => (typeof v === 'string' && v.trim() && lowerText.includes(v.trim().toLowerCase()) ? v.trim() : undefined);
  return {
    fullName: typeof p.fullName === 'string' ? p.fullName : undefined,
    location: typeof p.location === 'string' ? p.location : undefined,
    country: copied(p.country),
    college: typeof p.college === 'string' ? p.college : undefined,
    degree: copied(p.degree) || copied(String(p.degree || '').split(',')[0]),
    graduationYear: /^(19|20)\d{2}$/.test(String(p.graduationYear)) && lowerText.includes(String(p.graduationYear)) ? String(p.graduationYear) : undefined,
    currentCompany: copied(p.currentCompany),
    currentTitle: copied(p.currentTitle),
    yearsExperience: Number.isFinite(Number(p.yearsExperience)) ? Number(p.yearsExperience) : undefined,
    skills: (Array.isArray(p.skills) ? p.skills : []).map(String).filter((s: string) => lowerText.includes(s.toLowerCase())).slice(0, 25),
    facts,
    roles: (Array.isArray(p.roles) ? p.roles : [])
      .filter((r: any) => typeof r?.title === 'string')
      .slice(0, 5)
      .map((r: any) => ({
        title: r.title,
        keywords: roleKeywords(r.title, Array.isArray(r.keywords) ? r.keywords.map(String) : []),
        level: ['intern', 'entry', 'mid', 'senior'].includes(r.level) ? r.level : 'entry',
        why: String(r.why || ''),
      })),
  };
}

/** Title keywords for a suggested role: the role title itself ("Senior Site Reliability Engineer" →
 * "site reliability engineer") plus the model's specific phrases. Generic words like "engineer" are
 * dropped. A single word taken from a multi-word role name ("site", "reliability") is dropped too:
 * alone it matches unrelated jobs ("Site Manager"). Words like "backend", "devops" or "sre" stay. */
export function roleKeywords(title: string, keywords: string[]): string[] {
  const base = title.toLowerCase().replace(/\b(?:senior|sr\.?|junior|jr\.?|lead|staff|principal)\s*/g, '').replace(/\s+/g, ' ').trim();
  const nameWords = base.split(' ').filter((w) => !isGenericTarget(w));
  const fragment = (k: string) => !k.includes(' ') && nameWords.length > 1 && nameWords.includes(k);
  const phrases = [base, ...keywords.map((k) => k.trim().toLowerCase())].filter((k) => k && !isGenericTarget(k) && !fragment(k));
  return Array.from(new Set(phrases)).slice(0, 5);
}

export async function buildProfile(text: string): Promise<ResumeProfile> {
  const contact = extractContactInfo(text);
  const heuristicSkills = extractSkillsHeuristic(text);
  const settings = await getSettings();
  const hasKey = Boolean(settings.groqApiKey || settings.geminiApiKey || settings.openrouterApiKey);

  if (hasKey) {
    try {
      const ai = await structureWithAI(text);
      if (ai && ai.facts.length >= 3) {
        const skills = Array.from(new Set([...ai.skills, ...heuristicSkills]));
        return {
          ...contact,
          ...ai,
          fullName: contact.fullName || ai.fullName,
          college: ai.college || extractCollege(text),
          skills,
          roles: ai.roles.length ? ai.roles : suggestRolesHeuristic(skills, ai.yearsExperience),
          usedAI: true,
        };
      }
    } catch {
      /* fall through to the no-AI path */
    }
  }
  return {
    ...contact,
    college: extractCollege(text),
    skills: heuristicSkills,
    facts: extractFactsHeuristic(text),
    roles: suggestRolesHeuristic(heuristicSkills),
    usedAI: false,
  };
}

/** Saves the file, resume text, facts and any profile fields the user hasn't filled yet. */
export async function saveProfile(file: File | null, text: string, profile: ResumeProfile): Promise<void> {
  await db.transaction('rw', [db.resumes, db.facts, db.resumeFiles], async () => {
    await db.resumes.put({ id: 'primary', fileName: file?.name || 'Pasted resume', rawText: text, uploadedAt: Date.now(), wordCount: text.split(/\s+/).length });
    await db.facts.clear();
    await db.facts.bulkPut(profile.facts);
    if (file) await db.resumeFiles.put({ id: 'primary', name: file.name, type: file.type || 'application/pdf', data: file, savedAt: Date.now() });
  });
  const s = await getSettings();
  const fill = <K extends keyof UserSettings>(key: K, value: UserSettings[K] | undefined) =>
    value !== undefined && value !== '' && !s[key] ? { [key]: value } : {};
  await patchSettings({
    ...fill('userFullName', profile.fullName),
    ...fill('userEmail', profile.email),
    ...fill('userPhone', profile.phone),
    ...fill('linkedinUrl', profile.linkedinUrl),
    ...fill('githubUrl', profile.githubUrl),
    ...fill('portfolioUrl', profile.portfolioUrl),
    ...fill('preferredLocation', profile.location),
    ...fill('userCollege', profile.college),
    ...fill('country', profile.country),
    ...fill('degree', profile.degree),
    ...fill('graduationYear', profile.graduationYear),
    ...fill('currentCompany', profile.currentCompany),
    ...fill('currentTitle', profile.currentTitle),
    skills: profile.skills,
    yearsExperience: profile.yearsExperience,
    suggestedRoles: profile.roles,
  });
}
