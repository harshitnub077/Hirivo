// @vitest-environment jsdom
// Regression tests for the bugs fixed in the v2.9.1 code review. Each block names the failure it guards.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db';
import { getSettings, patchSettings, todayKey } from '../../src/db/settings';
import { companyDomainOf, registrableDomain } from '../../src/services/companyDomain';
import { checkLegitimacy } from '../../src/services/legitimacyScorer';
import { checkGhostJob } from '../../src/services/ghostJobShield';
import { SUCCESS_TEXT } from '../../src/content/formFill';
import { extractJobFromPage } from '../../src/content/extractJob';
import { detectReply, findReplies, getAccessToken, GmailNeedsReconnect, type ThreadMessage } from '../../src/services/gmail';
import { recordFingerprint } from '../../src/services/repostFingerprint';
import { generateEmailPermutations } from '../../src/services/contactInference';
import { savePageJobs } from '../../src/services/discover';
import { htmlToText } from '../../src/services/discover/hn';
import { routeLLMRequest } from '../../src/llm/router';
import { forgetModels } from '../../src/llm/registry';
import { checkGrounding } from '../../src/services/proofWriter';
import { autoPurgeRoboticPhrases, lintOutreachText } from '../../src/services/phraseLinter';
import { cleanTargets, titleHasTarget } from '../../src/services/targets';
import { matchesTargets } from '../../src/services/watchlist';
import { roleKeywords } from '../../src/services/resumeImport';

const DAY = 86_400_000;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});
afterEach(() => vi.unstubAllGlobals());

describe('company domain (job boards were being checked as if they were the employer)', () => {
  it.each([
    ['https://wellfound.com/jobs/123', undefined],
    ['https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1', undefined],
    ['https://jobs.ashbyhq.com/acme/1', undefined],
    ['https://docs.google.com/forms/d/abc', undefined],
    ['https://careers.razorpay.com/jobs/1', 'razorpay.com'],
    ['careers.google.com', 'google.com'],
    ['https://jobs.tata.co.in/x', 'tata.co.in'],
    ['www.Zeta.tech', 'zeta.tech'],
    ['not a url', undefined],
  ])('%s → %s', (input, expected) => expect(companyDomainOf(input)).toBe(expected));

  it('reduces subdomains to the registrable domain', () => {
    expect(registrableDomain('a.b.acme.com')).toBe('acme.com');
    expect(registrableDomain('acme.co.uk')).toBe('acme.co.uk');
  });

  it('checks the root domain, and reports nothing (not "risky") when the checks are unreachable', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      urls.push(String(u));
      throw new TypeError('Failed to fetch');
    });
    const r = await checkLegitimacy({ domain: 'careers.acme.com', companyName: 'Acme' });
    expect(urls.every((u) => u.includes('acme.com') && !u.includes('careers.'))).toBe(true);
    expect(r.checked).toBe(false);
  });
});

describe('application success (job descriptions often end with "thank you for your interest")', () => {
  it('ignores the job-description sign-off', () => {
    expect(SUCCESS_TEXT.test('Thank you for your interest in Acme. We review applications on a rolling basis.')).toBe(false);
    expect(SUCCESS_TEXT.test('Applications received after 30 Nov will not be considered.')).toBe(false);
  });
  it('still spots real confirmation pages', () => {
    expect(SUCCESS_TEXT.test('Thanks for applying! We will be in touch.')).toBe(true);
    expect(SUCCESS_TEXT.test('Your application has been successfully submitted.')).toBe(true);
  });
});

describe('page reading', () => {
  it('keeps list items apart and takes the company website, not its LinkedIn page', () => {
    const posting = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Backend Engineer',
      description: '<p>You will:</p><ul><li>Build APIs in Go</li><li>Run Postgres</li></ul><img src=x onerror="window.__pwned=1">',
      hiringOrganization: { '@type': 'Organization', name: 'Acme', sameAs: ['https://www.linkedin.com/company/acme', 'https://acme.dev'] },
    };
    document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify(posting)}</script>`;
    const job = extractJobFromPage();
    expect(job.description).toContain('- Build APIs in Go\n- Run Postgres');
    expect(job.companyDomain).toBe('acme.dev');
    expect((window as any).__pwned).toBeUndefined();
  });
});

describe('Greenhouse job pages (they dropped JSON-LD, so company and location came back empty)', () => {
  it('reads company from the title and location from the header', () => {
    // jsdom has no layout, so innerText is missing; the extractor reads innerText like Chrome does.
    Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
    document.head.innerHTML = '<title>Job Application for Assistant Manager - Internal Audit at Groww</title>';
    document.body.innerHTML = `<div class="job__title"><h1>Assistant Manager - Internal Audit</h1></div><div class="job__location">Bengaluru-VTP, India</div>
      <div class="job__description"><p>About Groww: we make financial services accessible.</p></div>`;
    vi.stubGlobal('location', { href: 'https://job-boards.eu.greenhouse.io/groww/jobs/4970739101', hostname: 'job-boards.eu.greenhouse.io' });
    try {
      expect(extractJobFromPage()).toMatchObject({ source: 'greenhouse', company: 'Groww', location: 'Bengaluru-VTP, India', title: 'Assistant Manager - Internal Audit' });
    } finally {
      delete (HTMLElement.prototype as any).innerText;
    }
  });
});

describe('Gmail replies', () => {
  const me = 'aarav@gmail.com';
  it('does not count bounces, auto-replies, or mail the user sent from an alias', () => {
    const thread: ThreadMessage[] = [
      { id: '1', labelIds: ['SENT'], headers: { from: 'Aarav <aarav@work-alias.dev>' } },
      { id: '2', labelIds: ['INBOX'], headers: { from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)' } },
      { id: '3', labelIds: ['INBOX'], headers: { from: 'Neha <neha@zeta.tech>', subject: 'Automatic reply: Frontend role' } },
    ];
    expect(detectReply(thread, me)).toBeUndefined();
    expect(detectReply([...thread, { id: '4', labelIds: ['INBOX'], headers: { from: 'Neha <neha@zeta.tech>', subject: 'Re: Frontend role' } }], me)?.id).toBe('4');
  });

  it('keeps checking other threads when one was deleted', async () => {
    const rec = (id: string, thread: string) => ({ id, gmailThreadId: thread, status: 'SENT' }) as any;
    const replies = await findReplies([rec('a', 'gone'), rec('b', 't2')], me, async (t) => {
      if (t === 'gone') throw new Error('Gmail 404: not found');
      return [{ id: 'm', labelIds: ['INBOX'], headers: { from: 'ravi@zeta.tech' } }];
    });
    expect(replies.map((r) => r.id)).toEqual(['b']);
  });

  it('a network blip does not force a reconnect', async () => {
    await patchSettings({
      gmail: { clientId: 'x.apps.googleusercontent.com', clientSecret: 's', email: me, accessToken: 'old', expiresAt: 0, refreshToken: 'r', connectedAt: 0 },
    });
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(getAccessToken({ fetch: offline, now: () => Date.now() })).rejects.toThrow('Failed to fetch');
    expect((await getSettings()).gmail?.needsReconnect).toBeFalsy();
  });

  it('a revoked refresh token still asks to reconnect', async () => {
    await patchSettings({
      gmail: { clientId: 'x.apps.googleusercontent.com', clientSecret: 's', email: me, accessToken: 'old', expiresAt: 0, refreshToken: 'r', connectedAt: 0 },
    });
    const revoked = (async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as unknown as typeof fetch;
    await expect(getAccessToken({ fetch: revoked, now: () => Date.now() })).rejects.toBeInstanceOf(GmailNeedsReconnect);
  });
});

describe('repost check (coarse "1 month ago" rounding looked like a re-dated listing)', () => {
  const JD = 'We are hiring a frontend engineer to build our merchant dashboard with React and TypeScript. '.repeat(4);
  it('does not flag a listing whose relative date just rolled over', async () => {
    const now = Date.UTC(2026, 9, 24);
    await recordFingerprint({ id: 'linkedin:42', company: 'Lendo', description: JD, postedDate: '2 weeks ago' }, now - 20 * DAY);
    const r = await recordFingerprint({ id: 'linkedin:42', company: 'Lendo', description: JD, postedDate: '1 month ago' }, now);
    expect(r?.finding).toBeUndefined();
  });
});

describe('ghost check on a board found only by name', () => {
  it('a namesake board missing the role is "check", not "likely fake"', async () => {
    vi.stubGlobal('fetch', async (u: string) =>
      /boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/.test(String(u))
        ? new Response(JSON.stringify({ jobs: [{ id: 5, title: 'Office Manager', location: { name: 'Pune' }, absolute_url: 'https://x/5' }] }))
        : new Response('{}', { status: 404 })
    );
    const r = await checkGhostJob({ jobTitle: 'Frontend Engineer', companyName: 'Acme', sourceUrl: 'https://www.linkedin.com/jobs/view/1' });
    expect(r.boardWasGuessed).toBe(true);
    expect(r.status).toBe('MODERATE_RISK');
  });
});

describe('small fixes', () => {
  it('email guesses drop titles, accents and punctuation', () => {
    expect(generateEmailPermutations("Dr. José O'Neil", 'acme.com')[0].email).toBe('jose.oneil@acme.com');
  });

  it('saving a search page again keeps jobs the user already applied to', async () => {
    const raw = { source: 'page' as const, sourceId: 'https://naukri.com/j/1', sourceLabel: 'naukri.com', title: 'SDE', company: 'Acme', location: 'Pune', remote: false, url: 'https://naukri.com/j/1', tags: [] };
    await savePageJobs([raw]);
    await db.discovered.update('page:https://naukri.com/j/1', { status: 'applied', appliedAt: 123 });
    await savePageJobs([raw]);
    expect(await db.discovered.get('page:https://naukri.com/j/1')).toMatchObject({ status: 'applied', appliedAt: 123 });
  });

  it('decodes entities and line breaks in board HTML', () => {
    expect(htmlToText('Pay&nbsp;&#x20B9;30L<br>Remote &amp; hybrid')).toBe('Pay ₹30L\nRemote & hybrid');
  });

  it('daily limits use the local day', () => {
    const lateEvening = new Date(2026, 9, 24, 23, 30).getTime();
    expect(todayKey(lateEvening)).toBe('2026-10-24');
  });
});

describe('AI replies in JSON mode', () => {
  it('never caches a malformed answer, so a retry can succeed', async () => {
    forgetModels();
    await patchSettings({ groqApiKey: 'k' });
    let reply = 'Sure! Here is the analysis you asked for.';
    vi.stubGlobal('fetch', async (u: string) =>
      /\/models/.test(String(u))
        ? new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-20b' }] }))
        : new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { total_tokens: 5 } }))
    );
    const req = { messages: [{ role: 'user' as const, content: 'json please' }], taskType: 'general' as const, jsonMode: true };
    await expect(routeLLMRequest(req)).rejects.toThrow(/malformed JSON/);
    expect(await db.llmCache.count()).toBe(0);
    reply = '{"ok": true}';
    expect((await routeLLMRequest(req)).content).toBe('{"ok": true}');
    expect(await db.llmCache.count()).toBe(1);
  });
});

describe('role targets (found in the end-to-end run: Daily 5 picked "Mechanical Engineering Expert" for a backend engineer)', () => {
  it('drops targets made only of generic title words', () => {
    expect(cleanTargets(['engineer', 'Senior', 'backend', 'site reliability'])).toEqual(['backend', 'site reliability']);
    expect(cleanTargets(['engineer'])).toEqual(['engineer']); // never empties the list ("match everything")
  });
  it('matches whole words only', () => {
    expect(matchesTargets('Mechanical Engineering Expert (MSc. or PhD)', ['engineer', 'backend'])).toBe(false);
    expect(matchesTargets('Senior Backend Engineer', ['engineer', 'backend'])).toBe(true);
    expect(titleHasTarget('SDET II', 'sde')).toBe(false);
    expect(titleHasTarget('SDE III - Engineering', 'sde')).toBe(true);
    expect(titleHasTarget('HTML Email Developer', 'ml')).toBe(false);
  });
  it('suggested roles keep specific keywords, or fall back to the role title', () => {
    expect(roleKeywords('Senior Backend Engineer', ['backend', 'engineer', 'senior'])).toEqual(['backend engineer', 'backend']);
    expect(roleKeywords('Site Reliability Engineer', ['site', 'reliability', 'engineer', 'sre'])).toEqual(['site reliability engineer', 'sre']);
    expect(roleKeywords('DevOps Engineer', ['devops', 'engineer', 'platform engineer'])).toEqual(['devops engineer', 'devops', 'platform engineer']);
  });
});

describe('writer filler (found in the end-to-end run: "my recent work aligns with" got through)', () => {
  const draft = 'Hi Neha,\nI saw the SDE III opening and thought my recent work aligns with the backend focus you need. I cut p99 latency from 480 ms to 120 ms on Node.js services [FACT-02].\nBest,';
  it('flags it', () => expect(lintOutreachText(draft).issues.map((i) => i.phrase)).toContain('my recent work aligns with'));
  it('removes the whole filler sentence, keeps cited ones and "Node.js" intact', () => {
    const fixed = autoPurgeRoboticPhrases(draft);
    expect(fixed).not.toMatch(/aligns/);
    expect(fixed).toContain('I cut p99 latency from 480 ms to 120 ms on Node.js services [FACT-02].');
    expect(fixed).toMatch(/^Hi Neha,\n/);
  });
});

describe('found in the live runs (v2.10)', () => {
  it('a model that hit its daily cap falls back to another model of the same provider', async () => {
    forgetModels();
    await patchSettings({ groqApiKey: 'k', geminiApiKey: '', openrouterApiKey: '' });
    const used: string[] = [];
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      if (/\/models/.test(String(u))) return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'qwen/qwen3.8-27b' }] }));
      const model = JSON.parse(String(init?.body)).model;
      used.push(model);
      if (model === 'openai/gpt-oss-120b')
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached on tokens per day (TPD). Please try again in 2m46.32s.' } }), { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }], usage: { total_tokens: 3 } }));
    });
    const r = await routeLLMRequest({ messages: [{ role: 'user', content: 'write' }], taskType: 'draft_writing', jsonMode: true });
    expect(r.model).toBe('qwen/qwen3.8-27b');
    expect(used).toEqual(['openai/gpt-oss-120b', 'qwen/qwen3.8-27b']);
  });

  it('a sentence restating the job posting needs no outside source', () => {
    const facts = [{ id: 'FACT-01', claim: 'Built a Go service.', category: 'PROJECT' as const, sourceSnippet: '', verified: true }];
    const jobText = 'Account Executive, France. You will own SaaS sales to mid-market customers and run outbound prospecting.';
    const s = 'The focus on SaaS sales and outbound prospecting stood out.';
    expect(checkGrounding(s, facts, { company: 'GitLab', hasHook: false }).unverifiedClaimsCount).toBe(1);
    expect(checkGrounding(s, facts, { company: 'GitLab', hasHook: false, jobText }).unverifiedClaimsCount).toBe(0);
    // Describing what the job needs, even with "manage" in it, isn't a claim about the sender…
    const needs = 'I noticed the team needs strong SaaS sales experience and fluent French to manage a broad mid-market territory.';
    const jobText2 = `${jobText} Strong SaaS sales experience and fluent French needed to manage a broad mid-market territory.`;
    expect(checkGrounding(needs, facts, { company: 'GitLab', hasHook: false, jobText: jobText2 }).unverifiedClaimsCount).toBe(0);
    // …but "I have managed a mid-market territory" still is.
    expect(checkGrounding('I have managed a broad mid-market territory in SaaS sales.', facts, { company: 'GitLab', hasHook: false, jobText: jobText2 }).unverifiedClaimsCount).toBe(1);
    // A company claim that isn't in the posting still needs a source.
    expect(checkGrounding('GitLab recently raised a huge round.', facts, { company: 'GitLab', hasHook: false, jobText }).unverifiedClaimsCount).toBe(1);
  });
});
