// Dev-only sample data so the side panel can be previewed in a normal browser tab
// (npm run dev:preview, then open /sidepanel.html?demo). Never imported in production builds.
import { db } from '../db';
import { patchSettings } from '../db/settings';

export const DEMO_PAGE = { tabId: -1, url: 'https://www.linkedin.com/jobs/view/4040404040', host: 'linkedin.com' };

export async function seedDemo() {
  if (await db.jobs.get('linkedin:4040404040')) return;
  const now = Date.now();
  const day = 86_400_000;
  await patchSettings({
    userFullName: 'Aarav Mehta',
    groqApiKey: 'demo',
    targetRoles: ['frontend', 'full stack', 'react'],
    chosenRoles: ['Frontend Engineer', 'Full Stack Engineer'],
    suggestedRoles: [{ title: 'Frontend Engineer', keywords: ['frontend', 'react'], level: 'entry', why: 'React performance work.' }],
    skills: ['react', 'typescript', 'node.js', 'postgresql'],
    locationPreference: 'india',
  });
  await db.facts.bulkPut([
    { id: 'FACT-01', category: 'METRIC', claim: 'Cut checkout page load time 38% by moving to React Server Components', sourceSnippet: '', verified: true },
    { id: 'FACT-02', category: 'PROJECT', claim: 'Built an open-source UPI payment status tracker with 1.2k GitHub stars', sourceSnippet: '', verified: true },
  ]);
  await db.jobs.put({
    id: 'linkedin:4040404040',
    url: DEMO_PAGE.url,
    title: 'Frontend Engineer II, Payments',
    company: 'Razorpay',
    companyDomain: 'razorpay.com',
    location: 'Bengaluru (Hybrid)',
    description: 'Demo job description '.repeat(20),
    postedDate: '2 weeks ago',
    atsType: 'greenhouse',
    atsPublishedAt: new Date(now - 12 * day).toISOString(),
    ghostScore: 8,
    ghostReasons: ["Listed on Razorpay's Greenhouse board right now.", "Posted 12 days ago on the company's board."],
    scamLevel: 'clear',
    scamFindings: [],
    legitScore: 100,
    legitDetails: { domainAgeDays: 4300, hasMx: true, mailProvider: 'Google Workspace', isFreeEmail: false },
    fitScore: 63,
    fitVerdict: 'MODERATE_FIT',
    honestAdvice: 'You meet 2 of 3 must-haves. Biggest gap: TypeScript at scale across a large codebase. A small project that proves it would change this conversation.',
    fitEvidence: [
      { id: 'R1', text: 'Strong React performance work', kind: 'must', factId: 'FACT-01', reason: 'Cut checkout load time 38% with Server Components.', met: true },
      { id: 'R2', text: 'Experience with payments products', kind: 'must', factId: 'FACT-02', reason: 'Built a public UPI payment status tracker.', met: true },
      { id: 'R3', text: 'TypeScript at scale across a large codebase', kind: 'must', factId: null, reason: 'Your TypeScript work is a solo project.', met: false },
      { id: 'R4', text: 'Design systems experience', kind: 'nice', factId: null, reason: 'Nothing in your resume shows this yet.', met: false },
      { id: 'R5', text: 'Testing with Jest or Playwright', kind: 'nice', factId: 'SKILLS', reason: 'Listed in skills, no project shows it.', met: true },
    ],
    analyzedAt: now,
  });
  await db.watchlist.bulkPut([
    {
      id: 'greenhouse:razorpaysoftwareprivatelimited', name: 'Razorpay', ats: 'greenhouse', slug: 'razorpaysoftwareprivatelimited', addedAt: now, lastCheckedAt: now - 2 * 3600_000, status: 'ok',
      roles: [
        { id: '1', title: 'Frontend Engineer II', location: 'Bengaluru', url: 'https://example.com', publishedAt: new Date(now - day).toISOString() },
        { id: '2', title: 'Senior Full Stack Engineer', location: 'Bengaluru', url: 'https://example.com', publishedAt: new Date(now - 9 * day).toISOString() },
        { id: '3', title: 'Product Designer', location: 'Bengaluru', url: 'https://example.com', publishedAt: new Date(now - 20 * day).toISOString() },
      ],
      newRoleIds: ['1'], roleCountHistory: [{ at: now - 25 * day, count: 21 }, { at: now, count: 26 }],
    },
    { id: 'lever:cred', name: 'CRED', ats: 'lever', slug: 'cred', addedAt: now, lastCheckedAt: now - 2 * 3600_000, status: 'ok', roles: [{ id: '4', title: 'Frontend Engineer', location: 'Bengaluru', url: 'https://example.com', publishedAt: new Date(now - 4 * day).toISOString() }], newRoleIds: [], roleCountHistory: [] },
  ]);
  await db.outreach.bulkPut([
    {
      id: 'o1', jobId: 'x', companyName: 'Zeta', jobTitle: 'Frontend Engineer', recipientName: 'Neha Rao', recipientEmail: 'neha@zeta.tech', contactType: 'COLD_HIRING_MGR', channel: 'email',
      emailSubject: 'Checkout speed at Zeta', emailBody: 'Hi Neha…', linkedInNote: '', factsCited: ['FACT-01'], status: 'SENT',
      createdAt: now - 5 * day, followup1Date: now - day, followup2Date: now + 4 * day, followupsDone: 0,
    },
    {
      id: 'o2', jobId: 'y', companyName: 'Atlan', jobTitle: 'Full Stack Engineer', recipientName: 'Kabir Shah', recipientEmail: '', contactType: 'WARM_CONNECTION', channel: 'linkedin',
      emailSubject: 'LinkedIn note', emailBody: '…', linkedInNote: '', factsCited: [], status: 'REPLIED',
      createdAt: now - 3 * day, followup1Date: now + day, followup2Date: now + 6 * day, followupsDone: 0, repliedAt: now - day,
      interviewPack: {
        createdAt: now - day,
        companyBrief: 'Atlan builds an active metadata platform that helps data teams find, trust and govern their data. (Sample pack for the demo.)',
        sources: [{ title: 'Atlan homepage', url: 'https://atlan.com' }],
        questions: [
          'Walk me through a system you built end to end. What would you change now?',
          'How would you make a slow, data-heavy table view feel instant?',
          'Tell me about a bug that took you a long time to solve.',
          'How do you decide what to test, and what not to?',
          'How would you design search across millions of data assets?',
          'Why this company, and why now?',
          'Tell me about a disagreement with a teammate and how it ended.',
          'What are you looking for in your next role?',
        ],
        strongestFacts: ['FACT-01', 'FACT-02'],
        askThem: [
          'What does great look like in this role after the first 90 days?',
          'What is the biggest problem the frontend team is working on right now?',
          'How does the team decide what to build next?',
        ],
        usedAI: false,
      },
    },
  ]);
}
