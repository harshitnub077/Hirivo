import { db, UserSettings } from '../db';
import type { FillProfile } from '../content/profileTypes';

const list = (s: string | undefined) =>
  (s || '')
    .split(/\s*,\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

// Empty fields stay empty: the form engine leaves those questions for the user rather than typing
// placeholder data into a real application.
export function buildFillProfile(settings: UserSettings | null, resumeText = ''): FillProfile {
  const fullName = settings?.userFullName?.trim() || '';
  const nameParts = fullName.split(/\s+/);
  return {
    fullName,
    firstName: nameParts[0] || '',
    lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : '',
    email: settings?.userEmail || '',
    phone: settings?.userPhone || '',
    location: settings?.preferredLocation || '',
    country: settings?.country || '',
    linkedinUrl: settings?.linkedinUrl || '',
    githubUrl: settings?.githubUrl || '',
    portfolioUrl: settings?.portfolioUrl || '',
    college: settings?.userCollege || '',
    degree: settings?.degree || '',
    graduationYear: settings?.graduationYear || '',
    currentCompany: settings?.currentCompany || '',
    currentTitle: settings?.currentTitle || '',
    yearsExperience: settings?.yearsExperience,
    noticePeriod: settings?.noticePeriod || '',
    currentCtc: settings?.currentCtc || '',
    expectedCtc: settings?.expectedCtc || '',
    earliestStart: settings?.earliestStart || '',
    willingToRelocate: settings?.willingToRelocate || '',
    authorizedCountries: list(settings?.authorizedCountries),
    howDidYouHear: settings?.howDidYouHear || '',
    languages: list(settings?.languages),
    eeoDecline: Boolean(settings?.eeoDecline),
    resumeText: resumeText.toLowerCase(),
  };
}

/** "How did you hear about us?": where Hirivo saw this job, when the user opened it from Discover. */
export async function sourceForUrl(pageUrl: string): Promise<string | undefined> {
  const key = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.hostname.replace(/^(job-boards|boards)\./, '')}/${url.pathname.split('/').filter(Boolean)[0] || ''}`;
    } catch {
      return '';
    }
  };
  const k = key(pageUrl);
  const opened = (await db.discovered.where('status').anyOf('applying', 'saved', 'new').toArray()).find((j) => key(j.url) === k);
  if (!opened) return undefined;
  if (opened.source === 'page') return /linkedin/.test(opened.sourceLabel) ? 'LinkedIn' : /naukri/.test(opened.sourceLabel) ? 'Naukri' : /indeed/.test(opened.sourceLabel) ? 'Indeed' : 'Job board';
  if (opened.source === 'watchlist' || opened.source === 'yc') return 'Company website';
  if (opened.source === 'hn') return 'Hacker News';
  return opened.sourceLabel ? `${opened.sourceLabel} (job board)` : 'Job board';
}
