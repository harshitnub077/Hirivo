// Dev-only sample data so the side panel can be previewed in a normal browser tab
// (npm run dev:preview, then open /sidepanel.html?demo). Never imported in production builds.
import { db } from '../db';
import { patchSettings } from '../db/settings';

export const DEMO_PAGE = { tabId: -1, url: 'https://www.linkedin.com/jobs/view/4040404040', host: 'linkedin.com' };

export async function seedDemo() {
  if (await db.jobs.get('linkedin:4040404040')) return;
  const now = Date.now();
  const day = 86_400_000;
  await patchSettings({ userFullName: 'Aarav Mehta', groqApiKey: 'demo', targetRoles: ['frontend', 'full stack'] });
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
    legitScore: 100,
    legitDetails: { domainAgeDays: 4300, hasMx: true, mailProvider: 'Google Workspace', isFreeEmail: false },
    fitScore: 78,
    fitVerdict: 'MODERATE_FIT',
    honestAdvice: 'Your React performance work maps directly to their checkout team. The gap is TypeScript at scale; mention the payments tracker to cover domain knowledge.',
    matchingStrengths: ['React performance work with a measured result', 'Payments domain project with public traction'],
    dealbreakers: [],
    skillGaps: [{ skill: 'Design systems', studyRecommendation: 'Rebuild three components of their public Blade design system with tests.', timeToAcquire: '1 week' }],
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
    },
  ]);
}
