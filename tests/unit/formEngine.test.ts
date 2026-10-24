// @vitest-environment jsdom
// The application-form engine against real forms saved from live boards (GitLab on Greenhouse,
// Palantir on Lever, Notion on Ashby): what it fills, what it leaves for the user, and why.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countryOf, decide, fillQuestion, findQuestions, pickOption, type FillContext, type Question } from '../../src/content/formEngine';
import { buildFillProfile } from '../../src/services/formAutofill';
import { finishAnswer } from '../../src/services/formAnswers';
import { fixCompanyName } from '../../src/services/proofWriter';
import { retryAfterSeconds } from '../../src/llm/providers/groq';

const load = (name: string) => {
  document.body.innerHTML = readFileSync(resolve(__dirname, '../fixtures/forms', name), 'utf8');
};

const profile = buildFillProfile(
  {
    userFullName: 'Aarav Mehta',
    userEmail: 'aarav@example.com',
    userPhone: '+91 98765 43210',
    preferredLocation: 'Bengaluru',
    userCollege: 'IIT Roorkee',
    linkedinUrl: 'https://linkedin.com/in/aarav',
    currentCompany: 'Zeta',
    country: 'India',
    authorizedCountries: 'India',
    languages: 'English, Hindi',
    noticePeriod: '30 days',
  } as any,
  'Software Engineer II, Zeta. Software Engineer, Swiggy.'
);

const byLabel = (qs: Question[], re: RegExp) => {
  const q = qs.find((x) => re.test(x.label));
  if (!q) throw new Error(`no question matching ${re}: ${qs.map((x) => x.label).join(' | ')}`);
  return q;
};

async function fillAll(ctx: FillContext, p = profile) {
  const qs = findQuestions();
  const result = new Map<string, ReturnType<typeof decide>>();
  for (const q of qs) {
    const d = decide(q, p, ctx);
    result.set(q.label, d);
    if ('fill' in d) await fillQuestion(q, d.fill, 'profile');
  }
  return { qs, result };
}

describe('pickOption', () => {
  it('matches yes/no, ranges and loose text', () => {
    expect(pickOption(['Yes', 'No'], 'No')).toBe(1);
    expect(pickOption(['0-1 years', '1-3 years', '3-5 years', '5+ years'], '4')).toBe(2);
    expect(pickOption(['Less than 2', '2 to 5', 'More than 5'], '7')).toBe(2);
    expect(pickOption(['Aalto University', 'Indian Institute of Technology - Roorkee'], 'IIT Roorkee')).toBe(1);
    expect(pickOption(['English (ENG)', 'Hindi (HIN)'], 'Hindi')).toBe(1);
    expect(pickOption(['LinkedIn', 'Glassdoor'], 'Carrier pigeon')).toBe(-1);
    // GitLab's live sponsorship dropdown: "Yes" must not pick a specific visa.
    const visas = ['No', 'Yes, Netherlands Highly Skilled Migrant Visa', 'Yes, Ireland Highly Skilled Worker Visa', 'Yes, EU Blue Card'];
    expect(pickOption(visas, 'Yes')).toBe(-1);
    expect(pickOption(visas, 'No')).toBe(0);
    expect(pickOption(['Yes, I am', 'No, I am not'], 'Yes')).toBe(0);
  });
  it('reads the country of a job location', () => {
    expect(countryOf('Remote, France')).toBe('France');
    expect(countryOf('Bengaluru-VTP, India')).toBe('India');
    expect(countryOf('Remote')).toBeUndefined();
  });
});

describe('Greenhouse (GitLab)', () => {
  it('reads React dropdowns as questions and leaves diversity questions alone', async () => {
    load('gh-gitlab-form.html');
    const { qs, result } = await fillAll({ company: 'GitLab', jobCountry: 'France' });
    expect(byLabel(qs, /^Country$/).kind).toBe('combobox');
    expect(result.get(byLabel(qs, /previously worked at or consulted for GitLab/).label)).toMatchObject({ fill: 'No' });
    expect(result.get(byLabel(qs, /require sponsorship/).label)).toMatchObject({ fill: 'Yes' }); // India-only authorization, job in France
    expect(result.get(byLabel(qs, /name you'd prefer/).label)).toMatchObject({ fill: 'Aarav' });
    expect(result.get(byLabel(qs, /employment agreements/).label)).toHaveProperty('leave');
    for (const re of [/^Gender$/, /Hispanic/, /Veteran/]) expect(result.get(byLabel(qs, re).label)).toHaveProperty('leave');
    expect((document.getElementById('first_name') as HTMLInputElement).value).toBe('Aarav');
  });
});

describe('Lever (Palantir)', () => {
  it('fills text, radios, checkbox lists and a 3,000-option university list', async () => {
    load('lever-palantir-form.html');
    const { qs, result } = await fillAll({ company: 'Palantir Technologies', jobCountry: 'Singapore' });
    const val = (name: string) => (document.querySelector(`[name="${name}"]`) as HTMLInputElement).value;
    expect(val('name')).toBe('Aarav Mehta');
    expect(val('org')).toBe('Zeta');
    const uni = byLabel(qs, /university/i).els[0] as HTMLSelectElement;
    expect(uni.selectedOptions[0].text).toBe('Indian Institute of Technology - Roorkee');
    const langs = byLabel(qs, /Language Skill/).els as HTMLInputElement[];
    expect(langs.filter((l) => l.checked).map((l) => l.value)).toEqual(['English (ENG)', 'Hindi (HIN)']);
    const auth = byLabel(qs, /legally authorized/).els as HTMLInputElement[];
    expect(auth.find((r) => r.checked)?.value).toBe('No'); // Singapore job, India-only authorization
  }, 15_000); // the location search box waits for suggestions that jsdom never shows
  it('reads the location search box as a typeahead with a clean label', () => {
    load('lever-palantir-form.html');
    const loc = findQuestions().find((q) => (q.els[0] as HTMLInputElement).name === 'location')!;
    expect(loc).toMatchObject({ kind: 'typeahead', label: 'Current location' });
  });
  it('never touches consent, citizenship or name pronunciation', async () => {
    load('lever-palantir-form.html');
    const { qs, result } = await fillAll({ company: 'Palantir Technologies', jobCountry: 'Singapore' });
    for (const re of [/AI notetakers/, /Singapore citizen/, /pronounce/]) {
      const q = byLabel(qs, re);
      expect(result.get(q.label)).toHaveProperty('leave');
      expect((q.els as HTMLInputElement[]).some((e) => e.checked || e.value === 'Aarav Mehta')).toBe(false);
    }
  });
  it('sends open questions to the AI step', async () => {
    load('lever-palantir-form.html');
    const { qs, result } = await fillAll({ company: 'Palantir Technologies' });
    expect(result.get(byLabel(qs, /Why do you want to work at Palantir/).label)).toEqual({ ask: true });
    expect(result.get(byLabel(qs, /proudest accomplishment/).label)).toEqual({ ask: true });
  });
});

describe('Ashby (Notion)', () => {
  it('reads Yes/No buttons and leaves pronouns and office-days questions for the user', async () => {
    load('ashby-notion-form.html');
    const { qs, result } = await fillAll({ company: 'Notion', jobCountry: 'United States' });
    const sponsor = byLabel(qs, /sponsor an immigration case/);
    expect(sponsor.kind).toBe('yesno');
    expect(result.get(sponsor.label)).toMatchObject({ fill: 'Yes' });
    expect(result.get(byLabel(qs, /Anchor Days/).label)).toHaveProperty('leave');
    expect(result.get(byLabel(qs, /pronouns/).label)).toHaveProperty('leave');
    expect(byLabel(qs, /^Location$/).kind).toBe('typeahead');
  });
  it('declines diversity questions only when the user opted in', async () => {
    load('ashby-notion-form.html');
    const { qs } = await fillAll({ company: 'Notion' }, { ...profile, eeoDecline: true });
    const checked = (re: RegExp) => {
      const q = byLabel(qs, re);
      const i = (q.els as HTMLInputElement[]).findIndex((e) => e.checked);
      return i >= 0 ? q.options[i] : null;
    };
    expect(checked(/^Gender$/)).toBe('Decline to self-identify');
    expect(checked(/^Race$/)).toBe('Decline to self-identify');
    expect(checked(/pronouns/)).toBe('Prefer not to say');
  });
});

describe('AI answers are cleaned before they reach a form', () => {
  const facts = [{ id: 'FACT-01', claim: 'Cut p99 latency of the authorisation API from 480 ms to 120 ms by adding Redis caching.' }];
  it('choices must be one of the options', () => {
    expect(finishAnswer({ id: 'a', kind: 'radio', label: 'Kafka?', options: ['Yes', 'No'] }, 'Yes', facts, 'Acme')).toBe('Yes');
    expect(finishAnswer({ id: 'a', kind: 'radio', label: 'Kafka?', options: ['Yes', 'No'] }, 'Maybe', facts, 'Acme')).toBeNull();
    expect(finishAnswer({ id: 'a', kind: 'checkboxes', label: 'Tools', options: ['Go', 'Java'] }, ['go', 'Rust'], facts, 'Acme')).toEqual(['Go']);
  });
  it('long answers lose unsupported claims and fact tags', () => {
    const raw = 'I cut p99 latency from 480 ms to 120 ms with Redis caching [FACT-01]. I also scaled our platform to 50 million users.';
    const out = finishAnswer({ id: 'b', kind: 'textarea', label: 'Tell us about a project', options: [] }, raw, facts, 'Acme') as string;
    expect(out).toBe('I cut p99 latency from 480 ms to 120 ms with Redis caching.');
  });
  it('null stays null, so the user answers it', () => {
    expect(finishAnswer({ id: 'c', kind: 'text', label: 'Expected salary', options: [] }, null, facts, 'Acme')).toBeNull();
  });
});

describe('found in the live run', () => {
  it('without a resume, "have you worked here before?" is left for the user', async () => {
    load('gh-gitlab-form.html');
    const { qs, result } = await fillAll({ company: 'GitLab', jobCountry: 'France' }, { ...profile, resumeText: '' });
    expect(result.get(byLabel(qs, /previously worked at or consulted for GitLab/).label)).toHaveProperty('leave');
  });
  it('corrects a misspelled company name where a name belongs, and nowhere else', () => {
    expect(fixCompanyName("I want to work at Palentir because Palentir's tools…", 'Palantir Technologies')).toBe("I want to work at Palantir because Palantir's tools…");
    expect(fixCompanyName('Nation-wide rollouts taught me a lot. I would join Notion.', 'Notion')).toBe('Nation-wide rollouts taught me a lot. I would join Notion.');
    expect(fixCompanyName('I want to join Motion soon.', 'Notion')).toBe('I want to join Notion soon.');
  });
  it('reads how long Groq wants us to wait', () => {
    expect(retryAfterSeconds(null, 'Rate limit reached… Please try again in 3.675s. Need more tokens?')).toBeCloseTo(3.675);
    expect(retryAfterSeconds(null, 'try again in 1m2.5s')).toBeCloseTo(62.5);
    expect(retryAfterSeconds('7', '')).toBe(7);
    expect(retryAfterSeconds(null, 'nothing here')).toBeUndefined();
  });
});
