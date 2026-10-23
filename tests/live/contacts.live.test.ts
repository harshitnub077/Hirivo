// @vitest-environment jsdom
// Real company sites and feeds. Run with: npm run test:live
import { describe, expect, it } from 'vitest';
import { findHooks, HOOK_MAX_AGE_DAYS } from '../../src/services/hookFinder';
import { lookupCompanySite } from '../../src/services/contacts/siteLookup';
import { buildLadder } from '../../src/services/contactLadder';

describe('Hook Finder (Razorpay)', () => {
  it('returns only dated, linked hooks from the last 90 days', async () => {
    const hooks = await findHooks({ company: 'Razorpay', domain: 'razorpay.com', githubOrg: 'razorpay', siteAllowed: true });
    console.log(hooks.slice(0, 6).map((h) => `${new Date(h.date).toISOString().slice(0, 10)} [${h.sourceLabel}] ${h.title}`).join('\n'));
    expect(hooks.length).toBeGreaterThan(0);
    for (const h of hooks) {
      expect(h.url).toMatch(/^https?:\/\//);
      expect(Date.now() - h.date).toBeLessThan(HOOK_MAX_AGE_DAYS * 86_400_000);
    }
  });
});

describe('Company site lookup', () => {
  it('finds Atlan founders from structured data', async () => {
    const site = await lookupCompanySite('atlan.com', 'Atlan', { force: true });
    console.log('Atlan:', site.people.map((p) => `${p.name} (${p.role})`).join('; '), '| github:', site.githubOrg, '| inboxes:', site.inboxes);
    expect(site.people.map((p) => p.name)).toEqual(expect.arrayContaining(['Prukalpa Sankar', 'Varun Banka']));
    const ladder = buildLadder({ jobTitle: 'Frontend Engineer', company: 'Atlan', domain: 'atlan.com', connections: [], lookup: site, domainHasMx: true });
    for (const c of ladder) expect(c.why.length).toBeGreaterThan(10);
  }, 90_000);

  it('does not present Resend investors as contacts', async () => {
    const site = await lookupCompanySite('resend.com', 'Resend', { force: true });
    console.log('Resend:', site.people.map((p) => `${p.name} (${p.role})`).join('; '));
    const roles = site.people.map((p) => p.role).join(' | ');
    // Titles of Resend's investors on that page; none of them may show up as contacts.
    for (const investorTitle of ['Founder of Basecase', 'Founder of Langbase', 'Director at Alibaba', 'Director at GitHub', 'Founder of Rogue Capital']) {
      expect(roles).not.toContain(investorTitle);
    }
    expect(site.people.some((p) => p.role === 'Recruiter')).toBe(true);
  }, 90_000);
});
