// Exclusions: companies and title words the user never wants to see or apply to.
import { describe, expect, it } from 'vitest';
import { exclusionFor, isExcluded, normalizeCompany, parseList } from '../../src/services/targetFilter';

describe('normalizeCompany', () => {
  it('ignores case, punctuation and legal suffixes', () => {
    expect(normalizeCompany('Acme, Inc.')).toBe('acme');
    expect(normalizeCompany('ACME Technologies Pvt. Ltd')).toBe('acme');
    expect(normalizeCompany('Procter & Gamble')).toBe('procter and gamble');
  });
});

describe('exclusionFor', () => {
  const ex = { excludeCompanies: ['Acme'], excludeTitleWords: ['intern', 'sales', 'full stack'] };
  it('matches the company whole, not a part of another name', () => {
    expect(exclusionFor({ company: 'acme inc', title: 'Engineer' }, ex)).toBe('company Acme');
    expect(isExcluded({ company: 'Acmeworks', title: 'Engineer' }, ex)).toBe(false);
  });
  it('matches title words as whole words and phrases', () => {
    expect(exclusionFor({ company: 'Zeta', title: 'Backend Intern' }, ex)).toBe('title word "intern"');
    expect(isExcluded({ company: 'Zeta', title: 'International Business Analyst' }, ex)).toBe(false);
    expect(isExcluded({ company: 'Zeta', title: 'Full Stack Developer' }, ex)).toBe(true);
    expect(isExcluded({ company: 'Zeta', title: 'Wholesale Manager' }, ex)).toBe(false);
  });
  it('excludes nothing with empty lists', () => {
    expect(isExcluded({ company: 'Acme', title: 'Intern' }, {})).toBe(false);
    expect(isExcluded({ company: 'Acme', title: 'Intern' }, { excludeCompanies: [''], excludeTitleWords: ['  '] })).toBe(false);
  });
});

describe('parseList', () => {
  it('splits, trims and de-duplicates', () => {
    expect(parseList(' senior, sales,,senior , unpaid ')).toEqual(['senior', 'sales', 'unpaid']);
  });
});
