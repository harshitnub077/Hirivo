// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { attachResume, fillFields, Profile, SUCCESS_TEXT } from '../../src/content/formFill';

const form = readFileSync(resolve(__dirname, '../fixtures/greenhouse-application-form.html'), 'utf8');

const profile: Profile = {
  fullName: 'Aarav Mehta',
  firstName: 'Aarav',
  lastName: 'Mehta',
  email: 'aarav@example.com',
  phone: '+91 98765 43210',
  location: 'Bengaluru',
  college: 'IIT Delhi',
  linkedinUrl: 'https://linkedin.com/in/aarav',
  githubUrl: 'https://github.com/aarav',
  portfolioUrl: 'https://aarav.dev',
};

const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

describe('fillFields on a real Greenhouse application form', () => {
  beforeEach(() => {
    document.body.innerHTML = form;
  });

  it('fills name, email, phone and the LinkedIn question', () => {
    const filled = fillFields(profile);
    expect(value('first_name')).toBe('Aarav');
    expect(value('last_name')).toBe('Mehta');
    expect(value('email')).toBe('aarav@example.com');
    expect(value('phone')).toBe('+91 98765 43210');
    const linkedin = document.querySelector('label[for^="question_"]')!.getAttribute('for')!;
    expect(value(linkedin)).toBe('https://linkedin.com/in/aarav');
    expect(filled).toBeGreaterThanOrEqual(5);
  });

  it('leaves dropdowns and unrelated fields alone', () => {
    fillFields(profile);
    expect(value('country')).toBe('');
    expect(value('company-name-0')).toBe('');
    expect(value('title-0')).toBe('');
  });

  it('never overwrites what the user already typed', () => {
    (document.getElementById('email') as HTMLInputElement).value = 'mine@work.com';
    fillFields(profile);
    expect(value('email')).toBe('mine@work.com');
  });

  it('attaches the resume to the resume input, once', () => {
    // jsdom has no DataTransfer and only accepts real FileLists; stand in for both.
    class FakeDataTransfer {
      private list: File[] = [];
      items = { add: (f: File) => this.list.push(f) };
      get files() {
        return Object.assign([...this.list], { item: (i: number) => this.list[i] });
      }
    }
    (globalThis as any).DataTransfer = FakeDataTransfer;
    Object.defineProperty(document.getElementById('resume'), 'files', { value: null, writable: true });
    const file = new File(['%PDF-1.4'], 'Aarav-Resume.pdf', { type: 'application/pdf' });
    expect(attachResume(file)).toBe(true);
    const input = document.getElementById('resume') as HTMLInputElement;
    expect(input.files?.[0]?.name).toBe('Aarav-Resume.pdf');
    expect(attachResume(file)).toBe(false);
  });
});

describe('SUCCESS_TEXT', () => {
  it.each(['Thank you for applying!', 'Your application has been submitted.', "We've received your application"])('matches “%s”', (t) => {
    expect(SUCCESS_TEXT.test(t)).toBe(true);
  });
  it('does not match a normal job page', () => {
    expect(SUCCESS_TEXT.test('Apply for this job. Submit application')).toBe(false);
  });
});
