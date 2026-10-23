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
  atsType?: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'unknown';
  atsSlug?: string;
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

export interface DiscoveredOpportunity {
  id: string;
  companyName: string;
  companyDomain: string;
  companyTier: 'UNDERRATED_GEM' | 'TOP_TECH' | 'HIGH_GROWTH';
  workMode: 'REMOTE' | 'ON_SITE' | 'HYBRID';
  location: string;
  jobTitle: string;
  applyUrl: string;
  applyMethod: 'FORM_AUTOFILL' | 'DIRECT_EMAIL' | 'WARM_REFERRAL';
  techStack: string[];
  fundingStage: string;
  matchScore: number;
  ghostScore: number;
  legitScore: number;
  hiringLead?: string;
  hiringLeadEmail?: string;
  selected: boolean;
  applied: boolean;
  discoveredAt: number;
}

export interface OutreachRecord {
  id: string; // UUID
  jobId: string;
  companyName: string;
  jobTitle: string;
  recipientName: string;
  recipientEmail: string;
  contactType: 'WARM_CONNECTION' | 'ALUMNI' | 'COLD_HIRING_MGR';
  emailSubject: string;
  emailBody: string;
  linkedInNote: string;
  factsCited: string[];
  gmailDraftId?: string;
  gmailThreadId?: string;
  status: 'DRAFT_CREATED' | 'SENT' | 'FOLLOWUP_1_DUE' | 'FOLLOWUP_2_DUE' | 'REPLIED' | 'CLOSED';
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
  companyTier?: 'all' | 'underrated' | 'top_tech';
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
  opportunities!: EntityTable<DiscoveredOpportunity, 'id'>;
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
  }
}

export const db = new HirivoDatabase();
