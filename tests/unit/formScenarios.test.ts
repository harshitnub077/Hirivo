// @vitest-environment jsdom
// Questions real application forms ask (Greenhouse, Lever, Ashby, Workday, Indian campus and
// internship forms), and what Fill answers from the profile, the resume and the job.
import { describe, expect, it } from 'vitest';
import { daysOf, decide, inUnits, pickOption, type FillContext, type Question } from '../../src/content/formEngine';
import { buildFillProfile, cgpaFromResume, degreeLevel, fillJobContext } from '../../src/services/formAutofill';
import type { UserSettings } from '../../src/db';

const OCT_2026 = new Date(2026, 9, 24);
const MAR_2026 = new Date(2026, 2, 10);
const base = {
  userFullName: 'Aarav Mehta',
  userEmail: 'aarav@example.com',
  userPhone: '+91 98765 43210',
  preferredLocation: 'Bengaluru, Karnataka',
  userCollege: 'IIT Roorkee',
  country: 'India',
  authorizedCountries: 'India',
  degree: 'B.Tech, Computer Science',
  languages: 'English, Hindi',
  search: { jobType: 'internship', workModes: ['onsite', 'hybrid', 'remote'], experience: 'fresher', city: 'Bengaluru', scope: 'radius', radiusKm: 25, postedWithinDays: 7, minMonthlyPay: 15000 },
} as unknown as UserSettings;
const student = { ...base, graduationYear: '2028', availableMonths: 6 } as UserSettings;
const RESUME = 'b.tech computer science, iit roorkee. cgpa: 8.62/10. built a rate limiter in go.';

const Q = (label: string, kind: Question['kind'] = 'text', options: string[] = [], inputType = 'text'): Question => ({ id: label, kind, label, required: true, options, inputType, answered: false, els: [] });
const answer = (q: Question, s: UserSettings = student, ctx: Partial<FillContext> = {}, now = OCT_2026) => {
  const d = decide(q, buildFillProfile(s, RESUME, now), { company: 'Acme', ...fillJobContext(s, ''), ...ctx });
  if (!('fill' in d)) return 'leave' in d ? `leave: ${d.leave}` : 'ask';
  return Array.isArray(d.fill) ? d.fill : q.options.length ? q.options[pickOption(q.options, d.fill)] ?? `nomatch:${d.fill}` : d.fill;
};

describe('a student profile, derived without typing anything', () => {
  it('knows the year of study, that they are studying, and that they are a fresher', () => {
    const p = buildFillProfile(student, RESUME, OCT_2026);
    expect(p).toMatchObject({ studying: true, yearOfStudy: '3rd year', yearsExperience: 0, noticePeriod: 'Immediately', city: 'Bengaluru', state: 'Karnataka', dialCode: '+91', major: 'Computer Science', degreeLevel: "Bachelor's", cgpa: '8.62/10', expectedStipend: '15000', adult: true });
    // March of the final year: still studying, in the 4th year.
    expect(buildFillProfile({ ...base, graduationYear: '2026' } as UserSettings, '', MAR_2026)).toMatchObject({ studying: true, yearOfStudy: '4th year' });
    expect(buildFillProfile({ ...base, graduationYear: '2026' } as UserSettings, '', OCT_2026)).toMatchObject({ studying: false, yearOfStudy: '' });
  });
  it('reads grades and degree levels the way resumes write them', () => {
    expect(cgpaFromResume('CGPA - 9.1')).toBe('9.1/10');
    expect(cgpaFromResume('GPA: 3.7 / 4.0')).toBe('3.7/4');
    expect(cgpaFromResume('8.4/10 CGPA')).toBe('8.4/10');
    expect(cgpaFromResume('Python 3.11')).toBe('');
    expect(degreeLevel('B.E. Mechanical')).toBe("Bachelor's");
    expect(degreeLevel('MBA, Finance')).toBe("Master's");
    expect(degreeLevel('Diploma in Civil Engineering')).toBe('Diploma');
  });
});

describe('campus and internship questions', () => {
  it.each<[string, Question['kind'], string[], string]>([
    ['CGPA', 'text', [], '8.62/10'],
    ['Branch / Specialization', 'text', [], 'Computer Science'],
    ['Current year of study', 'select', ['1st year', '2nd year', '3rd year', '4th year', 'Graduated'], '3rd year'],
    ['Are you currently pursuing a degree?', 'yesno', ['Yes', 'No'], 'Yes'],
    ['Highest qualification', 'select', ['High School', "Bachelor's Degree", "Master's Degree", 'PhD'], "Bachelor's Degree"],
    ['Education level', 'select', ['Under Graduate', 'Graduate', 'Post Graduate'], 'Graduate'],
    ['Total experience (in years)', 'select', ['Fresher', '0-1', '1-2', '2-3'], 'Fresher'],
    ['Are you available for a 6 month internship?', 'yesno', ['Yes', 'No'], 'Yes'],
    ['Are you available for a 12 month internship?', 'yesno', ['Yes', 'No'], 'No'],
    ['Internship duration', 'select', ['2 months', '3 months', '6 months'], '6 months'],
    ['Expected stipend', 'text', [], '15000'],
    ['Are you 18 years of age or older?', 'yesno', ['Yes', 'No'], 'Yes'],
    ['Notice period', 'select', ['Immediate', '15 days', '1 month', '2 months'], 'Immediate'],
  ])('%s', (label, kind, options, expected) => expect(answer(Q(label, kind, options))).toBe(expected));

  it('leaves what only the user knows, and says where to add it', () => {
    expect(answer(Q('Pin code'))).toMatch(/^leave: Not saved/);
    expect(answer(Q('12th percentage'))).toMatch(/^leave: Not saved/);
    expect(answer(Q('Are you available for a 6 month internship?', 'yesno', ['Yes', 'No']), base)).toMatch(/months you can intern/);
    expect(answer(Q('Date of birth'))).toMatch(/^leave: Personal/);
    expect(answer(Q('Twitter'))).toMatch(/^leave: Not saved/); // never sent to the AI to invent
  });
});

describe('address and contact questions', () => {
  it.each<[string, Question['kind'], string[], string]>([
    ['City', 'text', [], 'Bengaluru'],
    ['State', 'select', ['Karnataka', 'Kerala', 'Maharashtra'], 'Karnataka'],
    ['Country code', 'select', ['+1', '+44', '+91'], '+91'],
    ['Phone country code', 'select', ['United States (+1)', 'India (+91)'], 'India (+91)'],
    ['Preferred work location', 'select', ['Hyderabad', 'Bengaluru', 'Pune'], 'Bengaluru'],
    ['Current location', 'text', [], 'Bengaluru, Karnataka'],
  ])('%s', (label, kind, options, expected) => expect(answer(Q(label, kind, options))).toBe(expected));
  it('fills a saved PIN code and address', () => {
    const s = { ...student, postalCode: '560034', address: '12, 80 Feet Road, Koramangala, Bengaluru' } as UserSettings;
    expect(answer(Q('PIN Code'), s)).toBe('560034');
    expect(answer(Q('Current address', 'textarea'), s)).toBe('12, 80 Feet Road, Koramangala, Bengaluru');
    expect(answer(Q('Email address'), s)).toBe('aarav@example.com');
  });
});

describe('durations and units', () => {
  it('reads notice periods and joining dates as days', () => {
    expect(daysOf('30 days')).toBe(30);
    expect(daysOf('1 month')).toBe(30);
    expect(daysOf('2 weeks')).toBe(14);
    expect(daysOf('Immediately')).toBe(0);
    expect(daysOf('Bengaluru')).toBeUndefined();
  });
  it('picks the matching or tightest option', () => {
    expect(pickOption(['Immediate', '15 days', '1 month', '2 months', '3 months'], '30 days')).toBe(2);
    expect(pickOption(['Within 15 days', 'Within 30 days', 'More than 30 days'], '20 days')).toBe(1);
    expect(pickOption(['0-15 days', '15-30 days', '30-60 days', '60+ days'], '45 days')).toBe(2);
    expect(pickOption(['Less than 1 month', '1-2 months', 'More than 3 months'], '90 days')).toBe(-1);
    expect(pickOption(['Less than 1 month', '1-2 months', 'More than 2 months'], '90 days')).toBe(2);
  });
  it('types just the number when the box names a unit', () => {
    expect(inUnits({ label: 'Notice Period (in days)', inputType: 'text' }, '1 month')).toBe('30');
    expect(inUnits({ label: 'Expected CTC (in LPA)', inputType: 'text' }, '6 LPA')).toBe('6');
    expect(inUnits({ label: 'Expected CTC per annum (INR)', inputType: 'text' }, '6 LPA')).toBe('600000');
    expect(inUnits({ label: 'Notice period', inputType: 'number' }, 'Immediately')).toBe('0');
    expect(inUnits({ label: 'Notice period', inputType: 'text' }, '30 days')).toBe('30 days');
  });
});

describe('office days, visas and "how did you hear"', () => {
  const office = Q('Are you able to commit to working from one of our offices on Anchor Days each week?', 'yesno', ['Yes', 'No']);
  it('answers office days from where the job is and where the user can work', () => {
    expect(answer(office, student, fillJobContext(student, 'Bengaluru, Karnataka, India'))).toBe('Yes');
    expect(answer(office, student, fillJobContext(student, 'Whitefield, Bangalore Urban'))).toBe('Yes');
    expect(answer(office, student, fillJobContext(student, 'San Francisco, California'))).toMatch(/^leave: This office is in San Francisco, outside your area around Bengaluru/);
    expect(answer(office, { ...student, willingToRelocate: 'yes' } as UserSettings, fillJobContext({ ...student, willingToRelocate: 'yes' } as UserSettings, 'Pune'))).toBe('Yes');
    const remoteOnly = { ...student, search: { ...student.search!, workModes: ['remote'] } } as UserSettings;
    expect(answer(office, remoteOnly, fillJobContext(remoteOnly, 'Bengaluru'))).toBe('No');
  });
  it('checks a city named in the question against the user\'s radius', () => {
    expect(answer(Q('Are you willing to work from our Pune office?', 'yesno', ['Yes', 'No']))).toMatch(/Pune too far/);
    expect(answer(Q('Are you comfortable working from our Bangalore office 3 days a week?', 'yesno', ['Yes', 'No']))).toBe('Yes');
    expect(answer(Q('Do you need any accommodations during the interview process?', 'yesno', ['Yes', 'No']))).toMatch(/^leave/);
  });
  it('answers sponsorship from the job\'s country', () => {
    const visa = Q('Will you now or in the future require sponsorship?', 'yesno', ['Yes', 'No']);
    expect(answer(visa, student, fillJobContext(student, 'San Francisco, California; New York'))).toBe('Yes');
    expect(answer(visa, student, fillJobContext(student, 'Gurugram, Haryana'))).toBe('No');
    expect(answer(visa)).toMatch(/^leave: Depends/);
  });
  it('says how the user found the job, or an honest default', () => {
    const heard = Q('How did you hear about this opportunity? (select all that apply)', 'checkboxes', ['LinkedIn', 'Job Board', 'Referral', 'Company Website', 'Other']);
    expect(answer(heard, student, { source: 'LinkedIn' })).toBe('LinkedIn');
    expect(answer(heard)).toBe('Job Board');
    expect(answer(Q('How did you hear about us?', 'select', ['Friend', 'Conference', 'Other']))).toBe('Other');
    expect(answer(Q('How did you hear about us?'))).toBe('Online job board');
    // Notion's live options: no job board, so the company's own site, where the user is applying.
    const notion = Q('How did you hear about this opportunity? (select all that apply)', 'checkboxes', ['LinkedIn', 'Glassdoor', 'Notion Blog', 'Notion Employee', 'Notion Website', 'Billboard/Outdoor Ads', 'Conference or Meetup']);
    expect(answer(notion, student, { company: 'Notion' })).toBe('Notion Website');
  });
});
