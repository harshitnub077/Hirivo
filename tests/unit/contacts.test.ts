// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPersonName, roleIsElsewhere, scanPage } from '../../src/services/contacts/teamPage';
import { buildLadder, jobFamily, roleRelevance } from '../../src/services/contactLadder';
import { parseLinkedInConnectionsCSV } from '../../src/services/warmPathMatcher';
import { hnHooks, parseFeed, selectHooks, type Hook } from '../../src/services/hookFinder';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

const TEAM_PAGE = `
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Person","name":"Asha Rao","jobTitle":"Co-founder & CEO"}]}</script>
</head><body>
<h2>Our team</h2>
<ul>
  <li><img alt=""><h3>Vikram Iyer</h3><p>Head of Engineering</p><a href="https://linkedin.com/in/vikram">in</a></li>
  <li><h3>Neha Kapoor</h3><p>Talent Partner</p><a href="mailto:neha@acme.in">Email</a></li>
  <li><h3>Rohan Das</h3><p>Software Engineer</p></li>
  <li><h3>Launching Acme AI</h3><p>Product update</p></li>
</ul>
<section><h2>Backed by</h2>
  <div class="card"><h4>Kunal Shah</h4><p>Founder of CRED</p></div>
  <div class="card"><h4>Jane Doe</h4><p>Partner</p></div>
</section>
<div class="testimonial-card"><p>“Acme changed how we work.”</p><div><b>Priya Menon</b><span>VP Data, Swiggy</span></div></div>
<footer><a href="mailto:careers@acme.in">careers@acme.in</a><a href="mailto:press@acme.in">press</a><a href="https://github.com/acme-hq">GitHub</a></footer>
</body></html>`;

describe('scanPage', () => {
  const scan = scanPage(doc(TEAM_PAGE), 'Acme', 'acme.in', '/team');
  const names = scan.people.map((p) => p.name);

  it('finds staff from structured data and cards', () => {
    expect(names).toEqual(['Asha Rao', 'Vikram Iyer', 'Neha Kapoor', 'Rohan Das']);
    expect(scan.people.find((p) => p.name === 'Vikram Iyer')).toMatchObject({ role: 'Head of Engineering', profileUrl: 'https://linkedin.com/in/vikram' });
    expect(scan.people.find((p) => p.name === 'Neha Kapoor')?.email).toBe('neha@acme.in');
  });
  it('leaves out investors, testimonial customers and headlines', () => {
    expect(names).not.toContain('Kunal Shah');
    expect(names).not.toContain('Jane Doe');
    expect(names).not.toContain('Priya Menon');
    expect(names).not.toContain('Launching Acme AI');
  });
  it('picks up hiring inboxes and the GitHub org, not press@', () => {
    expect(scan.inboxes).toEqual(['careers@acme.in']);
    expect(scan.githubOrg).toBe('acme-hq');
  });
  it('ignores card-like people on the homepage', () => {
    expect(scanPage(doc(TEAM_PAGE), 'Acme', 'acme.in', '/').people.map((p) => p.name)).toEqual(['Asha Rao']);
  });
});

describe('name and role rules', () => {
  it.each([
    ['Founder of Langbase', 'Resend', true],
    ['Director at GitHub', 'Resend', true],
    ['VP, Analytics & Strategy, Fox', 'Atlan', true],
    ['Head of Design', 'Resend', false],
    ['VP Engineering, India', 'Acme', false],
    ['Engineering Manager at Acme', 'Acme', false],
  ])('roleIsElsewhere(%s)', (role, company, expected) => expect(roleIsElsewhere(role, company)).toBe(expected));
  it('isPersonName', () => {
    expect(isPersonName('Prukalpa Sankar')).toBe(true);
    expect(isPersonName('Lucas da Costa')).toBe(true);
    expect(isPersonName('Meet The Team')).toBe(false);
    expect(isPersonName('Introducing Atlan AI')).toBe(false);
  });
});

describe('roleRelevance', () => {
  it('ranks the likely hiring manager above recruiters, founders and others', () => {
    const job = 'Frontend Engineer';
    expect(jobFamily(job)).toBe('engineering');
    const scores = ['Head of Engineering', 'Talent Partner', 'Co-founder & CEO', 'Head of Marketing', 'Software Engineer', 'Office Manager'].map(
      (r) => roleRelevance(r, job).score
    );
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(roleRelevance('Head of Engineering', job).label).toBe('Likely hiring manager');
  });
});

describe('LinkedIn export', () => {
  it('reads the profile URL and an education column when present', () => {
    const csv = `Notes:\n"When exporting your connection data..."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On,School\nMeera,Joshi,https://www.linkedin.com/in/meera,,Acme,Engineering Manager,12 Mar 2024,IIT Delhi\n`;
    expect(parseLinkedInConnectionsCSV(csv)[0]).toMatchObject({ fullName: 'Meera Joshi', url: 'https://www.linkedin.com/in/meera', school: 'IIT Delhi', company: 'Acme' });
  });
});

describe('buildLadder', () => {
  const lookup = {
    domain: 'acme.in',
    people: scanPage(doc(TEAM_PAGE), 'Acme', 'acme.in', '/team').people,
    inboxes: ['careers@acme.in'],
    githubOrg: 'acme-hq',
    githubMembers: [{ login: 'rdas', name: 'Rohan Das', profileUrl: 'https://github.com/rdas' }],
    pagesChecked: ['/', '/team'],
    checkedAt: 0,
  };
  const connections = [
    { id: 'c1', firstName: 'Meera', lastName: 'Joshi', fullName: 'Meera Joshi', company: 'Acme Technologies', companyNormalized: 'acme technologies', position: 'Engineering Manager', email: '', connectedOn: '12 Mar 2024', school: 'IIT Delhi' },
    { id: 'c2', firstName: 'Sam', lastName: 'Lee', fullName: 'Sam Lee', company: 'Other Co', companyNormalized: 'other co', position: 'CTO', email: '', connectedOn: '' },
  ];
  const ladder = buildLadder({ jobTitle: 'Frontend Engineer', company: 'Acme', domain: 'acme.in', college: 'IIT Delhi', connections, lookup, domainHasMx: true });

  it('orders: people you know, site people by relevance, GitHub, then the inbox', () => {
    expect(ladder.map((c) => `${c.tier}:${c.name}`)).toEqual([
      '1:Meera Joshi',
      '3:Vikram Iyer',
      '3:Neha Kapoor',
      '3:Asha Rao',
      '3:Rohan Das',
      '4:Rohan Das',
      '5:Hiring team',
    ]);
  });
  it('explains every rung and labels guessed emails', () => {
    expect(ladder[0].why).toContain('and you both went to IIT Delhi');
    expect(ladder.find((c) => c.name === 'Vikram Iyer')).toMatchObject({ emailStatus: 'guessed', email: 'vikram.iyer@acme.in' });
    expect(ladder.find((c) => c.name === 'Neha Kapoor')).toMatchObject({ emailStatus: 'listed', email: 'neha@acme.in' });
    expect(ladder.at(-1)).toMatchObject({ email: 'careers@acme.in', emailStatus: 'listed' });
    for (const c of ladder) expect(c.why.length).toBeGreaterThan(15);
  });
  it('does not guess an inbox for a domain with no mail server', () => {
    const noMx = buildLadder({ jobTitle: 'X', company: 'Acme', domain: 'acme.in', connections: [], domainHasMx: false });
    expect(noMx).toEqual([]);
  });
});

const NOW = Date.UTC(2026, 9, 24);
const DAY = 86_400_000;

describe('feeds and hooks', () => {
  it('parses RSS and Atom', () => {
    const rss = `<?xml version="1.0"?><rss><channel><item><title>Launching UPI Lite</title><link>https://acme.in/blog/upi-lite</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>v2 is out</title><link rel="alternate" href="https://acme.in/v2"/><updated>2026-10-01T00:00:00Z</updated></entry></feed>`;
    expect(parseFeed(rss)).toEqual([{ title: 'Launching UPI Lite', url: 'https://acme.in/blog/upi-lite', date: Date.parse('2026-10-20T10:00:00Z') }]);
    expect(parseFeed(atom)[0]).toMatchObject({ title: 'v2 is out', url: 'https://acme.in/v2' });
    expect(parseFeed('not xml')).toEqual([]);
  });

  it('keeps only linked hooks from the last 90 days, newest first, no duplicates', () => {
    const h = (id: string, daysAgo: number, url = `https://x/${id}`, title = id): Hook => ({ id, source: 'news', sourceLabel: 'News', title, url, date: NOW - daysAgo * DAY, suggestion: id });
    const picked = selectHooks([h('old', 120), h('a', 5), h('b', 1), h('dup', 2, 'https://x/dup', 'b'), h('nolink', 1, ''), h('future', -5)], NOW);
    expect(picked.map((x) => x.id)).toEqual(['b', 'a']);
  });

  afterEach(() => vi.unstubAllGlobals());
  it('HN hooks require the company in the title', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          hits: [
            { objectID: '1', title: 'Razorpay launches UPI on credit', url: 'https://razorpay.com/x', created_at: '2026-10-20T00:00:00Z' },
            { objectID: '2', title: 'Show HN: my Basecamp tool', url: 'https://x.com', created_at: '2026-10-21T00:00:00Z' },
          ],
        })
      )
    );
    const hooks = await hnHooks('Razorpay');
    expect(hooks.map((h) => h.title)).toEqual(['Razorpay launches UPI on credit']);
  });
});
