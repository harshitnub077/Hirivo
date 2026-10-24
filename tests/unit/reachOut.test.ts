import { describe, expect, it } from 'vitest';
import type { LadderContact } from '../../src/services/contactLadder';
import { audienceOf, manualRecipient, pickRecipients } from '../../src/services/multiOutreach';
import { buildRawMessage } from '../../src/services/gmail';

const c = (over: Partial<LadderContact>): LadderContact => ({ id: over.name || 'x', tier: 3, name: 'X', why: '', contactType: 'COLD_HIRING_MGR', relevance: 30, ...over });

const ladder: LadderContact[] = [
  c({ id: 'conn:1', tier: 1, name: 'Meera Joshi', role: 'Engineering Manager', email: 'meera@acme.in', emailStatus: 'from-export', contactType: 'WARM_CONNECTION', relevance: 100 }),
  c({ id: 'site:a', name: 'Vikram Iyer', role: 'Head of Engineering', email: 'vikram.iyer@acme.in', emailStatus: 'guessed', why: 'Likely hiring manager: Head of Engineering.', relevance: 100 }),
  c({ id: 'site:b', name: 'Neha Kapoor', role: 'Talent Partner', email: 'neha@acme.in', emailStatus: 'listed', relevance: 85 }),
  c({ id: 'site:c', name: 'Asha Rao', role: 'Co-founder & CEO', email: 'asha.rao@acme.in', emailStatus: 'guessed', relevance: 70 }),
  c({ id: 'site:d', name: 'Rohan Das', role: 'Software Engineer', email: 'rohan.das@acme.in', emailStatus: 'guessed', relevance: 45 }),
  c({ id: 'site:e', name: 'Kiran B', role: 'Software Engineer', email: 'kiran.b@acme.in', emailStatus: 'guessed', relevance: 45 }),
  c({ id: 'gh:z', tier: 4, name: 'zed', role: '@zed on GitHub' }), // no email: never picked
  c({ id: 'inbox:careers@acme.in', tier: 5, name: 'Hiring team', role: 'careers@acme.in', email: 'careers@acme.in', emailStatus: 'listed', relevance: 0 }),
];

describe('picking up to five people', () => {
  it('takes one of each kind first: someone you know, hiring manager, recruiter, founder, inbox', () => {
    const picked = pickRecipients(ladder);
    expect(picked.map((r) => r.audience)).toEqual(['connection', 'hiring-manager', 'recruiter', 'founder', 'inbox']);
    expect(picked.find((r) => r.audience === 'inbox')?.name).toBe(''); // greeted as the hiring team
  });
  it('never more than five, never without an email, never the same address twice', () => {
    const doubled = [...ladder, c({ id: 'site:dup', name: 'Neha K', role: 'Recruiter', email: 'NEHA@acme.in' })];
    const picked = pickRecipients(doubled, 5);
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((r) => r.email.toLowerCase())).size).toBe(5);
    expect(picked.some((r) => r.id === 'gh:z')).toBe(false);
  });
  it('knows who is who', () => {
    expect(audienceOf({ tier: 3, role: 'HR Business Partner' })).toBe('recruiter');
    expect(audienceOf({ tier: 3, role: 'Founder' })).toBe('founder');
    expect(audienceOf({ tier: 3, role: 'VP Engineering' })).toBe('leader');
    expect(audienceOf({ tier: 3, role: 'Engineering Manager' })).toBe('hiring-manager');
  });
});

describe('adding someone by hand', () => {
  it('accepts work addresses only', () => {
    expect(manualRecipient('Neha Kapoor', 'Talent Partner', 'Neha@Acme.in')).toMatchObject({ email: 'neha@acme.in', audience: 'recruiter', emailStatus: 'typed' });
    expect(() => manualRecipient('Neha', '', 'neha.k@gmail.com')).toThrow(/work email/);
    expect(() => manualRecipient('Neha', '', 'not-an-email')).toThrow();
  });
});

describe('resume attached to a Gmail draft', () => {
  it('builds multipart/mixed with the text and the file', () => {
    const raw = buildRawMessage({ to: 'neha@acme.in', subject: 'SDE III', body: 'Hi Neha,\nResume attached.', attachment: { name: 'Aarav Mehta Resume.pdf', type: 'application/pdf', base64: btoa('%PDF-1.4 test') } });
    const boundary = raw.match(/boundary="([^"]+)"/)![1];
    const parts = raw.split(`--${boundary}`);
    expect(parts).toHaveLength(4); // preamble, text, file, closing
    expect(parts[1]).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(parts[2]).toContain('Content-Disposition: attachment; filename="Aarav Mehta Resume.pdf"');
    expect(atob(parts[2].split('\r\n\r\n')[1].replace(/\r\n/g, ''))).toBe('%PDF-1.4 test');
    expect(raw.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });
  it('plain messages are unchanged', () => {
    expect(buildRawMessage({ to: 'a@b.co', subject: 's', body: 'b' })).toContain('Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n');
  });
});

import { checkGrounding, trimEmbellishment } from '../../src/services/proofWriter';
import { lintOutreachText } from '../../src/services/phraseLinter';

describe('grounding catches what the live run produced', () => {
  const facts = [
    { id: 'FACT-01', claim: 'Built a Go service that reconciles 2 million card transactions a day, replacing a nightly batch job.' },
    { id: 'FACT-06', claim: 'Reduced monthly AWS spend by 22% by moving cold data from PostgreSQL to S3.' },
    { id: 'FACT-09', claim: 'Backend-leaning software engineer with 4 years of experience building payment and ad-tech services in Java and Go.' },
  ].map((f) => ({ ...f, category: 'PROJECT' as const, sourceSnippet: f.claim, verified: true }));
  const flagged = (body: string) => checkGrounding(body, facts, { company: 'Palantir', hasHook: false }).groundedSentences.filter((s) => !s.isGrounded).map((s) => s.sentence);

  it('flags an invented claim with no digits and no tag', () => {
    expect(flagged('I have three years of direct admin support experience and handle complex travel logistics daily.')).toHaveLength(1);
  });
  it('flags "I have three years supporting…" (no digits, no tag)', () => {
    expect(flagged('I have three years supporting senior leaders and managing complex global travel schedules.')).toHaveLength(1);
  });
  it('flags "aligns with my experience delivering…" and lints it', () => {
    const t = 'I’m drawn to this role because it centers on proactive support, which aligns with my experience delivering reliable, detail-focused solutions.';
    expect(flagged(t)).toHaveLength(1);
    expect(lintOutreachText(t).issues.length).toBeGreaterThan(0);
  });
  it('flags a cited sentence that says much more than its fact', () => {
    expect(flagged('I have 4 years of experience building payment and ad-tech services in Java and Go, handling complex stakeholder coordination daily [FACT-09].')).toHaveLength(1);
  });
  it('cuts "demonstrating …" add-ons and keeps the fact', () => {
    expect(trimEmbellishment('I also reduced monthly AWS spend by 22% by moving cold data to S3, demonstrating strong Excel and cost-tracking skills [FACT-06].')).toBe(
      'I also reduced monthly AWS spend by 22% by moving cold data to S3 [FACT-06].'
    );
    expect(trimEmbellishment('…with 4 years in Java and Go, which required meticulous coordination across time zones [FACT-09].')).toBe('…with 4 years in Java and Go [FACT-09].');
  });
  it('leaves honest sentences and plain framing alone', () => {
    expect(
      flagged(
        'Hi Riya,\nI’m applying for the Administrative Business Partner role you’re screening. I built a Go service that reconciles 2 million card transactions a day, replacing a nightly batch job [FACT-01]. Could you let me know the next step?'
      )
    ).toEqual([]);
  });
});
