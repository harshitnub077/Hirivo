// False-positive check: real postings from established companies must come back clear.
import { describe, expect, it } from 'vitest';
import { checkScam } from '../../src/services/scamShield';
import { htmlToText } from '../../src/services/discover/hn';

async function greenhouse(slug: string) {
  const data = await (await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`)).json();
  return data.jobs.map((j: any) => ({ title: j.title, description: htmlToText(htmlToText(j.content || '')) }));
}
async function lever(slug: string) {
  const data = await (await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`)).json();
  return data.map((j: any) => ({ title: j.text, description: `${j.descriptionPlain || ''}\n${(j.lists || []).map((l: any) => htmlToText(l.content)).join('\n')}\n${j.additionalPlain || ''}` }));
}

describe.each([
  ['Razorpay', () => greenhouse('razorpaysoftwareprivatelimited'), 'razorpay.com'],
  ['Groww', () => greenhouse('groww'), 'groww.in'],
  ['InMobi', () => greenhouse('inmobi'), 'inmobi.com'],
  ['CRED', () => lever('cred'), 'cred.club'],
])('%s', (name, load, domain) => {
  it('every live posting comes back clear', async () => {
    const jobs = await load();
    expect(jobs.length).toBeGreaterThan(0);
    const flagged = jobs
      .map((j: any) => ({ title: j.title, r: checkScam({ ...j, companyDomain: domain }) }))
      .filter((x: any) => x.r.level !== 'clear');
    console.log(`${name}: ${jobs.length} postings, ${flagged.length} flagged`);
    for (const f of flagged) console.log(`  ${f.title}: ${f.r.findings.map((x: any) => x.text).join(' | ')}`);
    expect(flagged).toEqual([]);
  });
});
