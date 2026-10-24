import { describe, expect, it } from 'vitest';
import { locationFits, scoreJob } from '../../src/services/discover/rank';
import type { MatchProfile, RawJob } from '../../src/services/discover/types';
import { dueFollowupStage, followupText, gmailComposeUrl, stripCitations } from '../../src/services/outreach';
import { autoCite, checkGrounding, removeUnsupported } from '../../src/services/proofWriter';
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

const me: MatchProfile = {
  targets: ['frontend', 'react'],
  queries: ['frontend'],
  skills: ['react', 'typescript'],
  level: 'entry',
  locationPreference: 'india',
  smallTeamsOnly: false,
  search: { jobType: 'both', workModes: ['onsite', 'hybrid', 'remote'], experience: '0-2', city: '', scope: 'india', radiusKm: 25, postedWithinDays: 30 },
};

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
  it('flags unsourced claims about the company unless a hook was given', () => {
    const body = "Hi Priya, the team's focus on React-driven payment flows matches my work. Razorpay recently launched a new checkout UI. I cut load time 38% [FACT-01].";
    const noHook = checkGrounding(body, facts, { company: 'Razorpay', hasHook: false });
    expect(noHook.unverifiedClaimsCount).toBe(2);
    expect(noHook.groundedSentences.filter((s) => !s.isGrounded).every((s) => /no source/.test(s.warning || ''))).toBe(true);
    expect(checkGrounding(body, facts, { company: 'Razorpay', hasHook: true }).unverifiedClaimsCount).toBe(0);
  });
  it('flags any figure the facts never mention, even with an innocent verb', () => {
    const body = 'I cut load 38% [FACT-01]. The solution now handles 1.5 M monthly transactions without latency spikes. Could we talk for 15 minutes this week?';
    const g = checkGrounding(body, facts, { company: 'Razorpay' });
    expect(g.unverifiedClaimsCount).toBe(1);
    expect(g.groundedSentences.find((s) => !s.isGrounded)?.warning).toBe("Has a figure (1.5m) that isn't in your resume facts.");
  });
  it('accepts a figure that comes from the linked hook', () => {
    expect(checkGrounding('Congrats on crossing 10 million merchants.', facts, { company: 'Razorpay', hasHook: true, hookText: 'Razorpay crosses 10 million merchants. Source: https://x' }).unverifiedClaimsCount).toBe(0);
  });
  it('flags invented focus areas of the role', () => {
    expect(checkGrounding('The focus on React-based payment flows matches my work.', facts, { company: 'Razorpay' }).unverifiedClaimsCount).toBe(1);
  });
  it('one click removes exactly the unsupported sentences', () => {
    const body = 'Hi Priya,\n\nI cut load 38% [FACT-01]. The solution handles 1.5 M transactions. Could we talk this week?\n\nBest,\nAarav';
    expect(removeUnsupported(body, facts, { company: 'Razorpay' })).toBe('Hi Priya,\n\nI cut load 38% [FACT-01]. Could we talk this week?\n\nBest,\nAarav');
  });
  it('does not accept citations to facts that do not exist', () => {
    expect(checkGrounding('I built a compiler [FACT-99].', facts).unverifiedClaimsCount).toBe(1);
  });
});

describe('autoCite', () => {
  const facts: ResumeFact[] = [
    { id: 'FACT-04', category: 'PROJECT', claim: 'Built a Chrome extension that summarises Razorpay settlement reports, used by 300 merchants', sourceSnippet: '', verified: true },
  ];
  it('tags a sentence that restates a fact', () => {
    const out = autoCite("I've built a Chrome extension that summarises Razorpay settlement reports, used by 300 merchants.", facts);
    expect(out).toBe("I've built a Chrome extension that summarises Razorpay settlement reports, used by 300 merchants [FACT-04].");
    expect(checkGrounding(out, facts).unverifiedClaimsCount).toBe(0);
  });
  it('does not tag a sentence with a different number or a different claim', () => {
    expect(autoCite('I built a Chrome extension used by 3,000 merchants.', facts)).not.toContain('[FACT');
    expect(autoCite('I led a team of 12 engineers.', facts)).not.toContain('[FACT');
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
