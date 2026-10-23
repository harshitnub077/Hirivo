import { describe, expect, it } from 'vitest';
import { checkScam, parseAmount } from '../../src/services/scamShield';

const REAL_JD = `Frontend Engineer II, Payments

About the team: We build the checkout that millions of Indian businesses use to accept UPI, cards and netbanking.

What you'll do:
- Own the performance of our checkout SDK across web and mobile web.
- Work with design to ship accessible, fast UI in React and TypeScript.
- Mentor two engineers and review code across the payments frontend.

What we're looking for:
- 2-4 years building production React applications.
- Comfort with web performance tooling (Lighthouse, Web Vitals).

Compensation: competitive, with ESOPs. Interviews: a recruiter call, two technical rounds on video, and a team chat.
Apply on our careers page. Questions? Write to careers@razorpay.com.`;

describe('checkScam', () => {
  it('flags the classic fee + WhatsApp-only scam as risky, with the exact reasons', () => {
    const r = checkScam({
      title: 'Work From Home Data Entry Executive',
      description: 'Urgent hiring! Pay ₹1,999 registration fee to confirm your seat. Limited seats. Contact on WhatsApp only: 98765 43210. Interview on Telegram.',
    });
    expect(r.level).toBe('risk');
    const text = r.findings.map((f) => f.text).join('\n');
    expect(text).toContain('Asks you to pay: “Pay ₹1,999 registration fee to confirm your seat”');
    expect(text).toMatch(/Interview over a chat app/);
    expect(text).toMatch(/Pressure tactic: “Limited seats”/);
    expect(r.findings.filter((f) => f.tone === 'risk')).toHaveLength(1);
  });

  it('passes a normal, real-looking job description', () => {
    const r = checkScam({ title: 'Frontend Engineer II, Payments', description: REAL_JD, companyDomain: 'razorpay.com', domainAgeDays: 4300, hasMx: true });
    expect(r).toEqual({ level: 'clear', findings: [] });
  });

  it('flags a personal recruiter email when the company has its own domain', () => {
    const r = checkScam({ title: 'SDE', description: 'Send your CV to hr.infosys.hiring@gmail.com', companyDomain: 'infosys.com' });
    expect(r.level).toBe('risk');
    expect(r.findings[0].text).toContain('hr.infosys.hiring@gmail.com is a personal address, but the company uses infosys.com');
  });

  it('only cautions about a personal email when no company domain is known', () => {
    expect(checkScam({ title: 'SDE', description: 'Mail me at someone@yahoo.co.in' }).level).toBe('caution');
  });

  it('catches task scams, extreme pay and requests for bank details', () => {
    const r = checkScam({
      title: 'Part time job',
      description: 'Like YouTube videos and earn ₹5,000 per day from home. Share your bank details and OTP to receive payment.',
    });
    expect(r.level).toBe('risk');
    const text = r.findings.map((f) => f.text).join('\n');
    expect(text).toMatch(/task job/);
    expect(text).toMatch(/sensitive details/);
  });

  it('treats a brand-new domain as risky and a missing mail server as a caution', () => {
    expect(checkScam({ title: 'Analyst', description: 'A normal job.', companyDomain: 'new-corp.in', domainAgeDays: 20, hasMx: true }).level).toBe('risk');
    const noMx = checkScam({ title: 'Analyst', description: 'A normal job.', companyDomain: 'odd-corp.in', domainAgeDays: 900, hasMx: false });
    expect(noMx.level).toBe('caution');
    expect(noMx.findings[0].text).toContain('no mail server');
  });

  it('does not flag ordinary mentions of fees, chat or urgency', () => {
    const r = checkScam({
      title: 'Product Manager, Fees & Billing',
      description: 'You will own the fee calculation engine and our WhatsApp Business integration. We move fast and ship weekly. Salary ₹30 lakh per annum.',
      companyDomain: 'zeta.tech',
    });
    expect(r).toEqual({ level: 'clear', findings: [] });
  });
});

describe('placeholder postings', () => {
  it('flags a posting with no real description', () => {
    const r = checkScam({ title: 'Lead SDE', description: 'About us... Job Description Needs to be Added. Equal opportunity employer.', companyDomain: 'razorpay.com' });
    expect(r.level).toBe('caution');
    expect(r.findings[0].text).toContain('no real job description');
  });
});

describe('quotes', () => {
  it('keep "Rs." and decimals inside the quoted clause', () => {
    const r = checkScam({ title: 'Job', description: 'Selected candidates must deposit Rs. 2,500.50 as security deposit before joining. Thanks.' });
    expect(r.findings[0].text).toContain('“Selected candidates must deposit Rs. 2,500.50 as security deposit before joining”');
  });
});

describe('parseAmount', () => {
  it.each([
    ['1,999', 1999],
    ['2 lakh', 200000],
    ['50k', 50000],
    ['1.5 lac', 150000],
  ])('%s → %d', (raw, n) => expect(parseAmount(raw)).toBe(n));
});
