import type { DiscoveredJob, JobSource } from '../../db';

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
}

export interface MatchProfile {
  targets: string[]; // lowercase keywords from the chosen roles
  skills: string[];
  level?: 'intern' | 'entry' | 'mid' | 'senior';
  locationPreference: 'india' | 'remote' | 'anywhere';
  smallTeamsOnly: boolean;
}

export type ScoredJob = Omit<DiscoveredJob, 'status' | 'firstSeenAt'>;
