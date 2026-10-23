import { describe, expect, it } from 'vitest';
import { locationFits, scoreJob } from '../../src/services/discover/rank';
import type { MatchProfile, RawJob } from '../../src/services/discover/types';
import { dueFollowupStage, followupText, gmailComposeUrl, stripCitations } from '../../src/services/outreach';
import { checkGrounding } from '../../src/services/proofWriter';
import { autoPurgeRoboticPhrases, lintOutreachText } from '../../src/services/phraseLinter';
import type { OutreachRecord, ResumeFact } from '../../src/db';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 23);

const job = (over: Partial<RawJob> = {}): RawJob => ({
  source: 'remotive',
  sourceId: '1',
  sourceLabel: 'Remotive',
  title: 'Frontend Engineer',
  company: 'Acme',
  location: 'Bengaluru, India',
  remote: false,
  url: 'https://acme.dev/jobs/1',
  postedAt: NOW - DAY,
  tags: ['react', 'typescript'],
  ...over,
});

const me: MatchProfile = { targets: ['frontend', 'react'], skills: ['react', 'typescript'], level: 'entry', locationPreference: 'india', smallTeamsOnly: false };

describe('scoreJob', () => {
  it('scores a matching fresh Indian role highly, with reasons', () => {
    const r = scoreJob(job(), me, NOW)!;
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.reasons.join(' ')).toMatch(/Title matches/);
    expect(r.reasons.join(' ')).toMatch(/Uses react, typescript/);
  });
  it('drops roles that are not what the user asked for', () => expect(scoreJob(job({ title: 'Sales Manager' }), me, NOW)).toBeNull());
  it('drops stale listings', () => expect(scoreJob(job({ postedAt: NOW - 60 * DAY }), me, NOW)).toBeNull());
  it('penalises senior titles for entry-level users', () => {
    const junior = scoreJob(job(), me, NOW)!.score;
    const senior = scoreJob(job({ title: 'Staff Frontend Engineer' }), me, NOW)!;
    expect(senior.score).toBeLessThan(junior - 25);
    expect(senior.reasons).toContain('Senior role; likely above your level');
  });
  it('honours small-teams-only', () => {
    expect(scoreJob(job(), { ...me, smallTeamsOnly: true }, NOW)).toBeNull();
    expect(scoreJob(job({ teamSize: 12, smallTeamReason: 'YC W26 · 12 people' }), { ...me, smallTeamsOnly: true }, NOW)).not.toBeNull();
  });
});

describe('locationFits (India-first)', () => {
  it.each([
    [{ location: 'Pune', remote: false }, true],
    [{ location: 'Worldwide', remote: true }, true],
    [{ location: 'Remote', remote: true }, true],
    [{ location: 'USA only', remote: true }, false],
    [{ location: 'Berlin, Germany', remote: false }, false],
  ])('%j → %s', (j, expected) => expect(locationFits(j, 'india')).toBe(expected));
  it('remote-only excludes onsite India roles', () => expect(locationFits({ location: 'Pune', remote: false }, 'remote')).toBe(false));
});

const record = (over: Partial<OutreachRecord> = {}): OutreachRecord => ({
  id: 'r1',
  jobId: 'j',
  companyName: 'Zeta',
  jobTitle: 'Frontend Engineer',
  recipientName: 'Neha Rao',
  recipientEmail: 'neha@zeta.tech',
  contactType: 'COLD_HIRING_MGR',
  emailSubject: 'Checkout speed',
  emailBody: 'I cut load time 38% [FACT-01].',
  linkedInNote: '',
  factsCited: ['FACT-01'],
  status: 'SENT',
  createdAt: NOW,
  followup1Date: NOW + 4 * DAY,
  followup2Date: NOW + 9 * DAY,
  followupsDone: 0,
  ...over,
});

describe('follow-ups', () => {
  it('nothing due before day 4', () => expect(dueFollowupStage(record(), NOW + 3 * DAY)).toBe(0));
  it('first follow-up on day 4, final on day 9', () => {
    expect(dueFollowupStage(record(), NOW + 4 * DAY)).toBe(1);
    expect(dueFollowupStage(record({ followupsDone: 1 }), NOW + 5 * DAY)).toBe(0);
    expect(dueFollowupStage(record({ followupsDone: 1 }), NOW + 9 * DAY)).toBe(2);
  });
  it('stops after a reply', () => expect(dueFollowupStage(record({ status: 'REPLIED' }), NOW + 9 * DAY)).toBe(0));
  it('follow-up quotes the original without citations', () => {
    const { subject, body } = followupText(record(), 1, 'Aarav');
    expect(subject).toBe('Re: Checkout speed');
    expect(body).toContain('Hi Neha,');
    expect(body).not.toContain('[FACT');
  });
});

describe('sending', () => {
  it('builds a Gmail compose URL with everything encoded', () => {
    const url = new URL(gmailComposeUrl('a@b.com', 'Hi & bye', 'Line 1\nLine 2'));
    expect(url.searchParams.get('view')).toBe('cm');
    expect(url.searchParams.get('su')).toBe('Hi & bye');
    expect(url.searchParams.get('body')).toBe('Line 1\nLine 2');
  });
  it('strips fact citations before sending', () => expect(stripCitations('Built X [FACT-01] and Y [FACT-12].')).toBe('Built X and Y.'));
});

describe('grounding', () => {
  const facts: ResumeFact[] = [{ id: 'FACT-01', category: 'METRIC', claim: 'Cut load 38%', sourceSnippet: '', verified: true }];
  it('flags claims with no fact behind them', () => {
    const g = checkGrounding('I cut load time 38% [FACT-01]. I also led a team of 50 engineers. Would love to chat?', facts);
    expect(g.citedFactIds).toEqual(['FACT-01']);
    expect(g.unverifiedClaimsCount).toBe(1);
    expect(g.groundedSentences.find((s) => !s.isGrounded)?.sentence).toMatch(/led a team/);
  });
  it('does not accept citations to facts that do not exist', () => {
    expect(checkGrounding('I built a compiler [FACT-99].', facts).unverifiedClaimsCount).toBe(1);
  });
});

describe('linter', () => {
  it('catches India-specific template phrases', () => {
    const text = 'Respected Sir, PFA my resume. Kindly do the needful and revert back.';
    const issues = lintOutreachText(text).issues.map((i) => i.category);
    expect(issues.filter((c) => c === 'STIFF_FORMALITY').length).toBeGreaterThanOrEqual(4);
    const fixed = autoPurgeRoboticPhrases(text);
    expect(fixed).not.toMatch(/Respected Sir|PFA|needful|revert back/i);
  });
});
