// The application-form engine. Reads any ATS form as a list of questions (text, long text, select,
// React dropdown, typeahead, radio group, checkbox group, Yes/No buttons), answers the ones the
// user's saved profile settles for certain, and fills each widget the way a person would.
//
// Hard limits, whatever the user saved:
// - never presses Submit, never ticks a consent / terms / certification box;
// - never answers a diversity question (gender, race, veteran, disability…) unless the user chose
//   "decline to self-identify" in Hirivo, and then only with the decline option;
// - never overwrites anything already filled or chosen.
// Imported only by the content script, so it must not import from src/services (keeps content.js
// a single self-contained file).
import type { FillProfile } from './profileTypes';
import { describe as describeField } from './formFill';

export type QuestionKind = 'text' | 'textarea' | 'select' | 'combobox' | 'typeahead' | 'radio' | 'checkboxes' | 'checkbox' | 'yesno';

export interface Question {
  id: string;
  kind: QuestionKind;
  label: string;
  required: boolean;
  options: string[];
  inputType: string;
  maxLength?: number;
  answered: boolean;
  els: HTMLElement[];
}

/** What the engine decided for a question. `value` is an option text for choices, text otherwise. */
export type Decision = { fill: string | string[]; source: 'profile' | 'ai' } | { leave: string } | { ask: true };

export interface FillContext {
  company: string;
  jobCountry?: string;
  source?: string; // where the user found the job, e.g. "LinkedIn", "Company website"
}

// ---------- reading the form ----------

const clean = (s: string | null | undefined) =>
  (s || '')
    .replace(/[*✱]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([?.:,])/g, '$1')
    .trim()
    .slice(0, 400);
const textOf = (el: Element | null | undefined) => clean((el as HTMLElement | null)?.innerText || el?.textContent || '');

function hidden(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"], [hidden]')) return true;
  const style = el.getAttribute('style') || '';
  return /display:\s*none|visibility:\s*hidden/.test(style);
}

const SKIP_TYPES = /^(hidden|submit|button|image|reset|file|search|password)$/;
const SKIP_NAMES = /recaptcha|captcha|honeypot|^iti-|search-input/i;

/** Label text for a single control, or the heading above a group of options. */
function labelFor(el: HTMLElement, group: HTMLElement[] = [el]): string {
  const byIds = (el.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .map((id) => (id ? textOf(document.getElementById(id)) : ''))
    .join(' ')
    .trim();
  if (byIds && group.length === 1) return byIds;
  if (group.length === 1) {
    if (el.id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel && textOf(forLabel)) return textOf(forLabel);
    }
    const wrap = el.closest('label');
    // A label that wraps a whole widget (Lever) also holds helper text like "No location found";
    // its own heading element, when it has one, is the question.
    const own = wrap?.querySelector('[class*="label"], [class*="title"], legend');
    if (own && textOf(own)) return textOf(own);
    if (wrap && textOf(wrap)) return textOf(wrap);
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
  }
  const groupEl = el.closest('[role="radiogroup"], [role="group"], fieldset');
  const legend = groupEl?.querySelector('legend') || (groupEl?.getAttribute('aria-labelledby') ? document.getElementById(groupEl.getAttribute('aria-labelledby')!) : null);
  if (legend && textOf(legend)) return textOf(legend);

  // Climb to the question's container and take its heading (Lever cards, Ashby field entries…).
  const optionLabels = group.flatMap((g) => [g.closest('label'), g.id ? document.querySelector(`label[for="${CSS.escape(g.id)}"]`) : null]).filter(Boolean) as Element[];
  let node: HTMLElement | null = el.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const controls = Array.from(node.querySelectorAll<HTMLElement>('input, select, textarea')).filter((c) => !hidden(c) && !SKIP_TYPES.test((c as HTMLInputElement).type || ''));
    if (controls.some((c) => !group.includes(c) && !c.closest('[class*="yesno"]'))) break; // reached a container of several questions
    const heading = Array.from(node.querySelectorAll('legend, label, [class*="label"], [class*="question-title"], [class*="title"], h3, h4')).find(
      (h) => !group.some((g) => h.contains(g)) && !optionLabels.some((o) => o === h || o.contains(h)) && textOf(h)
    );
    if (heading) return textOf(heading);
  }
  return clean(el.getAttribute('placeholder')) || describeField(el as HTMLInputElement);
}

function optionText(input: HTMLInputElement): string {
  const byFor = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
  return textOf(byFor) || textOf(input.closest('label')) || textOf(input.nextElementSibling) || clean(input.value);
}

const PLACEHOLDER_OPTION = /^(select|choose|please select|--|—|-)\b|^$/i;

/** A text box that only keeps a value picked from its suggestion list (Lever, Ashby locations). */
function isTypeahead(el: HTMLElement): boolean {
  return (
    el.hasAttribute('aria-autocomplete') ||
    /autocomplete|typeahead|location-input/i.test(el.className) ||
    !!el.parentElement?.querySelector(':scope > [class*="dropdown"], :scope > [role="listbox"]')
  );
}

let seq = 0;
const qid = () => `hq${++seq}`;

/** Every question on the page, in order. */
export function findQuestions(root: ParentNode = document): Question[] {
  const out: Question[] = [];
  const seen = new Set<Element>();

  // Ashby-style Yes/No buttons (with a hidden checkbox behind them).
  for (const box of Array.from(root.querySelectorAll<HTMLElement>('[class*="yesno"], [data-hirivo-yesno]'))) {
    const buttons = Array.from(box.querySelectorAll<HTMLButtonElement>('button')).filter((b) => /^(yes|no)$/i.test(textOf(b)));
    if (buttons.length !== 2) continue;
    box.querySelectorAll('input').forEach((i) => seen.add(i));
    buttons.forEach((b) => seen.add(b));
    const pressed = buttons.some((b) => b.getAttribute('aria-pressed') === 'true');
    out.push({ id: qid(), kind: 'yesno', label: labelFor(buttons[0], buttons as HTMLElement[]), required: /required/i.test(box.parentElement?.innerHTML.slice(0, 600) || ''), options: ['Yes', 'No'], inputType: 'buttons', answered: pressed, els: buttons });
  }

  const controls = Array.from(root.querySelectorAll<HTMLElement>('input, select, textarea'));
  for (const el of controls) {
    if (seen.has(el)) continue;
    const input = el as HTMLInputElement;
    const type = (input.type || '').toLowerCase();
    if (SKIP_TYPES.test(type) || SKIP_NAMES.test(input.name || input.id || '') || input.disabled || hidden(el)) continue;
    if ((input as any).readOnly && el.getAttribute('role') !== 'combobox') continue;

    if (type === 'radio' || type === 'checkbox') {
      // Options of one question share a name, or (Ashby "how did you hear") a field container.
      const container = el.closest<HTMLElement>('fieldset, [role="group"], [role="radiogroup"], [class*="fieldEntry"], [class*="field-entry"], .application-question, li.application-question');
      let group = input.name ? controls.filter((c) => (c as HTMLInputElement).type === type && (c as HTMLInputElement).name === input.name) : [el];
      if (group.length === 1 && type === 'checkbox' && container) {
        const inBox = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter((c) => !hidden(c));
        if (inBox.length > 1) group = inBox;
      }
      group.forEach((g) => seen.add(g));
      const boxes = group as HTMLInputElement[];
      const kind: QuestionKind = type === 'radio' ? 'radio' : boxes.length > 1 ? 'checkboxes' : 'checkbox';
      out.push({
        id: qid(),
        kind,
        label: kind === 'checkbox' ? optionText(input) || labelFor(el) : labelFor(el, group),
        required: boxes.some((b) => b.required || b.getAttribute('aria-required') === 'true'),
        options: kind === 'checkbox' ? ['Yes'] : boxes.map(optionText),
        inputType: type,
        answered: boxes.some((b) => b.checked),
        els: group,
      });
      continue;
    }

    seen.add(el);
    const label = labelFor(el);
    const required = input.required || el.getAttribute('aria-required') === 'true' || /[*✱]\s*$/.test(textOf(el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null));
    if (el.tagName === 'SELECT') {
      const sel = el as HTMLSelectElement;
      const options = Array.from(sel.options).map((o) => clean(o.text)).filter((t) => !PLACEHOLDER_OPTION.test(t));
      out.push({ id: qid(), kind: 'select', label, required, options, inputType: 'select', answered: !!sel.value && !PLACEHOLDER_OPTION.test(clean(sel.selectedOptions[0]?.text)), els: [el] });
    } else if (el.getAttribute('role') === 'combobox' || el.classList.contains('select__input') || isTypeahead(el)) {
      const reactSelect = el.closest('.select__control, [class*="select__control"]') || el.closest('[class*="select-shell"]');
      const shell = el.closest('[class*="select-shell"], [class*="container"]');
      const answered = !!shell?.querySelector('[class*="single-value"], [class*="multi-value"]') || !!input.value;
      out.push({ id: qid(), kind: reactSelect ? 'combobox' : 'typeahead', label, required, options: [], inputType: 'combobox', answered, els: [el] });
    } else {
      const max = Number(el.getAttribute('maxlength')) || undefined;
      out.push({ id: qid(), kind: el.tagName === 'TEXTAREA' ? 'textarea' : 'text', label, required, options: [], inputType: type || 'text', maxLength: max, answered: !!input.value.trim(), els: [el] });
    }
  }
  return out;
}

// ---------- deciding ----------

// Diversity / protected-attribute questions: the user's own choice, never Hirivo's.
export const SENSITIVE = /\b(gender|sex|pronouns?|race|racial|ethnic(?:ity)?|hispanic|latin[oax]|veteran|disabilit(?:y|ies)|sexual orientation|lgbt\w*|transgender|religio\w*|caste|date of birth|birth ?date|marital|pregnan\w*|national origin)\b/i;
// Agreements: the user reads and accepts these themselves.
export const CONSENT = /\b(i (?:agree|consent|acknowledge|certify|confirm|understand|attest|accept)|privacy (?:policy|notice)|terms (?:and|&) conditions|terms of (?:use|service)|consent|acknowledg\w*|certif(?:y|ication)|attest\w*|true and (?:complete|correct|accurate)|background (?:check|verification)|data (?:processing|retention|protection))\b/i;
const DECLINE_OPTION = /decline|prefer not|choose not|not (?:to )?(?:say|disclose|answer|self[- ]identify)|don'?t wish|do not wish|rather not|not represented|not listed/i;

const YES = /^(yes|y|true|i am|i do|i will|i can)\b/i;
const NO = /^(no|n|false|i am not|i do not|i don't|i will not|i won't)\b/i;

// Indian college short forms, so "IIT Roorkee" matches "Indian Institute of Technology Roorkee".
const SHORT_FORMS: [RegExp, string][] = [
  [/\biiit\b/g, 'indian institute of information technology'],
  [/\biit\b/g, 'indian institute of technology'],
  [/\bnit\b/g, 'national institute of technology'],
  [/\biim\b/g, 'indian institute of management'],
  [/\bbits\b/g, 'birla institute of technology and science'],
  [/\biisc\b/g, 'indian institute of science'],
];
const norm = (s: string) => SHORT_FORMS.reduce((t, [re, long]) => t.replace(re, long), s.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ')).replace(/\s+/g, ' ').trim();

/** The option that best matches an answer, or -1. Handles yes/no, number ranges and loose text. */
export function pickOption(options: string[], answer: string): number {
  const a = norm(answer);
  if (!a) return -1;
  const opts = options.map(norm);
  let i = opts.indexOf(a);
  if (i >= 0) return i;
  // "Yes" picks a plain Yes. When the only yeses are variants ("Yes, EU Blue Card", "Yes, H-1B"),
  // choosing one would claim something the user never said, so the question is left for them.
  const yesNo = (word: 'yes' | 'no') => {
    const exact = opts.indexOf(word);
    if (exact >= 0) return exact;
    const variants = opts.map((o, k) => (new RegExp(`^${word}\\b`).test(o) ? k : -1)).filter((k) => k >= 0);
    return variants.length === 1 ? variants[0] : -1;
  };
  if (YES.test(answer.trim())) return yesNo('yes');
  if (NO.test(answer.trim())) return yesNo('no');
  const n = Number(answer.replace(/[^\d.]/g, ''));
  if (/^\s*\d+(\.\d+)?\s*(years?|yrs?)?\s*$/i.test(answer) && Number.isFinite(n)) {
    i = options.findIndex((o) => {
      const range = o.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
      if (range) return n >= Number(range[1]) && n <= Number(range[2]);
      const atLeast = o.match(/(\d+(?:\.\d+)?)\s*\+|(?:more than|over|at least)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:or more|and above)/i);
      if (atLeast) return n >= Number(atLeast[1] || atLeast[2] || atLeast[3]);
      const under = o.match(/(?:less than|under|below|<)\s*(\d+(?:\.\d+)?)/i);
      if (under) return n < Number(under[1]);
      return Number(o.match(/^\s*(\d+(?:\.\d+)?)\b/)?.[1]) === n;
    });
    if (i >= 0) return i;
  }
  i = opts.findIndex((o) => o.length > 1 && (o.startsWith(a) || a.startsWith(o)));
  if (i >= 0) return i;
  i = opts.findIndex((o) => (o.length > 2 && a.includes(o)) || (a.length > 2 && o.includes(a)));
  if (i >= 0) return i;
  const words = new Set(a.split(' ').filter((w) => w.length > 1));
  let best = -1;
  let bestShare = 0.6;
  opts.forEach((o, k) => {
    const ow = o.split(' ').filter((w) => w.length > 1);
    const share = ow.length ? ow.filter((w) => words.has(w)).length / ow.length : 0;
    if (share > bestShare) [best, bestShare] = [k, share];
  });
  return best;
}

const COUNTRIES: [string, RegExp][] = [
  ['India', /\b(india|bengaluru|bangalore|mumbai|delhi|ncr|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|kochi|jaipur|lucknow|chandigarh|indore|coimbatore)\b/i],
  ['United States', /\b(united states|usa|u\.s\.a?\.?|new york|san francisco|seattle|austin|boston|chicago|los angeles|california|texas)\b/i],
  ['United Kingdom', /\b(united kingdom|uk|england|london|manchester|edinburgh)\b/i],
  ['Canada', /\b(canada|toronto|vancouver|montreal)\b/i],
  ['Germany', /\b(germany|berlin|munich|hamburg)\b/i],
  ['France', /\b(france|paris)\b/i],
  ['Singapore', /\bsingapore\b/i],
  ['Australia', /\b(australia|sydney|melbourne)\b/i],
  ['Netherlands', /\b(netherlands|amsterdam)\b/i],
  ['Ireland', /\b(ireland|dublin)\b/i],
  ['United Arab Emirates', /\b(uae|united arab emirates|dubai|abu dhabi)\b/i],
  ['Japan', /\b(japan|tokyo)\b/i],
];

/** The country a location string points to, if it names exactly one. */
export function countryOf(text: string): string | undefined {
  const hits = COUNTRIES.filter(([, re]) => re.test(text)).map(([c]) => c);
  return hits.length === 1 ? hits[0] : undefined;
}

const has = (v: string | undefined | null): v is string => !!v && !!v.trim();

/** Rules that map a question to the user's saved profile. Order matters: first match wins. */
const TEXT_KINDS: QuestionKind[] = ['text', 'textarea', 'typeahead', 'combobox'];

const RULES: { test: RegExp; not?: RegExp; kinds?: QuestionKind[]; answer: (p: FillProfile, ctx: FillContext, q: Question) => string | string[] | undefined | { leave: string } }[] = [
  { test: /pronounc|phonetic/i, answer: () => ({ leave: 'Only you know how to say your name.' }) },
  { test: /\b(citizen|citizenship|permanent resident|nationality|passport)\b/i, answer: () => ({ leave: 'Answer this one yourself.' }) },
  { test: /accommodat\w*|adjustments?\b|anchor days?|in[- ]office|commit to (?:working|work)|days? (?:a|per) week in/i, answer: () => ({ leave: 'Your call: only you know what you need here.' }) },
  { test: /\b(?:employment|non[- ]?compete|non[- ]?solicit\w*|post[- ]employment) (?:agreements?|restrictions?|obligations?)\b|\bbound by\b/i, answer: () => ({ leave: 'Only you know your contract terms.' }) },
  { test: /\b(preferred|nick) ?name|name (?:you'?d|you would) (?:prefer|like)|what (?:should|would you like) (?:we|us to) call you\b/i, answer: (p) => p.firstName },
  { test: /\bfirst[\s_-]?name|given[\s_-]?name\b/i, answer: (p) => p.firstName },
  { test: /\b(last|family)[\s_-]?name|surname\b/i, answer: (p) => p.lastName },
  { test: /^(?:full )?name\??$|\bfull[\s_-]?name\b|^your (?:full )?name\b|legal name/i, not: /company|employer|school|reference|referr/i, answer: (p) => p.fullName },
  { test: /\be-?mail\b/i, not: /referr|reference/i, answer: (p) => p.email },
  { test: /^(?:mobile|phone|telephone|contact)(?: number| no\.?)?$|\bphone\b|\b(?:mobile|whatsapp|contact) (?:number|no)\b/i, not: /referr|reference|country code|app\b/i, kinds: ['text'], answer: (p) => p.phone },
  { test: /linkedin/i, kinds: ['text'], answer: (p) => p.linkedinUrl },
  { test: /github/i, kinds: ['text'], answer: (p) => p.githubUrl },
  { test: /\b(portfolio|personal (?:website|site)|website|blog|other (?:url|link))\b/i, kinds: ['text'], answer: (p) => p.portfolioUrl },
  { test: /\b(?:previously|ever|formerly|before)\b.*\b(?:work(?:ed)?|employ\w*|consult\w*|intern\w*)\b.*\b(?:at|for|with|by)\b/i, answer: (p, ctx) => (ctx.company && p.resumeText ? (p.resumeText.includes(ctx.company.toLowerCase()) ? 'Yes' : 'No') : undefined) },
  { test: /^(?:your )?(?:current|present|most recent|latest) (?:company|employer|organi[sz]ation)(?: name)?\??$|^(?:company|employer)(?: name)?$/i, kinds: TEXT_KINDS, answer: (p) => p.currentCompany },
  { test: /^(?:your )?(?:current|present|most recent|latest) (?:job )?(?:title|role|designation|position)\??$|^(?:job )?(?:title|designation)$/i, kinds: TEXT_KINDS, answer: (p) => p.currentTitle },
  { test: /\b(university|college|school|institution|alma mater)\b/i, not: /high school|degree|major|discipline|year|gpa|grade/i, answer: (p) => p.college },
  { test: /\b(highest )?(degree|qualification|education level)\b/i, not: /year|gpa|grade|university|college/i, answer: (p) => p.degree },
  { test: /\b(graduation|graduating|passing|completion) (?:year|date)|year of (?:graduation|passing)\b/i, answer: (p) => p.graduationYear },
  { test: /\b(total |overall |relevant )?(?:years? of|yrs? of) (?:professional |work |relevant |industry )?experience\b|how many years/i, not: /\b(with|in|using) [A-Za-z]/, answer: (p) => (p.yearsExperience !== undefined ? String(Math.round(p.yearsExperience)) : undefined) },
  { test: /\bnotice period|serving notice|last working day\b/i, answer: (p) => p.noticePeriod },
  { test: /\b(expected|desired|expectation|target)\b.*\b(ctc|salary|compensation|pay)\b|\bsalary expectations?\b/i, answer: (p) => p.expectedCtc },
  { test: /\b(current|present|existing)\b.*\b(ctc|salary|compensation|pay)\b|^ctc$/i, answer: (p) => p.currentCtc },
  { test: /\b(earliest|when can you|availability to|available to) (?:start|join)|start date|joining date|date of joining\b/i, answer: (p) => p.earliestStart || p.noticePeriod },
  { test: /\brelocat/i, answer: (p) => (p.willingToRelocate ? (p.willingToRelocate === 'yes' ? 'Yes' : 'No') : undefined) },
  {
    test: /\b(sponsor\w*|visa|immigration case|work permit)\b/i,
    answer: (p, ctx, q) => {
      const country = countryOf(q.label) || ctx.jobCountry;
      if (!country || !p.authorizedCountries.length) return { leave: 'Depends on where this job is; answer it yourself.' };
      return p.authorizedCountries.some((c) => c.toLowerCase() === country.toLowerCase()) ? 'No' : 'Yes';
    },
  },
  {
    test: /\b(legally )?(authori[sz]ed|eligible|permitted|right) to work\b|\bwork authori[sz]ation\b/i,
    answer: (p, ctx, q) => {
      const country = countryOf(q.label) || ctx.jobCountry;
      if (!country || !p.authorizedCountries.length) return { leave: 'Depends on where this job is; answer it yourself.' };
      return p.authorizedCountries.some((c) => c.toLowerCase() === country.toLowerCase()) ? 'Yes' : 'No';
    },
  },
  { test: /\b(country of residence|country you (?:live|reside)|current country|which country)\b|^country$/i, answer: (p) => p.country },
  { test: /\b(current )?(location|city)\b|where are you (?:based|located)|based out of/i, not: /relocat|willing|preferred|office|hub|work from/i, kinds: TEXT_KINDS, answer: (p) => p.location },
  { test: /\bhow (?:did )?you (?:hear|heard|find|found|learn|learned|come across|came across)|where did you (?:hear|find|see)|^(?:lead |candidate |application |referral )?source$/i, answer: (p, ctx) => ctx.source || p.howDidYouHear },
  { test: /\blanguages?\b/i, not: /programming|coding|scripting|framework|tech|stack|query/i, answer: (p) => (p.languages.length ? p.languages : undefined) },
  { test: /\breferr(?:ed|al)\b.*\b(by|name|employee)\b|employee who referred/i, answer: () => ({ leave: 'Only if someone really referred you.' }) },
];

const isChoice = (q: Question) => q.kind !== 'text' && q.kind !== 'textarea' && q.kind !== 'typeahead';

/** Decides one question from the profile. `{ ask: true }` means "let the AI try from the resume". */
export function decide(q: Question, p: FillProfile, ctx: FillContext): Decision {
  if (q.answered) return { leave: 'Already filled' };
  if (SENSITIVE.test(q.label)) {
    if (p.eeoDecline && isChoice(q)) {
      const i = q.options.findIndex((o) => DECLINE_OPTION.test(o));
      if (i >= 0 || q.kind === 'combobox') return { fill: i >= 0 ? q.options[i] : 'Decline to self-identify', source: 'profile' };
    }
    return { leave: 'Personal question: your choice to answer' };
  }
  if (CONSENT.test(q.label) || (q.kind === 'checkbox' && /\b(agree|accept|consent|confirm)\b/i.test(q.label))) return { leave: 'Read and accept this yourself' };
  for (const rule of RULES) {
    if (!rule.test.test(q.label) || rule.not?.test(q.label) || (rule.kinds && !rule.kinds.includes(q.kind))) continue;
    const a = rule.answer(p, ctx, q);
    if (a && typeof a === 'object' && !Array.isArray(a)) return a;
    if (Array.isArray(a) ? a.length : has(a)) return { fill: a!, source: 'profile' };
    // The rule knew what was asked but there's no saved answer: don't let the AI guess personal data.
    return { leave: 'Not saved in Hirivo yet (You → Profile or Application answers).' };
  }
  return { ask: true };
}

// ---------- filling ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function mark(el: HTMLElement, source: 'profile' | 'ai') {
  const target = (el.closest('[class*="select__control"]') as HTMLElement) || el;
  target.style.transition = 'box-shadow 0.3s ease';
  target.style.boxShadow = source === 'ai' ? '0 0 0 2px rgba(154, 90, 0, 0.55)' : '0 0 0 2px rgba(10, 113, 75, 0.45)';
  if (source === 'ai') target.setAttribute('title', 'Written by Hirivo from your resume. Read it before you submit.');
}

const click = (el: HTMLElement) => {
  for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
};

function listOptions(input: HTMLElement): HTMLElement[] {
  const listId = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
  const list = (listId && document.getElementById(listId)) || input.closest('[class*="container"], [class*="shell"]')?.parentElement || document;
  const scoped = Array.from(list.querySelectorAll<HTMLElement>('[role="option"], [class*="select__option"], [class*="-option"]')).filter((o) => textOf(o));
  return scoped.length ? scoped : Array.from(document.querySelectorAll<HTMLElement>('[role="option"], [class*="select__option"]')).filter((o) => textOf(o));
}

function typeaheadOptions(input: HTMLElement): HTMLElement[] {
  const scope = input.closest('li, [class*="field"], [class*="question"], [class*="inputContainer"]') || input.parentElement;
  const near = Array.from(scope?.querySelectorAll<HTMLElement>('[class*="dropdown-results"] > *, [role="option"], [role="listbox"] > *') || []).filter((o) => textOf(o));
  return near.length ? near : listOptions(input).filter((o) => !o.closest('[class*="select__menu"]'));
}

/** Opens a React dropdown and returns its option texts (then closes it). */
export async function readComboboxOptions(q: Question): Promise<string[]> {
  const input = q.els[0];
  const control = (input.closest('[class*="select__control"]') as HTMLElement) || input;
  click(control);
  await sleep(250);
  const texts = listOptions(input).map((o) => textOf(o)).slice(0, 200);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  (input as HTMLInputElement).blur();
  await sleep(80);
  return texts;
}

/** Fills one question. Returns false when the value didn't fit any option. */
export async function fillQuestion(q: Question, value: string | string[], source: 'profile' | 'ai'): Promise<boolean> {
  const first = Array.isArray(value) ? value[0] : value;
  switch (q.kind) {
    case 'text':
    case 'textarea': {
      const el = q.els[0] as HTMLInputElement | HTMLTextAreaElement;
      let text = Array.isArray(value) ? value.join(', ') : value;
      if (q.maxLength && text.length > q.maxLength) text = text.slice(0, q.maxLength);
      setNativeValue(el, text);
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      mark(el, source);
      return true;
    }
    case 'select': {
      const sel = q.els[0] as HTMLSelectElement;
      const opts = Array.from(sel.options).filter((o) => !PLACEHOLDER_OPTION.test(clean(o.text)));
      const i = pickOption(opts.map((o) => clean(o.text)), first);
      if (i < 0) return false;
      setNativeValue(sel, opts[i].value);
      mark(sel, source);
      return true;
    }
    case 'radio': {
      const i = pickOption(q.options, first);
      if (i < 0) return false;
      const radio = q.els[i] as HTMLInputElement;
      if (!radio.checked) radio.click();
      mark(radio.closest('label') || radio.parentElement || radio, source);
      return true;
    }
    case 'checkboxes': {
      const wanted = (Array.isArray(value) ? value : value.split(/\s*,\s*/)).map((v) => pickOption(q.options, v)).filter((i) => i >= 0);
      if (!wanted.length) return false;
      for (const i of new Set(wanted)) {
        const box = q.els[i] as HTMLInputElement;
        if (!box.checked) box.click();
        mark(box.closest('label') || box.parentElement || box, source);
      }
      return true;
    }
    case 'checkbox': {
      if (!YES.test(first)) return true; // "No" for a lone checkbox means leave it unticked
      const box = q.els[0] as HTMLInputElement;
      if (!box.checked) box.click();
      mark(box.parentElement || box, source);
      return true;
    }
    case 'yesno': {
      const i = pickOption(['Yes', 'No'], first);
      if (i < 0) return false;
      click(q.els[i]);
      mark(q.els[i].parentElement || q.els[i], source);
      return true;
    }
    case 'combobox': {
      const input = q.els[0] as HTMLInputElement;
      const control = (input.closest('[class*="select__control"]') as HTMLElement) || input;
      click(control);
      await sleep(200);
      let options = listOptions(input);
      if (!options.length) {
        setNativeValue(input, first);
        await sleep(300);
        options = listOptions(input);
      }
      const i = pickOption(options.map((o) => textOf(o)), first);
      if (i < 0) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return false;
      }
      click(options[i]);
      await sleep(100);
      mark(input, source);
      return true;
    }
    case 'typeahead': {
      const input = q.els[0] as HTMLInputElement;
      input.focus();
      setNativeValue(input, first);
      for (const type of ['keydown', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, { key: first.slice(-1), bubbles: true }));
      // Suggestions come from the site's own search; give it a moment.
      let options: HTMLElement[] = [];
      for (let t = 0; t < 12 && !options.length; t++) {
        await sleep(250);
        options = typeaheadOptions(input);
      }
      if (options.length) {
        const i = pickOption(options.map((o) => textOf(o)), first);
        click(options[Math.max(0, i)]);
        await sleep(150);
      }
      mark(input, source);
      return true;
    }
  }
}
