// Free scam check: the extension's own Scam Shield (src/services/scamShield.ts), plus the domain
// age and mail-record lookup (src/services/legitimacyScorer.ts) when a website is given.
import { checkScam, FREE_EMAIL_DOMAINS, ScamFinding } from '@/services/scamShield';
import { checkLegitimacy, LegitimacyResult } from '@/services/legitimacyScorer';
import { SITE } from '../../site.config';
import { $, esc, ICON, upsell } from './dom';

const SAMPLE = {
  title: 'Work from home data entry, part time',
  desc: `Urgent hiring! Earn ₹45,000 weekly from home, no experience needed. Simple tasks: like YouTube videos and rate products, get paid per task.
Limited seats, joining today only. Pay a refundable registration fee of ₹1,999 to activate your account.
Contact HR on WhatsApp only: 98765 43210, or email hiring.amazonteam@gmail.com`,
  domain: '',
  email: 'hiring.amazonteam@gmail.com',
};

/** "https://www.Acme.com/careers" → "acme.com"; empty when it isn't a domain. */
export function hostOf(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return '';
  try {
    const host = new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
  } catch {
    return '';
  }
}

const form = $<HTMLFormElement>('#scam-form');
const out = $('#result');
const err = $('#err');
const go = $<HTMLButtonElement>('#go');

$('#sample').addEventListener('click', () => {
  ($('#title') as HTMLInputElement).value = SAMPLE.title;
  ($('#desc') as HTMLTextAreaElement).value = SAMPLE.desc;
  ($('#domain') as HTMLInputElement).value = SAMPLE.domain;
  ($('#email') as HTMLInputElement).value = SAMPLE.email;
  form.requestSubmit();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = ($('#title') as HTMLInputElement).value.trim();
  const desc = ($('#desc') as HTMLTextAreaElement).value.trim();
  const domainRaw = ($('#domain') as HTMLInputElement).value;
  const email = ($('#email') as HTMLInputElement).value.trim();
  err.hidden = true;
  if (desc.length < 20) {
    err.textContent = 'Paste the listing or message first (at least a sentence or two).';
    err.hidden = false;
    return;
  }
  const domain = hostOf(domainRaw);
  if (domainRaw.trim() && !domain) {
    err.textContent = 'That website doesn’t look like a domain. Try something like acme.com.';
    err.hidden = false;
    return;
  }

  // A company-domain recruiter email tells us the company's domain when no website was given.
  const emailDomain = email.includes('@') ? email.split('@')[1].toLowerCase() : '';
  const lookupDomain = domain || (emailDomain && !FREE_EMAIL_DOMAINS.includes(emailDomain) ? emailDomain : '');

  go.disabled = true;
  go.lastChild!.textContent = lookupDomain ? 'Checking the domain…' : 'Checking…';
  let legit: LegitimacyResult | undefined;
  if (lookupDomain) {
    legit = await checkLegitimacy({ domain: lookupDomain, companyName: '', contactEmail: email || undefined }).catch(() => undefined);
  }
  go.disabled = false;
  go.lastChild!.textContent = 'Check this job';

  const result = checkScam({
    title,
    description: email ? `${desc}\nContact: ${email}` : desc,
    companyDomain: lookupDomain || undefined,
    domainAgeDays: legit?.checked ? legit.domainAgeDays : undefined,
    hasMx: legit?.checked ? legit.hasMx : undefined,
  });
  render(result.level, result.findings, lookupDomain, legit);
});

function render(level: 'clear' | 'caution' | 'risk', findings: ScamFinding[], domain: string, legit?: LegitimacyResult) {
  const head = {
    risk: { tone: 'risk', icon: ICON.risk, title: 'Risky: looks like a scam', sub: 'Do not pay, share documents or move to WhatsApp. Real employers never charge you.' },
    caution: { tone: 'caution', icon: ICON.caution, title: 'Be careful', sub: 'Some signs here are common in fake jobs. Check before you share anything.' },
    clear: { tone: 'ok', icon: ICON.shieldOk, title: 'No scam signs found', sub: 'Nothing in the text matches known scam patterns.' },
  }[level];

  const items = findings.map((f) => `<li class="${f.tone}">${f.tone === 'risk' ? ICON.risk : ICON.caution}<span>${esc(f.text)}</span></li>`);
  // What the domain lookup confirmed, so a clear result shows its evidence too.
  if (legit?.checked && domain) {
    if (legit.domainAgeDays !== undefined && legit.domainAgeDays >= 365) items.push(`<li class="ok">${ICON.ok}<span>${esc(domain)} has been registered for ${esc(legit.domainAgeFormatted || `${Math.floor(legit.domainAgeDays / 365)} years`)}.</span></li>`);
    if (legit.hasMx) items.push(`<li class="ok">${ICON.ok}<span>${esc(domain)} receives email${legit.mailProvider && !legit.mailProvider.startsWith('Custom') ? ` (${esc(legit.mailProvider)})` : ''}.</span></li>`);
  } else if (domain) {
    items.push(`<li class="info">${ICON.info}<span>Couldn’t look up ${esc(domain)} right now, so its age and mail records weren’t checked.</span></li>`);
  }
  if (level === 'clear') items.push(`<li class="info">${ICON.info}<span>A clean listing can still be fake. Find the same role on the company’s own careers page before you apply.</span></li>`);
  items.push(`<li class="info">${ICON.info}<span>Never pay a “registration”, “training” or “security” fee, and never share an OTP, PIN or bank details for a job.</span></li>`);

  out.innerHTML = `
    <div class="verdict-big tone-${head.tone}">
      <div class="badge">${head.icon}</div>
      <div><h2>${head.title}</h2><p>${head.sub}</p></div>
    </div>
    <ul class="findings">${items.join('')}</ul>
    ${upsell('Hirivo runs this check, plus the company-board and repost checks, on every job you open.', SITE.installHref, 'Get Hirivo free')}`;
  if (matchMedia('(max-width: 900px)').matches) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
