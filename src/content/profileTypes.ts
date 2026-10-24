// Shapes passed between the background worker and the content script. Types only, so importing
// this file never pulls shared code into content.js.

/** What the content script may fill from the user's saved profile. Empty string = not saved. */
export interface FillProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  country: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  college: string;
  degree: string;
  graduationYear: string;
  currentCompany: string;
  currentTitle: string;
  yearsExperience?: number;
  noticePeriod: string;
  currentCtc: string;
  expectedCtc: string;
  earliestStart: string;
  willingToRelocate: '' | 'yes' | 'no';
  authorizedCountries: string[];
  howDidYouHear: string;
  languages: string[];
  eeoDecline: boolean;
  /** Lower-cased resume text, used only to answer "have you worked at X before?". */
  resumeText: string;
  // Derived or saved details that Indian and campus forms ask for. '' = unknown.
  city: string;
  state: string;
  postalCode: string;
  address: string;
  dialCode: string; // "+91"
  major: string; // branch / specialisation, e.g. "Computer Science"
  degreeLevel: string; // "Bachelor's", "Master's", "PhD", "Diploma"
  cgpa: string;
  tenthPercent: string;
  twelfthPercent: string;
  studying?: boolean; // still at college (graduation year not reached)
  yearOfStudy: string; // "3rd year", '' when graduated or unknown
  expectedStipend: string; // ₹ per month, digits
  availableMonths?: number; // how long the user can intern
  adult?: boolean; // clearly 18 or older (has work experience, or near graduation from a degree)
}

/** What the background knows about the job behind this form (from Analyze, Discover or Autopilot). */
export interface FillJobContext {
  jobCountry?: string;
  jobCity?: string; // where the job's office is, when Hirivo knows
  homeCity?: string;
  /** Can the user work from this job's office: in their radius, or they relocate. Remote-only users: 'no'. */
  officeOk?: 'yes' | 'no';
  /** Lower-cased city names (and aliases) the user can commute to, and every city Hirivo knows. */
  reachCities: string[];
  knownCities: string[];
  relocate: boolean;
}

/** A question sent to the background for an AI answer written from the resume. */
export interface AskQuestion {
  id: string;
  kind: string;
  label: string;
  options: string[];
  maxLength?: number;
}

export interface AskRequest {
  job: { title: string; company: string; url: string; description: string };
  questions: AskQuestion[];
}

/** id → answer text, chosen option(s), or null when the resume can't answer it honestly. */
export type AskResponse = { answers: Record<string, string | string[] | null>; error?: string };
