import { db, UserSettings } from '../db';
import type { FillJobContext, FillProfile } from '../content/profileTypes';
import { CITIES, cityOf, distanceKm, nearbyCities, type City } from './discover/geo';

const list = (s: string | undefined) =>
  (s || '')
    .split(/\s*,\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

// Empty fields stay empty: the form engine leaves those questions for the user rather than typing
// placeholder data into a real application.
// State for the cities job forms ask about most, so "State" can be filled from "Bengaluru".
const CITY_STATE: Record<string, string> = {
  Bengaluru: 'Karnataka', Mysuru: 'Karnataka', Mangaluru: 'Karnataka', Hubballi: 'Karnataka', Belagavi: 'Karnataka', Manipal: 'Karnataka',
  Mumbai: 'Maharashtra', Pune: 'Maharashtra', Nagpur: 'Maharashtra', Nashik: 'Maharashtra', Aurangabad: 'Maharashtra', Kolhapur: 'Maharashtra',
  'New Delhi': 'Delhi', Gurugram: 'Haryana', Faridabad: 'Haryana', Sonipat: 'Haryana', Noida: 'Uttar Pradesh', Ghaziabad: 'Uttar Pradesh',
  Lucknow: 'Uttar Pradesh', Kanpur: 'Uttar Pradesh', Varanasi: 'Uttar Pradesh', Prayagraj: 'Uttar Pradesh', Agra: 'Uttar Pradesh', Meerut: 'Uttar Pradesh',
  Hyderabad: 'Telangana', Warangal: 'Telangana', Chennai: 'Tamil Nadu', Coimbatore: 'Tamil Nadu', Madurai: 'Tamil Nadu', Tiruchirappalli: 'Tamil Nadu',
  Salem: 'Tamil Nadu', Vellore: 'Tamil Nadu', Kolkata: 'West Bengal', Durgapur: 'West Bengal', Siliguri: 'West Bengal', Kharagpur: 'West Bengal',
  Ahmedabad: 'Gujarat', Gandhinagar: 'Gujarat', Surat: 'Gujarat', Vadodara: 'Gujarat', Rajkot: 'Gujarat', Jaipur: 'Rajasthan', Jodhpur: 'Rajasthan',
  Udaipur: 'Rajasthan', Kota: 'Rajasthan', Pilani: 'Rajasthan', Kochi: 'Kerala', Thiruvananthapuram: 'Kerala', Kozhikode: 'Kerala', Thrissur: 'Kerala',
  Chandigarh: 'Chandigarh', Ludhiana: 'Punjab', Amritsar: 'Punjab', Jalandhar: 'Punjab', Indore: 'Madhya Pradesh', Bhopal: 'Madhya Pradesh',
  Jabalpur: 'Madhya Pradesh', Gwalior: 'Madhya Pradesh', Raipur: 'Chhattisgarh', Bhubaneswar: 'Odisha', Patna: 'Bihar', Ranchi: 'Jharkhand',
  Jamshedpur: 'Jharkhand', Dhanbad: 'Jharkhand', Guwahati: 'Assam', Shillong: 'Meghalaya', Dehradun: 'Uttarakhand', Roorkee: 'Uttarakhand',
  Shimla: 'Himachal Pradesh', Jammu: 'Jammu and Kashmir', Srinagar: 'Jammu and Kashmir', Goa: 'Goa', Puducherry: 'Puducherry',
  Visakhapatnam: 'Andhra Pradesh', Vijayawada: 'Andhra Pradesh', Guntur: 'Andhra Pradesh', Tirupati: 'Andhra Pradesh',
};
const DIAL: Record<string, string> = { india: '+91', 'united states': '+1', usa: '+1', canada: '+1', 'united kingdom': '+44', uk: '+44', singapore: '+65', 'united arab emirates': '+971', uae: '+971', australia: '+61', germany: '+49', france: '+33', netherlands: '+31', ireland: '+353', japan: '+81' };

/** "Bachelor's" for B.Tech, B.E., B.Sc…; "Master's" for M.Tech, MBA…; '' when unclear. */
export function degreeLevel(degree: string): string {
  const d = degree.toLowerCase().replace(/\s+/g, ' ');
  if (/\b(ph\.? ?d|doctor)/.test(d)) return 'PhD';
  if (/\b(m\.? ?tech|m\.? ?e\b|m\.? ?sc|m\.? ?s\b|mca|mba|pgdm|m\.? ?com|m\.? ?a\b|master)/.test(d)) return "Master's";
  if (/\b(b\.? ?tech|b\.? ?e\b|b\.? ?sc|b\.? ?s\b|bca|bba|b\.? ?com|b\.? ?a\b|b\.? ?arch|b\.? ?des|bachelor|undergrad)/.test(d)) return "Bachelor's";
  if (/diploma|polytechnic/.test(d)) return 'Diploma';
  return '';
}
const degreeYears = (degree: string) => (/b\.? ?arch/i.test(degree) ? 5 : /\b(b\.? ?tech|b\.? ?e\b)/i.test(degree) ? 4 : degreeLevel(degree) === "Bachelor's" ? 3 : degreeLevel(degree) === "Master's" ? 2 : 0);
const ORD = ['1st', '2nd', '3rd', '4th', '5th'];

/** Grades written on the resume: "CGPA: 8.6/10", "GPA 3.7 / 4", "CPI - 9.1". */
export function cgpaFromResume(text: string): string {
  const m = text.match(/\b(?:c\.?g\.?p\.?a|gpa|cpi|sgpa)\b\s*(?:of|:|-|–)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:\/\s*(10|4(?:\.0)?))?/i) || text.match(/(\d{1,2}\.\d{1,2})\s*\/\s*(10|4(?:\.0)?)\s*(?:c\.?g\.?p\.?a|gpa|cpi)/i);
  if (!m) return '';
  const v = Number(m[1]);
  const scale = m[2] ? Number(m[2]) : v <= 4 ? 4 : 10;
  return v > 0 && v <= scale ? `${m[1]}/${scale === 4 ? 4 : 10}` : '';
}

export function buildFillProfile(settings: UserSettings | null, resumeText = '', now = new Date()): FillProfile {
  const fullName = settings?.userFullName?.trim() || '';
  const nameParts = fullName.split(/\s+/);
  const location = settings?.preferredLocation || '';
  const parts = location.split(/\s*,\s*/).filter(Boolean);
  const city = cityOf(location);
  const country = settings?.country || '';
  const degree = settings?.degree || '';
  const gradYear = Number(settings?.graduationYear) || 0;
  // The academic year ends around June: someone graduating in 2026 is still studying in March 2026.
  const yearsLeft = gradYear ? gradYear - now.getFullYear() + (now.getMonth() >= 6 ? 0 : 1) : NaN;
  const studying = gradYear ? yearsLeft > 0 : undefined;
  const length = degreeYears(degree);
  const yearOfStudy = studying && length ? ORD[Math.max(0, Math.min(length, length - yearsLeft + 1) - 1)] + ' year' : '';
  const yearsExperience = settings?.yearsExperience ?? (studying ? 0 : undefined);
  const stipend = settings?.expectedStipend || (settings?.search?.minMonthlyPay ? String(settings.search.minMonthlyPay) : '');
  return {
    fullName,
    firstName: nameParts[0] || '',
    lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : '',
    email: settings?.userEmail || '',
    phone: settings?.userPhone || '',
    location,
    country,
    linkedinUrl: settings?.linkedinUrl || '',
    githubUrl: settings?.githubUrl || '',
    portfolioUrl: settings?.portfolioUrl || '',
    college: settings?.userCollege || '',
    degree,
    graduationYear: settings?.graduationYear || '',
    currentCompany: settings?.currentCompany || '',
    currentTitle: settings?.currentTitle || '',
    yearsExperience,
    noticePeriod: settings?.noticePeriod || (studying ? 'Immediately' : ''),
    currentCtc: settings?.currentCtc || '',
    expectedCtc: settings?.expectedCtc || '',
    earliestStart: settings?.earliestStart || '',
    willingToRelocate: settings?.willingToRelocate || '',
    authorizedCountries: list(settings?.authorizedCountries),
    howDidYouHear: settings?.howDidYouHear || '',
    languages: list(settings?.languages),
    eeoDecline: Boolean(settings?.eeoDecline),
    resumeText: resumeText.toLowerCase(),
    city: parts[0] || city?.name || '',
    state: settings?.state || (parts.length >= 2 && !/india|united|usa|uk/i.test(parts[1]) ? parts[1] : (city && CITY_STATE[city.name]) || ''),
    postalCode: settings?.postalCode || '',
    address: settings?.address || '',
    dialCode: settings?.userPhone?.trim().match(/^\+\d{1,3}/)?.[0] || DIAL[country.toLowerCase()] || (city?.country === 'India' ? '+91' : ''),
    major: settings?.major || degree.split(/\s*,\s*|\s+in\s+/i)[1]?.trim() || '',
    degreeLevel: degreeLevel(degree),
    cgpa: settings?.cgpa || cgpaFromResume(resumeText),
    tenthPercent: settings?.tenthPercent || '',
    twelfthPercent: settings?.twelfthPercent || '',
    studying,
    yearOfStudy,
    expectedStipend: stipend.replace(/[^\d]/g, ''),
    availableMonths: settings?.availableMonths,
    adult: (settings?.yearsExperience ?? 0) >= 1 || (gradYear > 0 && yearsLeft <= 2 && !!degreeLevel(degree) && degreeLevel(degree) !== 'Diploma') || undefined,
  };
}

/** Where the user can work from, for this job: used for office-days, visa and location questions. */
export function fillJobContext(settings: UserSettings | null, jobLocation = ''): FillJobContext {
  const s = settings?.search;
  const center = cityOf(s?.city || settings?.preferredLocation || '');
  const radius = s?.scope === 'radius' ? s.radiusKm : 50;
  const reach = center ? nearbyCities(center, radius) : [];
  const relocate = settings?.willingToRelocate === 'yes';
  const names = (cs: City[]) => cs.flatMap((c) => [c.name, ...(c.aliases || [])].map((n) => n.toLowerCase()));
  const remoteOnly = !!s && (s.scope === 'remote' || (!s.workModes.includes('onsite') && !s.workModes.includes('hybrid')));
  const jobCity = cityOf(jobLocation);
  let officeOk: FillJobContext['officeOk'];
  if (remoteOnly) officeOk = 'no';
  else if (jobCity && center) officeOk = distanceKm(center, jobCity) <= radius || relocate ? 'yes' : settings?.willingToRelocate === 'no' ? 'no' : undefined;
  else if (relocate) officeOk = 'yes';
  return {
    jobCountry: jobCity?.country || (/\bindia\b/i.test(jobLocation) ? 'India' : undefined),
    jobCity: jobCity?.name,
    homeCity: center?.name,
    officeOk,
    reachCities: names(reach),
    knownCities: names(CITIES),
    relocate,
  };
}

/** The job behind an application page: Analyze, Autopilot or Discover saw it first. */
export async function jobForPage(pageUrl: string): Promise<{ location: string } | undefined> {
  const k = pageKey(pageUrl);
  if (!k) return undefined;
  const jobs = await db.jobs.toArray();
  const job = jobs.find((j) => pageKey(j.url) === k || (j.atsUrl && pageKey(j.atsUrl) === k));
  if (job?.location) return { location: job.location };
  const found = (await db.discovered.toArray()).find((j) => pageKey(j.url) === k);
  return found?.location ? { location: found.location } : undefined;
}

const pageKey = (u: string) => {
  try {
    const url = new URL(u);
    return `${url.hostname.replace(/^(job-boards|boards)\./, '')}${url.pathname.replace(/\/(apply|application)\/?$/, '').replace(/\/$/, '')}`;
  } catch {
    return '';
  }
};

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
