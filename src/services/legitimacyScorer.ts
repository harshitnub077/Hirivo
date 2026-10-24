import { registrableDomain } from './companyDomain';

export interface LegitimacyCheckParams {
  domain?: string;
  companyName: string;
  contactEmail?: string;
}

export interface LegitimacyResult {
  score: number; // 0-100 (higher = more established/legitimate)
  verdict: 'VERIFIED_LEGIT' | 'MODERATE_TRUST' | 'HIGH_RISK_SCAM';
  domainAgeDays?: number;
  domainAgeFormatted?: string;
  hasMx: boolean;
  mailProvider?: string;
  isFreeEmail: boolean;
  /** False when neither the DNS nor the RDAP lookup answered (offline, rate-limited): the score means nothing then. */
  checked: boolean;
  flags: string[];
}

export async function checkLegitimacy(params: LegitimacyCheckParams): Promise<LegitimacyResult> {
  const flags: string[] = [];
  let score = 50; // Starting neutral score
  let domainAgeDays: number | undefined;
  let domainAgeFormatted: string | undefined;
  let hasMx = false;
  let mailProvider: string | undefined;
  let isFreeEmail = false;
  let checked = false;

  // Subdomains (careers.acme.com) usually have no mail server or RDAP record of their own.
  const rawDomain = params.domain || (params.contactEmail ? params.contactEmail.split('@')[1] : null);
  const targetDomain = rawDomain ? registrableDomain(rawDomain) : null;

  // Check if contact email is from a free public provider
  if (params.contactEmail) {
    const emailDomain = params.contactEmail.split('@')[1]?.toLowerCase();
    const freeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'mail.ru'];
    if (emailDomain && freeDomains.includes(emailDomain)) {
      isFreeEmail = true;
      score -= 40;
      flags.push(`Scam alert: Job poster is using a free personal email address (@${emailDomain}) rather than a corporate domain.`);
    }
  }

  if (targetDomain) {
    // 1. Check DNS MX records via Google DNS-over-HTTPS (DoH)
    try {
      const dohRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(targetDomain)}&type=MX`, {
        headers: { Accept: 'application/dns-json' },
      });
      if (dohRes.ok) {
        const dohData = await dohRes.json();
        checked = true;
        if (dohData.Status === 0 && Array.isArray(dohData.Answer) && dohData.Answer.length > 0) {
          hasMx = true;
          score += 25;

          const mxData = dohData.Answer.map((a: any) => a.data?.toLowerCase() || '').join(' ');
          if (mxData.includes('google') || mxData.includes('aspmx')) {
            mailProvider = 'Google Workspace';
          } else if (mxData.includes('outlook') || mxData.includes('microsoft')) {
            mailProvider = 'Microsoft 365';
          } else if (mxData.includes('proton')) {
            mailProvider = 'ProtonMail';
          } else {
            mailProvider = 'Custom Enterprise Mail Server';
          }
          flags.push(`Active mail exchange verified (${mailProvider}). Domain is capable of receiving outreach.`);
        } else {
          score -= 30;
          flags.push(`No MX records found for ${targetDomain}. This domain cannot receive emails.`);
        }
      }
    } catch (err) {
      console.warn('DNS MX check failed:', err);
    }

    // 2. Check Domain Age via RDAP
    try {
      const rdapRes = await fetch(`https://rdap.org/domain/${encodeURIComponent(targetDomain)}`, {
        method: 'GET',
      });
      if (rdapRes.ok) {
        const rdap = await rdapRes.json();
        checked = true;
        const events = rdap.events || [];
        const regEvent = events.find((e: any) =>
          e.eventAction === 'registration' || e.eventAction === 'creation'
        );

        if (regEvent?.eventDate) {
          const regDate = new Date(regEvent.eventDate);
          const ageMs = Date.now() - regDate.getTime();
          domainAgeDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));

          const years = Math.floor(domainAgeDays / 365);
          const months = Math.floor((domainAgeDays % 365) / 30);
          domainAgeFormatted = years > 0 ? `${years}y ${months}m` : `${months} months`;

          if (domainAgeDays < 90) {
            score -= 40;
            flags.push(`High risk: Domain was registered only ${domainAgeDays} days ago (${regDate.toLocaleDateString()}). Possible fraudulent shell company.`);
          } else if (domainAgeDays < 365) {
            score += 10;
            flags.push(`Young entity: Domain registered ${domainAgeFormatted} ago.`);
          } else {
            score += 30;
            flags.push(`Established entity: Domain is ${domainAgeFormatted} old (registered ${regDate.toLocaleDateString()}).`);
          }
        }
      }
    } catch (err) {
      // RDAP rate limits or TLD not supported
    }
  } else {
    flags.push('Domain could not be directly resolved; relying on job board presence.');
  }

  score = Math.min(100, Math.max(0, score));

  let verdict: LegitimacyResult['verdict'] = 'MODERATE_TRUST';
  if (score >= 75) {
    verdict = 'VERIFIED_LEGIT';
  } else if (score < 45) {
    verdict = 'HIGH_RISK_SCAM';
  }

  return {
    score,
    verdict,
    domainAgeDays,
    domainAgeFormatted,
    hasMx,
    mailProvider,
    isFreeEmail,
    checked,
    flags,
  };
}
