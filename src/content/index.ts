// Content script for ATS application pages only (Greenhouse, Lever, Ashby, Workable, Workday,
// SmartRecruiters, iCIMS, Recruitee, BambooHR, Keka, Darwinbox, Zoho Recruit, Freshteam).
// It never runs on LinkedIn. "Fill with Hirivo" answers every question it can: saved profile
// answers first, then answers written from the resume by the user's own AI key for the open
// questions. It never overwrites what the user typed, never ticks consent boxes, never answers
// diversity questions for them, and never presses Submit.
// Job-page reading lives in extractJob.ts and runs only when the user clicks Analyze.

import { attachResume, base64ToFile, SUCCESS_TEXT } from './formFill';
import { countryOf, decide, fillQuestion, findQuestions, findSubmitButton, readComboboxOptions, type FillContext, type Question } from './formEngine';
import type { AskRequest, AskResponse, FillProfile } from './profileTypes';

const send = <T = any>(message: Record<string, unknown>) =>
  new Promise<T>((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (r) => resolve(r));
    } catch {
      resolve(undefined as T); // the extension was updated or reloaded; this page needs a refresh
    }
  });

// ---------- page context ----------

function pageText(selectors: string, max: number) {
  for (const sel of selectors.split(',')) {
    const el = document.querySelector<HTMLElement>(sel.trim());
    const t = el && !el.closest('form') ? (el.innerText || el.textContent || '').trim() : '';
    if (t) return t.slice(0, max);
  }
  return '';
}

function jobContext() {
  const t = document.title.trim();
  let title = t.match(/^Job Application for (.+?) at /)?.[1] || t.match(/^(.+?) @ /)?.[1] || '';
  let company = t.match(/ at ([^|–-]+?)\s*$/)?.[1] || t.match(/ @ ([^|–-]+?)\s*$/)?.[1] || '';
  if (!company && / - /.test(t)) {
    // Lever: "Palantir Technologies - Administrative Business Partner"
    const [a, ...rest] = t.split(' - ');
    company = a;
    title ||= rest.join(' - ');
  }
  title ||= pageText('h1, h2', 160);
  const location = pageText('.job__location, .posting-categories .location, [class*="job-location"], [class*="location"]', 200);
  const description = pageText('.job__description, [class*="job-description"], [class*="jobDescription"], .posting-page .section-wrapper, [class*="description"], main', 4500);
  return { title: title.trim(), company: company.replace(/\s*(careers|jobs)$/i, '').trim(), location, description };
}

// ---------- results card ----------

type Item = { q: Question; note?: string };
interface Report {
  profile: Item[];
  ai: Item[];
  left: Item[];
  pendingAi: Question[];
  resume?: 'attached' | 'missing';
  coverLetterFile?: boolean;
  status?: string;
  error?: string;
}

const CARD_CSS = `
:host { all: initial; }
.card { position: fixed; right: 20px; top: 20px; width: 340px; max-height: calc(100vh - 120px); display: flex; flex-direction: column; z-index: 2147483647;
  background: #121715; color: #e6ece8; border: 1px solid #222b27; border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.45);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
.head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #222b27; }
.brand { font-weight: 600; letter-spacing: -.01em; }
.brand b { color: #4bc994; }
.head .sum { margin-left: auto; color: #b9c4be; font-variant-numeric: tabular-nums; }
.card.min .body, .card.min .foot { display: none; }
.x { background: none; border: 0; color: #8d9a93; font-size: 18px; cursor: pointer; padding: 0 2px; line-height: 1; }
.body { overflow: auto; padding: 10px 14px 4px; }
h4 { margin: 10px 0 6px; font-size: 12px; font-weight: 600; color: #b9c4be; display: flex; align-items: center; gap: 6px; }
h4 i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
ul { list-style: none; margin: 0; padding: 0; }
li { padding: 6px 8px; margin: 0 -8px; border-radius: 6px; cursor: pointer; }
li:hover { background: #171d1a; }
li .q { display: block; color: #e6ece8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
li .why { display: block; color: #8d9a93; font-size: 12px; }
.status { color: #e9b44c; margin: 6px 0; }
.err { color: #f07a66; margin: 6px 0; }
.foot { padding: 10px 14px 12px; border-top: 1px solid #222b27; display: flex; flex-direction: column; gap: 8px; }
.foot p { margin: 0; color: #8d9a93; font-size: 12px; }
button.primary { background: #4bc994; color: #0b0e0d; border: 0; border-radius: 8px; padding: 8px 12px; font: 600 13px system-ui, sans-serif; cursor: pointer; }
button.primary[disabled] { opacity: .6; cursor: default; }
button.link { background: none; border: 0; padding: 0; color: #8d9a93; font: 12px system-ui, sans-serif; text-align: left; cursor: pointer; text-decoration: underline; }
`;

let host: HTMLElement | null = null;
let minimised = false;

function render(report: Report, onWrite: () => void) {
  if (!host) {
    host = document.createElement('div');
    host.id = 'hirivo-fill-report';
    host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }
  const root = host.shadowRoot!;
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = CARD_CSS;
  root.appendChild(style);

  const total = report.profile.length + report.ai.length + report.left.length + report.pendingAi.length;
  const done = report.profile.length + report.ai.length;
  const card = el('div', minimised ? 'card min' : 'card');
  const head = el('div', 'head');
  const brand = el('span', 'brand');
  brand.innerHTML = '<b>h</b>irivo';
  head.append(brand, el('span', 'sum', `Filled ${done} of ${total}`));
  // Top right, so it never covers the Submit button; minimise it to see the form underneath.
  const min = el('button', 'x', minimised ? '▾' : '–') as HTMLButtonElement;
  min.title = minimised ? 'Show details' : 'Minimise';
  min.onclick = () => {
    minimised = !minimised;
    render(report, onWrite);
  };
  const x = el('button', 'x', '×') as HTMLButtonElement;
  x.title = 'Close';
  x.onclick = () => {
    host?.remove();
    host = null;
  };
  head.append(min, x);
  card.appendChild(head);

  const body = el('div', 'body');
  if (report.status) body.appendChild(el('div', 'status', report.status));
  if (report.error) body.appendChild(el('div', 'err', report.error));
  section(body, 'Written from your resume: read these', '#e9b44c', report.ai);
  section(body, 'Left for you', '#f07a66', [
    ...report.left,
    ...(report.resume === 'missing' ? [{ q: { label: 'Resume' } as Question, note: 'Upload your resume in Hirivo to attach it here.' }] : []),
    ...(report.coverLetterFile ? [{ q: { label: 'Cover letter file' } as Question, note: 'Optional. Write one in Hirivo → Now → Answers.' }] : []),
  ]);
  section(body, 'Filled from your profile', '#4bc994', report.profile, true);
  card.appendChild(body);

  const foot = el('div', 'foot');
  if (report.pendingAi.length) {
    const b = el('button', 'primary', report.status ? 'Writing…' : `Write ${report.pendingAi.length} answer${report.pendingAi.length === 1 ? '' : 's'} from my resume`) as HTMLButtonElement;
    b.disabled = Boolean(report.status);
    b.onclick = onWrite;
    foot.appendChild(b);
  }
  const again = el('button', 'link', 'Fill this page again (for the next step of a form)') as HTMLButtonElement;
  again.onclick = () => fillAll({ withAi: true });
  foot.append(el('p', '', 'Nothing has been submitted. Check every answer, then press Submit yourself.'), again);
  card.appendChild(foot);
  root.appendChild(card);
}

function el(tag: string, cls: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function section(body: HTMLElement, title: string, color: string, items: Item[], collapsed = false) {
  if (!items.length) return;
  const h = el('h4', '');
  const dot = el('i', '');
  dot.style.background = color;
  h.append(dot, `${title} (${items.length})`);
  body.appendChild(h);
  const ul = el('ul', '');
  for (const item of collapsed ? items.slice(0, 4) : items) {
    const li = el('li', '');
    li.append(el('span', 'q', item.q.label || 'Untitled question'));
    if (item.note) li.append(el('span', 'why', item.note));
    const target = item.q.els?.[0];
    if (target) {
      li.onclick = () => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (target as HTMLElement).focus?.({ preventScroll: true });
      };
    }
    ul.appendChild(li);
  }
  if (collapsed && items.length > 4) ul.appendChild(el('li', 'why', `and ${items.length - 4} more`));
  body.appendChild(ul);
}

// ---------- filling ----------

let running = false;
let lastReport: Report | null = null;

async function fillAll({ withAi }: { withAi: boolean }): Promise<Report | undefined> {
  if (running) return;
  running = true;
  try {
    const res = await send<{ profile?: FillProfile; source?: string }>({ action: 'GET_FILL_PROFILE', url: location.href });
    if (!res?.profile) return;
    if (!res.profile.email && !res.profile.fullName) {
      // Nothing to fill with yet: say so once instead of listing every field as missing.
      render({ profile: [], ai: [], left: [], pendingAi: [], error: 'Set up Hirivo first: upload your resume in the Hirivo side panel, then press “Fill this page again”.' }, () => undefined);
      return;
    }
    const job = jobContext();
    const ctx: FillContext = { company: job.company, jobCountry: countryOf(job.location), source: res.source };
    const report: Report = { profile: [], ai: [], left: [], pendingAi: [] };

    for (const q of findQuestions()) {
      if (q.kind === 'combobox' && !q.answered) q.options = await readComboboxOptions(q);
      const d = decide(q, res.profile, ctx);
      if ('fill' in d) {
        if (await fillQuestion(q, d.fill, 'profile')) report.profile.push({ q });
        else report.left.push({ q, note: `Pick this one yourself: “${[d.fill].flat().join(', ')}” matches none, or several, of its options.` });
      } else if ('leave' in d) {
        if (d.leave !== 'Already filled') report.left.push({ q, note: d.leave });
      } else report.pendingAi.push(q);
    }

    const file = await send<{ name?: string; type?: string; base64?: string }>({ action: 'GET_RESUME_FILE' });
    const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    if (file?.base64 && file.name) {
      if (attachResume(base64ToFile(file.base64, file.name, file.type || 'application/pdf'))) report.resume = 'attached';
    } else if (fileInputs.length) report.resume = 'missing';
    report.coverLetterFile = fileInputs.some((i) => /cover/i.test(`${i.name} ${i.id} ${i.closest('div')?.textContent || ''}`) && !i.files?.length);

    lastReport = report;
    render(report, () => writeAnswers(report, job));
    if (withAi && report.pendingAi.length) await writeAnswers(report, job, true);
    return report;
  } finally {
    running = false;
  }
}

async function writeAnswers(report: Report, job: ReturnType<typeof jobContext>, alreadyRunning = false) {
  if (running && !alreadyRunning) return;
  running = true;
  const pending = report.pendingAi;
  report.status = `Writing ${pending.length} answer${pending.length === 1 ? '' : 's'} from your resume…`;
  report.error = undefined;
  render(report, () => writeAnswers(report, job));
  try {
    const request: AskRequest = {
      job: { title: job.title, company: job.company, url: location.href, description: job.description },
      questions: pending.map((q) => ({ id: q.id, kind: q.kind, label: q.label, options: q.options, maxLength: q.maxLength })),
    };
    const res = await send<AskResponse>({ action: 'FORM_ANSWERS', request });
    if (!res || res.error) {
      report.error = res?.error || 'Hirivo could not reach your AI key. Try again.';
      return;
    }
    report.pendingAi = [];
    for (const q of pending) {
      const a = res.answers[q.id];
      if (a === null || a === undefined || (Array.isArray(a) && !a.length)) report.left.push({ q, note: "Your resume doesn't answer this one, so it's yours." });
      else if (await fillQuestion(q, a, 'ai')) report.ai.push({ q, note: typeof a === 'string' && a.length > 60 ? `${a.slice(0, 80)}…` : [a].flat().join(', ') });
      else report.left.push({ q, note: 'Hirivo’s answer didn’t match the options.' });
    }
  } finally {
    report.status = undefined;
    if (!alreadyRunning) running = false;
    render(report, () => writeAnswers(report, job));
  }
}

// ---------- page wiring ----------

function hasApplicationForm() {
  return Boolean(document.querySelector('input[type="email"], input[name*="email" i], input[type="file"]'));
}

function addButton() {
  if (document.getElementById('hirivo-float-trigger') || !hasApplicationForm()) return;
  const btn = document.createElement('button');
  btn.id = 'hirivo-float-trigger';
  btn.type = 'button';
  btn.textContent = 'Fill with Hirivo';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    background: '#0a714b',
    color: '#ffffff',
    border: '0',
    borderRadius: '9999px',
    padding: '9px 16px',
    font: '500 13px system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(14, 17, 22, 0.2)',
    zIndex: '2147483646',
  });
  btn.addEventListener('click', () => {
    btn.remove();
    fillAll({ withAi: true });
  });
  document.body.appendChild(btn);
}

// Wait for single-page forms (Ashby, Lever) to render. With autofill on, fill the profile answers
// once on open and offer the AI answers as a button (they use the user's AI quota).
let autoFilled = false;
let reported = false;
let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    tick();
  }, 500);
});
async function tick() {
  // A confirmation page has no application form left on it; a job page that merely says
  // "applications received on a rolling basis" still has one.
  if (!reported && !hasApplicationForm() && SUCCESS_TEXT.test(document.body.innerText.slice(0, 5000))) {
    reported = true;
    send({ action: 'APPLICATION_SUBMITTED', url: location.href, title: document.title });
  }
  if (!hasApplicationForm() || host) return;
  if (autoFilled) return addButton();
  autoFilled = true;
  const settings = await send<{ autoFill?: boolean }>({ action: 'GET_AUTOFILL_SETTINGS' });
  if (settings?.autoFill) setTimeout(() => fillAll({ withAi: false }), 800);
  else addButton();
}
observer.observe(document.documentElement, { childList: true, subtree: true });
tick();

// ---------- Autopilot: fill, check, submit ----------

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const visible = (el: Element) => {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  return !!r && r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== 'hidden';
};

function captchaShowing(): boolean {
  return Array.from(document.querySelectorAll('iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com"], iframe[title*="challenge" i]')).some(visible);
}

function formErrors(): string {
  const errs = Array.from(document.querySelectorAll('[role="alert"], [class*="error"]:not(input), [aria-live="assertive"]'))
    .filter(visible)
    .map((e) => (e.textContent || '').trim())
    .filter((t) => t && t.length < 200);
  return Array.from(new Set(errs)).slice(0, 3).join(' ');
}

async function autopilotFill(submit: boolean) {
  for (let i = 0; i < 120 && running; i++) await pause(500); // let an on-open fill finish first
  const report = await fillAll({ withAi: true });
  if (!report) return { status: 'failed', filled: 0, written: 0, left: [], error: 'Hirivo has no profile to fill with yet' };
  const left = report.left.map((i) => ({ label: i.q.label, note: i.note, required: Boolean(i.q.required) }));
  const requiredFile = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).some((f) => f.required && !f.files?.length);
  if (report.resume === 'missing' && requiredFile) left.push({ label: 'Resume', note: 'Upload your resume in Hirivo', required: true });
  // Count what's answered on the page now, including what the on-open fill already did.
  const base = { filled: findQuestions().filter((q) => q.answered).length, written: report.ai.length, left };
  const blocking = left.filter((l) => l.required);
  if (blocking.length) {
    const consent = blocking.some((l) => /accept this yourself/i.test(l.note || ''));
    return { ...base, status: 'needs-you', needs: consent ? 'Tick the consent box (only you can agree to it), then press Submit' : `Answer ${blocking.length} required question${blocking.length === 1 ? '' : 's'}, then press Submit` };
  }
  if (!submit) return { ...base, status: 'ready' };
  const button = findSubmitButton();
  if (!button) return { ...base, status: 'needs-you', needs: 'Press Submit' };
  const before = location.href;
  button.click();
  for (let i = 0; i < 40; i++) {
    await pause(500);
    if (SUCCESS_TEXT.test(document.body.innerText.slice(0, 5000)) || (location.href !== before && /confirm|thank|success|submitted/i.test(location.href))) {
      return { ...base, status: 'submitted' };
    }
    if (captchaShowing()) return { ...base, status: 'needs-you', needs: 'Solve the CAPTCHA, then press Submit' };
  }
  const errors = formErrors();
  return { ...base, status: 'needs-you', needs: errors ? `The form says: ${errors}` : 'Check the form and press Submit' };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'AUTOPILOT_FILL') {
    autopilotFill(Boolean(request.submit)).then(sendResponse, (err) => sendResponse({ status: 'failed', filled: 0, written: 0, left: [], error: err?.message || String(err) }));
    return true;
  }
  if (request.action === 'EXECUTE_AUTOFILL') {
    fillAll({ withAi: true }).then(() => sendResponse({ success: true, filled: lastReport ? lastReport.profile.length + lastReport.ai.length : 0 }));
    return true;
  }
  return false;
});
