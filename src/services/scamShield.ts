// Scam Shield: deterministic checks for the fake-job patterns common in India (and elsewhere).
// Pure function, no network. Domain age and mail records come from legitimacyScorer's results.
// Every finding quotes the words that triggered it, so the user can judge for themselves.

export interface ScamFinding {
  tone: 'risk' | 'caution';
  text: string;
}

export interface ScamResult {
  level: 'clear' | 'caution' | 'risk';
  findings: ScamFinding[];
}

export interface ScamInput {
  title: string;
  description: string;
  companyDomain?: string;
  domainAgeDays?: number;
  hasMx?: boolean;
}

export const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'rediffmail.com', 'icloud.com', 'aol.com', 'protonmail.com', 'proton.me', 'zoho.com', 'mail.com', 'gmx.com',
];

const quote = (s: string) => `“${s.replace(/\s+/g, ' ').trim()}”`;

/** True when text[i] ends a clause: not the dot in "Rs." and not a decimal point. */
function isBoundary(text: string, i: number): boolean {
  const ch = text[i];
  if (ch === '\n' || ch === '!' || ch === ';' || ch === '?') return true;
  if (ch !== '.') return false;
  if (/\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')) return false;
  return !/rs$/i.test(text.slice(Math.max(0, i - 2), i));
}

/** The clause around a match, so quotes show the full amount or phrase, not a fragment. */
function clauseAround(text: string, re: RegExp): string | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  let start = m.index;
  while (start > 0 && !isBoundary(text, start - 1)) start--;
  let end = m.index + m[0].length;
  while (end < text.length && !isBoundary(text, end)) end++;
  const clause = text.slice(start, end).trim();
  return clause.length <= 90 ? clause : m[0];
}

const FEE = /\b(?:registration|training|security|joining|processing|kit|onboarding|verification|application|interview|refundable|documentation)\s+(?:fees?|charges?|deposit|amount)\b|\b(?:pay|deposit|transfer)\s+(?:a\s+)?(?:(?:one[- ]time|small|nominal|refundable)\s+)?(?:fee|amount|deposit|rs\.?\s?\d|₹\s?\d|inr\s?\d)|\bfees?\s+of\s+(?:rs\.?|₹|inr)\s?\d/i;
const CHAT_APP = /\b(?:whats\s?app|telegram|signal app)\b/i;
const CHAT_ONLY = /\b(?:contact|message|ping|text|reach|apply|send (?:your )?(?:cv|resume))\b[^.\n]{0,40}\b(?:whats\s?app|telegram)\b|\b(?:whats\s?app|telegram)\b[^.\n]{0,25}\b(?:only|number|no\.?|id|@)/i;
const CHAT_INTERVIEW = /\binterview\b[^.\n]{0,40}\b(?:on|via|over|through)\s+(?:whats\s?app|telegram|google chat|hangouts|signal)\b/i;
const URGENCY = /\b(?:limited (?:seats|slots|vacancies|openings)|only \d+ (?:seats|slots|vacancies)|joining (?:today|tomorrow)|apply (?:within|in) (?:\d+|24) ?h(?:ou)?rs?|last date (?:is )?today|hurry|immediate joiners? only.{0,30}(?:fee|pay))\b/i;
const TASK_SCAM = /\b(?:(?:like|subscribe to|rate|review)\s+(?:youtube\s+)?(?:videos|channels|products|hotels|apps)|copy[- ]paste (?:work|job)|typing jobs?|sms sending job|form filling (?:job|work)|captcha (?:entry|typing)|prepaid tasks?|recharge (?:your )?account)\b/i;
const EASY_MONEY = /\b(?:earn|income|salary|payout)\b[^.\n]{0,40}\b(?:daily|per day|every day|weekly)\b[^.\n]{0,40}\b(?:from home|no experience|part[- ]time|mobile)\b|\bno (?:experience|interview|qualification) (?:needed|required)\b[^.\n]{0,40}\b(?:earn|daily|per day)\b/i;
const PERSONAL_DOCS = /\b(?:share|send|upload)\b[^.\n]{0,30}\b(?:aadhaar|aadhar|pan card|bank (?:details|account)|otp|upi pin|atm pin|cvv)\b/i;
const EMAIL = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi;

/** Converts amounts like "₹1,50,000", "Rs 2 lakh", "50k" to rupees (or the raw number for $/€). */
export function parseAmount(raw: string): number {
  const n = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (/lakh|lac|\bl\b/i.test(raw)) return n * 100_000;
  if (/crore|\bcr\b/i.test(raw)) return n * 10_000_000;
  if (/k\b/i.test(raw)) return n * 1_000;
  return n;
}

const PAY_PER = /(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d+)?\s?(?:k|lakh|lac)?)\s*(?:\/|per|a|every)\s*(day|week|hour)/gi;

function extremePay(text: string): string | null {
  for (const m of text.matchAll(PAY_PER)) {
    const amount = parseAmount(m[1]);
    const per = m[2].toLowerCase();
    const daily = per === 'day' ? amount : per === 'week' ? amount / 6 : amount * 8;
    if (daily >= 100_000 || (per === 'week' && amount >= 50_000 && /from home|part[- ]time|no experience/i.test(text))) return m[0];
  }
  return null;
}

export function checkScam(input: ScamInput): ScamResult {
  const text = `${input.title}\n${input.description}`;
  const findings: ScamFinding[] = [];
  const add = (tone: ScamFinding['tone'], message: string) => findings.push({ tone, text: message });
  const hit = (re: RegExp) => clauseAround(text, re);

  const fee = hit(FEE);
  if (fee) add('risk', `Asks you to pay: ${quote(fee)}. Real employers never charge candidates.`);

  const docs = hit(PERSONAL_DOCS);
  if (docs) add('risk', `Asks for sensitive details up front: ${quote(docs)}. Never share OTPs, PINs or bank details for a job.`);

  const task = hit(TASK_SCAM);
  if (task) add('risk', `Matches common “task job” scam wording: ${quote(task)}.`);

  const pay = extremePay(text);
  if (pay) add('risk', `Pay that is far above normal for this kind of work: ${quote(pay)}.`);
  else {
    const easy = hit(EASY_MONEY);
    if (easy) add('caution', `Easy-money wording: ${quote(easy)}.`);
  }

  // Contact through personal channels.
  const company = input.companyDomain?.toLowerCase().replace(/^www\./, '');
  const companyIsFree = company ? FREE_EMAIL_DOMAINS.includes(company) : false;
  const freeEmails = Array.from(text.matchAll(EMAIL))
    .map((m) => ({ email: m[0], domain: m[1].toLowerCase() }))
    .filter((e) => FREE_EMAIL_DOMAINS.includes(e.domain));
  if (freeEmails.length > 0) {
    if (company && !companyIsFree) {
      add('risk', `Contact email ${freeEmails[0].email} is a personal address, but the company uses ${company}.`);
    } else {
      add('caution', `Contact email ${freeEmails[0].email} is a personal address, not a company one.`);
    }
  }

  const chatOnly = hit(CHAT_ONLY);
  const chatInterview = hit(CHAT_INTERVIEW);
  if (chatInterview) add('caution', `Interview over a chat app: ${quote(chatInterview)}. Real interviews use video calls or the office.`);
  else if (chatOnly) add('caution', `Asks you to apply or talk over a chat app: ${quote(chatOnly)}.`);
  else if (CHAT_APP.test(text) && /\b(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/.test(text)) {
    add('caution', 'Gives a personal phone number with WhatsApp or Telegram as the way to reach them.');
  }

  const urgent = hit(URGENCY);
  if (urgent) add('caution', `Pressure tactic: ${quote(urgent)}.`);

  if (input.domainAgeDays !== undefined && input.domainAgeDays < 90) {
    add('risk', `${company || 'The company website'} was registered only ${input.domainAgeDays} days ago.`);
  }
  if (input.hasMx === false && company) add('caution', `${company} has no mail server, which is unusual for a real company.`);

  const level: ScamResult['level'] = findings.some((f) => f.tone === 'risk') ? 'risk' : findings.length ? 'caution' : 'clear';
  return { level, findings };
}
