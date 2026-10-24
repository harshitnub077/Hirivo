// @vitest-environment jsdom
// Live: founders from real YC pages (a YC company, and one that isn't).
import { describe, expect, it } from 'vitest';
import { ycFounders } from '../../src/services/people/yc';

describe('YC founders (live)', () => {
  it('finds a YC company\'s founders by its website', async () => {
    const founders = await ycFounders('Razorpay', 'razorpay.com');
    expect(founders.map((f) => f.name)).toEqual(expect.arrayContaining(['Harshil Mathur', 'Shashank Kumar']));
  }, 60_000);
  it('finds nothing for a company that is not in YC, even when a slug exists', async () => {
    expect(await ycFounders('Infosys', 'infosys.com')).toEqual([]);
  }, 60_000);
});
