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
