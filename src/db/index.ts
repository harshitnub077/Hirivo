import Dexie, { type EntityTable } from 'dexie';

export interface ResumeRecord {
  id: string; // 'primary'
  fileName: string;
  rawText: string;
  uploadedAt: number;
  wordCount: number;
}

export interface ResumeFact {
  id: string; // e.g., "FACT-01"
  category: 'METRIC' | 'SKILL' | 'ROLE' | 'PROJECT' | 'EDUCATION';
  claim: string;
  sourceSnippet: string;
  verified: boolean;
}

export interface LinkedInConnection {
  id: string; // auto-generated or composite
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  companyNormalized: string;
  position: string;
  email: string;
  connectedOn: string;
}

export interface JobSnapshot {
  id: string; // URL or hash
  url: string;
  title: string;
  company: string;
  companyDomain?: string;
  location: string;
  description: string;
  postedDate?: string;
  isReposted?: boolean;
  atsUrl?: string; // apply link found on the page, when it points at a known ATS
  atsType?: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'unknown';
  atsSlug?: string;
  atsPublishedAt?: string; // ISO date read from the ATS feed, not from the job board
  ghostScore?: number; // 0-100 (high = likely ghost)
  ghostReasons?: string[];
  legitScore?: number; // 0-100 (high = established)
  legitDetails?: {
    domainAgeDays?: number;
    hasMx: boolean;
    mailProvider?: string;
    isFreeEmail: boolean;
  };
  fitScore?: number; // 0-100
  fitVerdict?: 'STRONG_FIT' | 'MODERATE_FIT' | 'DO_NOT_APPLY';
  honestAdvice?: string;
  skillGaps?: { skill: string; studyRecommendation: string; timeToAcquire: string }[];
  dealbreakers?: string[];
  matchingStrengths?: string[];
  analyzedAt: number;
}

export interface ResumeFile {
  id: string; // 'primary'
  name: string;
  type: string;
  data: Blob;
  savedAt: number;
}

export type JobSource = 'remotive' | 'remoteok' | 'himalayas' | 'jobicy' | 'arbeitnow' | 'hn' | 'yc' | 'watchlist' | 'page';

export interface DiscoveredJob {
  id: string; // `${source}:${sourceId}`
  source: JobSource;
  sourceLabel: string; // shown as credit, e.g. "Remotive"
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string; // the original posting; apply buttons always go here
  postedAt?: number;
  salary?: string;
  tags: string[];
  snippet?: string;
  teamSize?: number; // when the source knows it (YC)
  smallTeamReason?: string; // e.g. "YC W24 · 18 people"
  score: number; // 0-100 match with the user's roles and skills
  matchReasons: string[];
  status: 'new' | 'saved' | 'applying' | 'applied' | 'dismissed';
  firstSeenAt: number;
  appliedAt?: number;
}

export interface AtsBoardProbe {
  id: string; // normalised company key
  company: string;
  ats?: 'greenhouse' | 'lever' | 'ashby';
  slug?: string;
  found: boolean;
  checkedAt: number;
}

export interface SourceFetch {
  id: string; // source name
  fetchedAt: number;
  count: number;
  error?: string;
}

export interface WatchedRole {
  id: string;
  title: string;
  location: string;
  url: string;
  publishedAt?: string; // ISO
}

export interface WatchlistCompany {
  id: string; // `${ats}:${slug}`
  name: string;
  ats: 'greenhouse' | 'lever' | 'ashby';
  slug: string;
  addedAt: number;
  lastCheckedAt?: number;
  status: 'ok' | 'not_found' | 'error' | 'pending';
  roles: WatchedRole[];
  newRoleIds: string[]; // roles first seen on the latest check, cleared when viewed
  roleCountHistory: { at: number; count: number }[]; // hiring pulse, newest last
}

export interface OutreachRecord {
  id: string; // UUID
  jobId: string;
  companyName: string;
  jobTitle: string;
  recipientName: string;
  recipientEmail: string;
  contactType: 'WARM_CONNECTION' | 'ALUMNI' | 'COLD_HIRING_MGR';
  channel?: 'email' | 'linkedin';
  emailSubject: string;
  emailBody: string;
  linkedInNote: string;
  factsCited: string[];
  gmailDraftId?: string;
  gmailThreadId?: string;
  status: 'DRAFT_CREATED' | 'SENT' | 'FOLLOWUP_1_DUE' | 'FOLLOWUP_2_DUE' | 'REPLIED' | 'CLOSED';
  followupsDone?: number; // 0, 1 or 2
  notifiedStage?: number; // last follow-up stage we sent a notification for
  createdAt: number;
  followup1Date: number; // +4 days
  followup2Date: number; // +9 days
  repliedAt?: number;
  notes?: string;
}

export interface VoiceProfile {
  id: string; // 'default'
  samples: string[];
  avgSentenceLength: number;
  contractionRatio: number;
  preferredGreeting: string;
  preferredSignoff: string;
  toneSummary: string;
  updatedAt: number;
}

export interface LLMCacheItem {
  hashKey: string;
  response: string;
  model: string;
  createdAt: number;
  expiresAt: number;
}

export interface UserSettings {
  id: string; // 'config'
  groqApiKey: string;
  geminiApiKey: string;
  openrouterApiKey: string;
  activeProvider: 'groq' | 'gemini' | 'openrouter';
  dailySendCap: number;
  todaySendCount: number;
  lastSendDate: string; // YYYY-MM-DD
  userFullName: string;
  userEmail: string;
  userPhone?: string;
  userCollege: string;
  preferredLocation?: string;
  workMode?: 'all' | 'remote' | 'onsite' | 'hybrid';
  earlyBirdAlerts?: boolean;
  skills?: string[];
  yearsExperience?: number;
  suggestedRoles?: { title: string; keywords: string[]; level: 'intern' | 'entry' | 'mid' | 'senior'; why: string }[];
  chosenRoles?: string[]; // titles the user picked from suggestedRoles
  locationPreference?: 'india' | 'remote' | 'anywhere';
  smallTeamsOnly?: boolean;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  targetRoles?: string[];
}

export class HirivoDatabase extends Dexie {
  resumes!: EntityTable<ResumeRecord, 'id'>;
  facts!: EntityTable<ResumeFact, 'id'>;
  connections!: EntityTable<LinkedInConnection, 'id'>;
  jobs!: EntityTable<JobSnapshot, 'id'>;
  watchlist!: EntityTable<WatchlistCompany, 'id'>;
  resumeFiles!: EntityTable<ResumeFile, 'id'>;
  discovered!: EntityTable<DiscoveredJob, 'id'>;
  atsProbes!: EntityTable<AtsBoardProbe, 'id'>;
  sourceFetches!: EntityTable<SourceFetch, 'id'>;
  outreach!: EntityTable<OutreachRecord, 'id'>;
  voiceProfiles!: EntityTable<VoiceProfile, 'id'>;
  llmCache!: EntityTable<LLMCacheItem, 'hashKey'>;
  settings!: EntityTable<UserSettings, 'id'>;

  constructor() {
    super('HirivoDB');
    this.version(2).stores({
      resumes: 'id, uploadedAt',
      facts: 'id, category, verified',
      connections: 'id, fullName, companyNormalized, connectedOn',
      jobs: 'id, url, company, analyzedAt, fitScore',
      opportunities: 'id, companyName, workMode, companyTier, selected, applied, discoveredAt',
      outreach: 'id, jobId, companyName, status, createdAt, followup1Date, followup2Date',
      voiceProfiles: 'id, updatedAt',
      llmCache: 'hashKey, expiresAt',
      settings: 'id',
    });
    // v3: the hardcoded "opportunities" radar is gone; the watchlist reads real ATS feeds.
    this.version(3).stores({
      opportunities: null,
      watchlist: 'id, ats, addedAt, lastCheckedAt',
    });
    // v4: resume file upload and the Discover feed.
    this.version(4).stores({
      resumeFiles: 'id',
      discovered: 'id, source, status, score, firstSeenAt, company',
      atsProbes: 'id, checkedAt, found',
      sourceFetches: 'id',
    });
  }
}

export const db = new HirivoDatabase();
