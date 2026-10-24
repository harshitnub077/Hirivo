import type { DiscoveredJob, JobSource, SearchProfile } from '../../db';
import type { City } from './geo';
import type { ListedJob } from '../../content/extractJobList';

/** A job as a source returns it, before Hirivo scores it against the user. */
export interface RawJob {
  source: JobSource;
  sourceId: string;
  sourceLabel: string;
  sourceUrl?: string; // credit link back to the source when the apply url points elsewhere
  kind?: 'job' | 'company';
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  postedAt?: number;
  salary?: string;
  tags: string[];
  snippet?: string;
  teamSize?: number;
  smallTeamReason?: string;
  internship?: boolean;
  monthlyPay?: number; // rupees per month when the source states pay (0 = unpaid)
  applyVia?: DiscoveredJob['applyVia'];
}

export interface MatchProfile {
  targets: string[]; // lowercase keywords from the chosen roles
  queries: string[]; // what to type into job-site search boxes, e.g. "backend engineer intern"
  skills: string[];
  level?: 'intern' | 'entry' | 'mid' | 'senior';
  locationPreference: 'india' | 'remote' | 'anywhere'; // older sources (remote boards, YC)
  smallTeamsOnly: boolean;
  search: SearchProfile;
  center?: City; // the search city, when it's one Hirivo knows
}

/** How adapters reach the web: plain fetches, and job-site pages read in a background tab. */
export interface SearchHost {
  fetchText(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; url: string; text: string }>;
  /** Loads the page in a background tab of the user's own Chrome and reads the job cards on it. */
  scrapeTab(url: string): Promise<{ host: string; jobs: ListedJob[]; blocked?: string }>;
}

/** A source answered with a block page (429, CAPTCHA, login wall): try again later. */
export class SourceBlocked extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type ScoredJob = Omit<DiscoveredJob, 'status' | 'firstSeenAt'>;
