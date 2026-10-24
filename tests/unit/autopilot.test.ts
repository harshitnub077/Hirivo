// @vitest-environment jsdom
// Autopilot end to end with a fake host (no Chrome) and fake network: what it sends, to whom,
// what it skips, and what it leaves for the user.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/contacts/siteLookup', () => ({
  lookupCompanySite: vi.fn(async (domain: string) => ({
    domain,
    people: [
      { name: 'Neha Kapoor', role: 'Talent Partner', email: 'neha@acme.dev', page: '/team' },
      { name: 'Vikram Iyer', role: 'Head of Engineering', page: '/team' }, // no listed email: only a guess
      { name: 'Asha Rao', role: 'Co-founder & CEO', email: 'asha@acme.dev', page: '/team' },
    ],
    inboxes: ['careers@acme.dev'],
    githubMembers: [],
    pagesChecked: ['/', '/team'],
    checkedAt: Date.now(),
  })),
  getCachedLookup: vi.fn(),
}));
vi.mock('../../src/services/hookFinder', () => ({ findHooks: vi.fn(async () => []), hookForWriter: vi.fn() }));
vi.mock('../../src/services/gmail', () => ({ gmailConnected: vi.fn(async () => ({ email: 'aarav@gmail.com' })) }));
vi.mock('../../src/services/multiOutreach', async (orig) => {
  const real: any = await orig();
  const body = (name: string) =>
    `Hi ${name || 'there'},\nI’m applying for the Backend Engineer role. I built a Go service that reconciles 2 million card transactions a day, replacing a nightly batch job [FACT-01]. I cut p99 latency of the authorisation API from 480 ms to 120 ms [FACT-02].\nCould we talk for 15 minutes this week about the role and the team?\nBest,\nAarav`;
  return {
    ...real,
    writeDrafts: vi.fn(async ({ recipients }: any) => recipients.map((r: any) => ({ recipient: r, subject: 'Backend Engineer role', body: body(r.name.split(' ')[0]), unverified: 0, factsCited: ['FACT-01'], removed: [] }))),
  };
});

import { db } from '../../src/db';
import { patchSettings } from '../../src/db/settings';
import { processJob, type ApplyReport, type AutopilotHost } from '../../src/services/autopilot/run';
import { enqueue } from '../../src/services/autopilot/queue';
import { atsJobId, domainGuesses, findCompanyDomain, homepageIsCompany } from '../../src/services/autopilot/details';
import { findSubmitButton } from '../../src/content/formEngine';

const GH_URL = 'https://job-boards.greenhouse.io/acme/jobs/123';

function fakeHost(report: Partial<ApplyReport> = {}) {
  const sent: string[] = [];
  const notes: string[] = [];
  const host: AutopilotHost = {
    readPage: vi.fn(async () => null),
    sendEmail: vi.fn(async (m) => (sent.push(m.to), { draftId: `d-${m.to}`, threadId: `t-${m.to}` })),
    apply: vi.fn(async () => ({ status: 'submitted', filled: 12, written: 2, left: [], ...report }) as ApplyReport),
    notify: vi.fn(async (t, m) => void notes.push(`${t}: ${m}`)),
    canReadAnySite: vi.fn(async () => true),
    sleep: vi.fn(async () => undefined),
  };
  return { host, sent, notes };
}

function network({ scam = false } = {}) {
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input);
    if (url.includes('/boards/acme/jobs/123'))
      return new Response(JSON.stringify({ title: 'Backend Engineer', company_name: 'Acme', location: { name: 'Bengaluru' }, first_published: new Date().toISOString(),
        content: scam ? '&lt;p&gt;Pay a registration fee of Rs 2000 to confirm your seat.&lt;/p&gt;' : '&lt;p&gt;Build Go services and Kafka pipelines for payments at scale.&lt;/p&gt;' }));
    if (url.includes('/boards/acme/jobs')) return new Response(JSON.stringify({ jobs: [{ id: 123, title: 'Backend Engineer', location: { name: 'Bengaluru' }, absolute_url: GH_URL, first_published: new Date().toISOString() }] }));
    if (url.startsWith('https://acme.com')) return new Response('<html><head><title>Acme | Payments infrastructure</title></head></html>');
    if (url.includes('dns.google')) return new Response(JSON.stringify({ Status: 0, Answer: [{ data: '1 aspmx.l.google.com.' }] }));
    if (url.includes('rdap.org')) return new Response(JSON.stringify({ events: [{ eventAction: 'registration', eventDate: '2015-01-01T00:00:00Z' }] }));
    return new Response('', { status: 404 });
  });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await patchSettings({ userFullName: 'Aarav Mehta', userEmail: 'a@x.dev', dailySendCap: 15, autopilot: { enabled: true, sendEmails: true, submitForms: true, peoplePerCompany: 5 } });
  await db.facts.bulkPut([
    { id: 'FACT-01', category: 'METRIC', claim: 'Built a Go service that reconciles 2 million card transactions a day, replacing a nightly batch job.', sourceSnippet: '', verified: true },
    { id: 'FACT-02', category: 'METRIC', claim: 'Cut p99 latency of the authorisation API from 480 ms to 120 ms by adding Redis caching.', sourceSnippet: '', verified: true },
  ]);
});
afterEach(() => vi.unstubAllGlobals());

async function run(url = GH_URL, report?: Partial<ApplyReport>) {
  await enqueue([{ url, title: 'Backend Engineer', company: 'Acme' }]);
  const item = (await db.autopilot.toArray())[0];
  const h = fakeHost(report);
  await processJob(item, h.host);
  return { ...h, row: (await db.autopilot.get(item.id))! };
}

describe('Autopilot, start to finish', () => {
  it('researches, emails verified people only, applies, and logs every step', async () => {
    network();
    await db.discovered.put({ id: 'yc:x', source: 'yc', sourceLabel: 'YC', kind: 'job', title: 'Backend Engineer', company: 'Acme', location: 'Bengaluru', remote: false, url: GH_URL, tags: [], score: 80, matchReasons: [], status: 'saved', firstSeenAt: 1 });
    const { sent, row, host } = await run();
    // Listed addresses and the listed inbox; never the guessed vikram.iyer@acme.com.
    expect(sent.sort()).toEqual(['asha@acme.dev', 'careers@acme.dev', 'neha@acme.dev']);
    expect(row).toMatchObject({ status: 'done', applied: true, companyDomain: 'acme.com' });
    expect(row.emailed).toHaveLength(3);
    expect((await db.outreach.toArray()).every((o) => o.autopilot && o.gmailThreadId)).toBe(true);
    expect((await db.discovered.get('yc:x'))?.status).toBe('applied');
    expect(host.apply).toHaveBeenCalledWith('https://job-boards.greenhouse.io/acme/jobs/123', true);
    expect(row.steps.map((s) => s.text).join(' | ')).toMatch(/Read “Backend Engineer” at Acme.*Company site: acme.com.*Sent to .*Submitted/);
  });

  it('never emails the same person twice', async () => {
    network();
    await run();
    await db.autopilot.clear();
    const again = await run();
    expect(again.sent).toEqual([]);
  });

  it('stops at the daily email limit', async () => {
    network();
    await patchSettings({ dailySendCap: 2 });
    const { sent, row } = await run();
    expect(sent).toHaveLength(2);
    expect(row.steps.some((s) => /email limit \(2\) is reached/.test(s.text))).toBe(true);
  });

  it('skips a listing Scam Shield marks risky, and says why', async () => {
    network({ scam: true });
    const { sent, row, host } = await run();
    expect(row.status).toBe('skipped');
    expect(sent).toEqual([]);
    expect(host.apply).not.toHaveBeenCalled();
    expect(row.steps.at(-1)?.text).toMatch(/Skipped to protect you: Asks you to pay/);
  });

  it('leaves consent ticks to the user and says so', async () => {
    network();
    const { row, notes } = await run(GH_URL, { status: 'needs-you', needs: 'Tick the consent box (only you can agree to it), then press Submit', left: [{ label: 'I consent to…', required: true }] });
    expect(row).toMatchObject({ status: 'needs-you', needs: expect.stringMatching(/consent/) });
    expect(notes.at(-1)).toMatch(/one step left/);
  });

  it('never automates LinkedIn', async () => {
    network();
    const { row, host } = await run('https://www.linkedin.com/jobs/view/4040404040/');
    expect(row.status).toBe('needs-you');
    expect(host.apply).not.toHaveBeenCalled();
    expect(host.readPage).not.toHaveBeenCalled();
  });
});

describe('posting details', () => {
  it('reads ATS job ids', () => {
    expect(atsJobId('https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x')).toBe('123');
    expect(atsJobId('https://careers.acme.com/open?gh_jid=987')).toBe('987');
    expect(atsJobId('https://jobs.lever.co/palantir/6ed76ce8-4156/apply')).toBe('6ed76ce8-4156');
    expect(atsJobId('https://jobs.ashbyhq.com/notion/1fc309c8/application')).toBe('1fc309c8');
  });
  it('finds the company website and rejects a namesake', async () => {
    expect(domainGuesses('Acme Technologies Pvt Ltd').slice(0, 2)).toEqual(['acme.com', 'acme.io']);
    expect(homepageIsCompany('<title>Acme — payments</title>', 'Acme')).toBe(true);
    expect(homepageIsCompany('<title>Domain for sale</title>', 'Acme')).toBe(false);
    const fetcher = vi.fn(async (url: string) =>
      url === 'https://acme.io' ? { ok: true, status: 200, url, text: '<title>Acme</title>', type: 'text/html' } : { ok: true, status: 200, url, text: '<title>Parked domain</title>', type: 'text/html' }
    );
    expect(await findCompanyDomain('Acme', [], fetcher as any)).toBe('acme.io');
    expect(await findCompanyDomain('Acme', ['https://careers.acme.co.in/jobs/1'])).toBe('acme.co.in');
  });
});

describe('the Submit button on real forms', () => {
  const load = (f: string) => (document.body.innerHTML = readFileSync(resolve(__dirname, '../fixtures/forms', f), 'utf8'));
  it.each([
    ['gh-gitlab-form.html', /submit application/i],
    ['lever-palantir-form.html', /submit application/i],
    ['ashby-notion-form.html', /submit application/i],
  ])('%s', (file, label) => {
    load(file);
    const b = findSubmitButton()!;
    expect((b as HTMLInputElement).value || b.textContent).toMatch(label);
  });
});
