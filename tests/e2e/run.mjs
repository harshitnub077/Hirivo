// End-to-end test of the built extension in a throwaway headless Chrome profile, with real Groq and
// Gemini keys (GROQ_API_KEY, GEMINI_API_KEY from the environment) and the fictional resume next to
// this file. Drives the real side panel: keys, resume import, Analyze, checks, Write, Open in Gmail,
// tailoring, answers, the job search and Daily 5. Nothing is sent: Gmail only opens a
// compose window (to an example.com address). Screenshots land in tests/e2e/shots/.
// Usage: npm run build && npm run test:e2e -- [jobUrl]   (needs Chrome; set CHROME_PATH if unusual)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(HERE, '../../dist');
const JOB = process.argv[2] || 'https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a';
if (!process.env.GROQ_API_KEY) throw new Error('Set GROQ_API_KEY (and optionally GEMINI_API_KEY) first.');
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 9350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hirivo-e2e-'));
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
// Job sites turn away headless Chrome's own user agent; the extension searches from a normal browser.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-blink-features=AutomationControlled', `--user-agent=${UA}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--enable-unsafe-extension-debugging', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });

const log = [];
const note = (step, ok, detail = '') => {
  log.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  — ${String(detail).slice(0, 400)}` : ''}`);
};

async function connect(ws) {
  const sock = new WebSocket(ws);
  await new Promise((res, rej) => ((sock.onopen = res), (sock.onerror = rej)));
  let id = 0; const pending = new Map(); const events = [];
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { pending.set(++id, { res, rej }); sock.send(JSON.stringify({ id, method, params })); });
  return { send, events };
}
const ev = async (c, expression, userGesture = false) => {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const targets = () => fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json(), () => []);
const errorsOf = (events) => events
  .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
  .map((e) => e.params.exceptionDetails?.exception?.description || e.params.args?.map((a) => a.value ?? a.description).join(' '));

// ---- panel helpers ----
let P; // side panel connection
const text = () => ev(P, 'document.body.innerText');
async function waitFor(pred, timeout = 60000, label = '') {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await ev(P, `(() => { const t = document.body.innerText; return (${pred}); })()`).catch(() => false)) return true;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label || pred}`);
}
async function click(label, { exact = false, within = '' } = {}) {
  const ok = await ev(P, `(() => {
    const scope = ${within ? `document.querySelector(${JSON.stringify(within)})` : 'document'};
    const els = [...scope.querySelectorAll('button, [role=button], a, summary, label')].filter(e => e.offsetParent !== null || e.tagName === 'SUMMARY');
    const want = ${JSON.stringify(label)};
    const el = els.find(e => ${exact ? 'e.innerText.trim() === want' : 'e.innerText.trim().includes(want)'});
    if (!el) return false;
    if (el.disabled) return 'disabled';
    el.scrollIntoView({ block: 'center' }); el.click(); return true;
  })()`, true);
  if (ok !== true) throw new Error(`button "${label}" ${ok === 'disabled' ? 'is disabled' : 'not found'}`);
  await sleep(400);
}
async function type(selector, value) {
  const found = await ev(P, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.offsetParent !== null); if (!el) return false; el.scrollIntoView({block:'center'}); el.focus(); el.select?.(); return true; })()`);
  if (!found) throw new Error(`no field ${selector}`);
  await P.send('Input.insertText', { text: value });
  await ev(P, `document.activeElement.blur()`);
  await sleep(300);
}
async function tab(name) {
  await ev(P, `[...document.querySelectorAll('.tabbar button')].find(b => b.innerText.includes(${JSON.stringify(name)})).click()`, true);
  await sleep(700);
}
async function shot(name) {
  const { data } = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}
async function step(name, fn) {
  try {
    const detail = await fn();
    note(name, true, detail);
  } catch (err) {
    note(name, false, err.message);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`).catch(() => undefined);
  }
}

try {
  let version;
  for (let i = 0; i < 50 && !version; i++) { await sleep(200); version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json(), () => null); }
  const browser = await connect(version.webSocketDebuggerUrl);
  const { id: extId } = await browser.send('Extensions.loadUnpacked', { path: DIST });
  let sw;
  for (let i = 0; i < 50 && !sw; i++) { await sleep(300); sw = (await targets()).find((t) => t.type === 'service_worker' && t.url.includes(extId)); }
  const BG = await connect(sw.webSocketDebuggerUrl);
  await BG.send('Runtime.enable');

  // Resume PDF from the fictional HTML resume, printed by Chrome itself.
  const blank = (await targets()).find((t) => t.type === 'page');
  const B = await connect(blank.webSocketDebuggerUrl);
  await B.send('Page.enable');
  await B.send('Page.navigate', { url: `file://${path.join(HERE, 'resume.html')}` });
  await sleep(1500);
  const pdf = await B.send('Page.printToPDF', { printBackground: true });
  const resumePath = path.join(SHOTS, 'Aarav_Mehta_Resume.pdf');
  fs.writeFileSync(resumePath, Buffer.from(pdf.data, 'base64'));

  // Open the job, then the real side panel next to it.
  await B.send('Page.navigate', { url: JOB });
  await sleep(7000);
  // sidePanel.open needs user activation, which a service worker never has: use a helper extension
  // page in its own window, with a CDP user gesture, to open the panel in the job's window.
  const jobWin = await ev(BG, `chrome.tabs.query({ url: ${JSON.stringify(JOB.replace(/\?.*$/, '') + '*')} }).then(t => t[0].windowId)`);
  await ev(BG, `chrome.windows.create({ url: 'chrome-extension://${extId}/sidepanel.html?helper', focused: false }).then(() => true)`);
  let helper;
  for (let i = 0; i < 30 && !helper; i++) { await sleep(300); helper = (await targets()).find((t) => t.url.includes('sidepanel.html?helper')); }
  const H = await connect(helper.webSocketDebuggerUrl);
  await ev(H, `chrome.sidePanel.open({ windowId: ${jobWin} }).then(() => true)`, true);
  await ev(BG, `chrome.windows.update(${jobWin}, { focused: true }).then(() => true)`);
  let panel;
  for (let i = 0; i < 30 && !panel; i++) { await sleep(300); panel = (await targets()).find((t) => t.url === `chrome-extension://${extId}/sidepanel.html`); }
  if (!panel) throw new Error('side panel did not open');
  P = await connect(panel.webSocketDebuggerUrl);
  await P.send('Runtime.enable'); await P.send('Page.enable'); await P.send('DOM.enable');
  await P.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  note('side panel opens next to the job', true, (await text()).slice(0, 120).replace(/\n+/g, ' | '));
  await shot('01-first-run');

  await step('AI keys saved and Groq key test passes', async () => {
    await tab('You');
    await type('input[placeholder="gsk_…"]', process.env.GROQ_API_KEY);
    if (process.env.GEMINI_API_KEY) await type('input[placeholder="AIza…"]', process.env.GEMINI_API_KEY);
    const saved = await ev(P, `new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('settings').objectStore('settings').get('config'); q.onsuccess = () => res([!!q.result?.groqApiKey, !!q.result?.geminiApiKey]); }; })`);
    if (!saved[0] || (process.env.GEMINI_API_KEY && !saved[1])) throw new Error(`keys saved: groq=${saved[0]} gemini=${saved[1]}`);
    await click('Test', { exact: true });
    await waitFor(`/Connected in|failed|error|invalid/i.test(t)`, 40000, 'groq test result');
    const t = await text();
    const line = t.split('\n').find((l) => /Connected in|failed|invalid/i.test(l));
    if (!/Connected in/.test(line)) throw new Error(line);
    await shot('02-keys');
    return line;
  });

  await step('resume PDF read: profile, facts and role suggestions', async () => {
    await tab('Now');
    const { root } = await P.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await P.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
    await P.send('DOM.setFileInputFiles', { nodeId, files: [resumePath] });
    await waitFor(`t.includes('Which roles should Hirivo find for you?') || t.includes('Read without AI') || /error|couldn/i.test(t)`, 120000, 'resume review');
    await shot('03-resume-review');
    const t = await text();
    const facts = t.match(/(\d+) facts/)?.[1];
    const roles = await ev(P, `[...document.querySelectorAll('.role-option b')].map(b => b.innerText)`);
    const name = /Name:\s*Aarav Mehta/.test(t), email = /aarav\.mehta\.test@example\.com/.test(t);
    if (!name || !email || !(Number(facts) >= 5) || roles.length === 0) throw new Error(`name=${name} email=${email} facts=${facts} roles=${roles}`);
    await click('Save and find jobs');
    await sleep(1500);
    return `${facts} facts; roles: ${roles.join(', ')}`;
  });

  await step('stored facts are all traceable to the resume (no invented claims)', async () => {
    const facts = await ev(P, `new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('facts').objectStore('facts').getAll(); q.onsuccess = () => res(q.result.map(f => f.id + ': ' + f.claim)); }; })`);
    const resume = fs.readFileSync(path.join(HERE, 'resume.html'), 'utf8').replace(/<[^>]+>/g, ' ').toLowerCase();
    const nums = (s) => s.match(/\d[\d,.]*/g) || [];
    const bad = facts.filter((f) => nums(f.split(': ')[1]).some((n) => !resume.includes(n.replace(/[.,]$/, ''))));
    if (bad.length) throw new Error(`figures not in resume: ${bad.join(' || ')}`);
    return facts.join(' || ');
  });

  await step('Analyze reads the live job and Run checks fills the Verdict Strip', async () => {
    await tab('Now');
    await click('Analyze this page');
    await waitFor(`t.includes('Run checks') || t.includes('Recheck')`, 30000, 'job card');
    await shot('04-analyzed');
    await click('Run checks');
    await waitFor(`t.includes('Is it still open?') && /Do you fit\\?/.test(t) && !t.includes('Checking the board')`, 180000, 'checks');
    await sleep(1500);
    await shot('05-evidence');
    const strip = await ev(P, `[...document.querySelectorAll('.verdict-strip .pill, .verdict-strip button')].map(p => p.innerText.replace(/\\n/g, ' '))`);
    const t = await text();
    const fit = t.match(/(\d+)%\s*\n?\s*(Strong fit|Partial fit|Not a fit yet)/);
    if (!fit) throw new Error(`no fit score. strip=${strip}. ${t.slice(t.indexOf('Do you fit'), t.indexOf('Do you fit') + 300)}`);
    return `strip: ${strip.join(' | ')}; ${fit[0].replace(/\n/g, ' ')}`;
  });

  await step('evidence table cites only real facts', async () => {
    const rows = await ev(P, `[...document.querySelectorAll('table tr, .evidence li, .evidence-row')].map(r => r.innerText.replace(/\\s+/g, ' ')).slice(0, 14)`);
    const job = await ev(P, `new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('jobs').objectStore('jobs').getAll(); q.onsuccess = () => res(q.result[0]); }; })`);
    const factIds = await ev(P, `new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('facts').objectStore('facts').getAllKeys(); q.onsuccess = () => res(q.result); }; })`);
    const ev2 = job.fitEvidence || [];
    const bogus = ev2.filter((e) => e.factId && e.factId !== 'SKILLS' && !factIds.includes(e.factId));
    if (!ev2.length) throw new Error('no evidence rows stored');
    if (bogus.length) throw new Error(`unknown fact ids: ${bogus.map((b) => b.factId)}`);
    const recomputed = Math.round((ev2.filter((e) => e.met).reduce((n, e) => n + (e.kind === 'must' ? 2 : 1), 0) / ev2.reduce((n, e) => n + (e.kind === 'must' ? 2 : 1), 0)) * 100);
    if (recomputed !== job.fitScore) throw new Error(`score ${job.fitScore} != table ${recomputed}`);
    return `${ev2.length} requirements, ${ev2.filter((e) => e.met).length} met, score ${job.fitScore} matches table; company=${job.company} domain=${job.companyDomain} ats=${job.atsType} ghost=${job.ghostScore} scam=${job.scamLevel} legit=${job.legitScore}`;
  });

  await step('Write: grounded email with no unsupported claims', async () => {
    await click('Write', { exact: true, within: '.seg' });
    await sleep(800);
    await type('input[placeholder="Priya Sharma"]', 'Neha Kapoor');
    await type('input[placeholder="Engineering Manager"]', 'Engineering Manager');
    await type('input[placeholder="priya@company.com"]', 'neha.kapoor@example.com');
    const typed = await ev(P, `['Priya Sharma','Engineering Manager','priya@company.com'].map(p => [...document.querySelectorAll('input[placeholder="' + p + '"]')].find(e => e.offsetParent).value)`);
    if (typed[0] !== 'Neha Kapoor') throw new Error(`recipient fields after typing: ${JSON.stringify(typed)}`);
    await click('Write my email');
    await waitFor(`t.includes('LinkedIn note') || /failed|error/i.test(t.slice(-800))`, 120000, 'draft');
    await sleep(800);
    await shot('06-write');
    const body = await ev(P, `[...document.querySelectorAll('textarea')].find(t => t.offsetParent)?.value || ''`);
    const subject = await ev(P, `[...document.querySelectorAll('input')].find(i => i.closest('label, .field')?.innerText.startsWith('Subject'))?.value || ''`);
    const t = await text();
    const unsupported = t.match(/(\d+) sentences? needs? a source/);
    const words = body.replace(/\[FACT-\d+\]/g, '').split(/\s+/).filter(Boolean).length;
    const cites = body.match(/\[FACT-\d+\]/g) || [];
    const unsupportedList = unsupported ? t.slice(t.indexOf(unsupported[0]), t.indexOf(unsupported[0]) + 600) : '';
    if (unsupported) throw new Error(`${unsupportedList}\n---\n${body}`);
    if (!cites.length) throw new Error(`no citations:\n${body}`);
    return `subject="${subject}" words=${words} cites=${cites.join(',')}\n${body}`;
  });

  await step('Open in Gmail opens a prefilled compose window and logs the outreach', async () => {
    const before = (await targets()).length;
    await click('Open in Gmail');
    // Gmail opens in a new active tab, so the panel moves off this job: wait on the database instead.
    for (let i = 0; i < 30; i++) {
      const n = await ev(P, `new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('outreach').objectStore('outreach').count(); q.onsuccess = () => res(q.result); }; })`);
      if (n > 0) break;
      await sleep(500);
    }
    await sleep(1500);
    const opened = (await targets()).filter((t) => t.type === 'page').map((t) => t.url);
    const compose = opened.find((u) => /mail\.google\.com|accounts\.google\.com/.test(u));
    if (!compose) throw new Error(`no Gmail tab among ${opened.join(', ')}`);
    const sent = await ev(P, `new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('outreach').objectStore('outreach').getAll(); q.onsuccess = () => res(q.result); }; })`);
    // Back to the job tab, as a user would; the draft should still be there and not sendable twice.
    await ev(BG, `chrome.tabs.query({ url: ${JSON.stringify(JOB.replace(/\?.*$/, '') + '*')} }).then(t => chrome.tabs.update(t[0].id, { active: true })).then(() => true)`);
    await sleep(1500);
    await click('Write', { exact: true, within: '.seg' });
    const back = await ev(P, `({ body: [...document.querySelectorAll('textarea')].find(t => t.offsetParent)?.value?.slice(0, 40) || '', btn: [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.innerText.trim()).filter(b => /Gmail|sent|Logged/i.test(b)) })`);
    await shot('06b-back-on-job');
    return `tab: ${compose.slice(0, 80)}…; logged ${sent.length} (${sent.map((o) => o.recipientName + ' <' + o.recipientEmail + '>').join(', ')}); back on job: ${JSON.stringify(back)}\nSENT BODY:\n${sent[0]?.emailBody}`;
  });

  await step('Resume tab: tailored resume adds no new claims', async () => {
    await click('Resume', { exact: true, within: '.seg' });
    const btn = await ev(P, `[...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.innerText.trim()).filter(Boolean)`);
    const tailor = btn.find((b) => /tailor/i.test(b));
    if (!tailor) throw new Error(`no tailor button; buttons: ${btn.join(' / ')}`);
    await click(tailor);
    await waitFor(`/Download|Copy|kept|reordered|reworded/i.test(t) && !/Tailoring…|Rewriting/i.test(t)`, 150000, 'tailored resume');
    await sleep(800);
    await shot('07-resume');
    const t = await text();
    const i = t.indexOf(tailor);
    return t.slice(i, i + 500).replace(/\n+/g, ' | ');
  });

  await step('Answers tab: answers an application question from facts', async () => {
    await click('Answers', { exact: true, within: '.seg' });
    await sleep(600);
    await type('textarea[placeholder="Paste the question here"]', 'Why do you want to work here?');
    const btn = await ev(P, `[...document.querySelectorAll('button.btn.primary.block')].filter(b => b.offsetParent).map(b => b.innerText.trim())[0]`);
    await click(btn);
    await waitFor(`[...document.querySelectorAll('textarea')].filter(e => e.offsetParent).length > 1 || /couldn|failed/i.test(t)`, 120000, 'answer');
    await sleep(800);
    await shot('08-answer');
    const answer = await ev(P, `[...document.querySelectorAll('textarea')].filter(e => e.offsetParent).map(e => e.value).pop()`);
    const t = await text();
    if (/Check before using/.test(t)) {
      // The user's path when the answer stretches the resume: Remove them, and what's left is clean.
      await click('Remove them');
      const left = await ev(P, `[...document.querySelectorAll('textarea')].filter(e => e.offsetParent).map(e => e.value).pop()`);
      if (/Check before using/.test(await text()) || left.trim().split(/\s+/).length < 15) throw new Error(`still flagged or gutted after Remove them:\n${left}`);
      return `flagged, then cleaned with Remove them:\n${left}`;
    }
    return answer;
  });

  await step('Pipeline shows the message; Got a reply marks it replied', async () => {
    await tab('Pipeline');
    await waitFor(`t.includes('Neha Kapoor')`, 10000, 'outreach row');
    await click('Got a reply');
    await waitFor(`t.includes('Replied')`, 10000, 'replied pill');
    await shot('09-pipeline-replied');
    return 'replied; follow-ups stop';
  });

  await step('Application answers saved in You', async () => {
    await tab('You');
    await click('Application answers');
    await sleep(400);
    const set = async (label, value) => {
      const sel = await ev(P, `(() => { const f = [...document.querySelectorAll('.field, label')].find(x => x.offsetParent && x.innerText.trim().startsWith(${JSON.stringify(label)})); const i = f && f.querySelector('input'); if (!i) return ''; i.id ||= 'e2e-' + Math.random().toString(36).slice(2); return '#' + i.id; })()`);
      if (!sel) throw new Error(`no field ${label}`);
      await type(sel, value);
    };
    await set('Country you live in', 'India');
    await set('Can work without a visa in', 'India');
    await set('Notice period', '30 days');
    await set('Earliest start', 'Within 30 days');
    await set('Current CTC', '24 LPA');
    await set('Expected CTC', '32 LPA');
    await set('Languages you speak', 'English, Hindi');
    await click('Save answers');
    await sleep(600);
    const saved = await ev(P, `new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('settings').objectStore('settings').get('config'); q.onsuccess = () => { const s = q.result; res({ company: s.currentCompany, title: s.currentTitle, degree: s.degree, year: s.graduationYear, notice: s.noticePeriod, ctc: s.currentCtc, auth: s.authorizedCountries, langs: s.languages }); }; }; })`);
    if (saved.notice !== '30 days' || saved.auth !== 'India') throw new Error(JSON.stringify(saved));
    return JSON.stringify(saved);
  });

  await step('Fill with Hirivo completes the live application form', async () => {
    const applyUrl = /lever\.co/.test(JOB) ? JOB.replace(/\/$/, '') + '/apply' : /ashbyhq\.com/.test(JOB) ? JOB.replace(/\/$/, '') + '/application' : JOB + (JOB.includes('?') ? '&' : '?') + 'hirivo_e2e=fill';
    await ev(BG, `chrome.tabs.create({ url: ${JSON.stringify(applyUrl)}, active: true }).then(() => true)`);
    let t;
    for (let i = 0; i < 30 && !t; i++) { await sleep(500); t = (await targets()).find((x) => x.type === 'page' && x.url.startsWith(applyUrl.split('?')[0]) && x.url !== JOB); }
    if (!t) t = (await targets()).filter((x) => x.type === 'page' && x.url.startsWith(applyUrl.split('?')[0])).pop();
    const F = await connect(t.webSocketDebuggerUrl);
    await F.send('Runtime.enable'); await F.send('Page.enable');
    await F.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    const card = (expr) => ev(F, `(() => { const r = document.getElementById('hirivo-fill-report')?.shadowRoot; if (!r) return null; return (${expr}); })()`);
    for (let i = 0; i < 40 && !(await card('true')); i++) await sleep(500);
    if (!(await card('true'))) throw new Error('the results card never appeared (autofill on open)');
    const before = await card(String.raw`r.querySelector('.sum').textContent`);
    const writeBtn = await card(String.raw`[...r.querySelectorAll('button.primary')].map(b => b.textContent)[0] || ''`);
    if (writeBtn) {
      await ev(F, String.raw`document.getElementById('hirivo-fill-report').shadowRoot.querySelector('button.primary').click()`, true);
      for (let i = 0; i < 240; i++) { await sleep(500); if (!(await card(String.raw`!!r.querySelector('.status')`))) break; }
    }
    await sleep(800);
    const { data } = await F.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, '12-filled-form.png'), Buffer.from(data, 'base64'));
    const report = await card(String.raw`({ sum: r.querySelector('.sum').textContent, err: r.querySelector('.err')?.textContent || '', sections: [...r.querySelectorAll('h4')].map(h => h.textContent), items: [...r.querySelectorAll('li')].map(li => li.innerText.replace(/\n/g, ' — ')) })`);
    const values = await ev(F, String.raw`[...document.querySelectorAll('input:not([type=hidden]):not([type=file]), textarea, select')].filter(e => e.offsetParent && ((e.type !== 'radio' && e.type !== 'checkbox' && e.value) || e.checked)).map(e => { const id = e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); return ((id && id.innerText) || e.name || e.id).replace(/\s+/g, ' ').slice(0, 50) + ' = ' + (e.type === 'radio' || e.type === 'checkbox' ? (e.closest('label')?.innerText || e.value) : e.tagName === 'SELECT' ? e.selectedOptions[0]?.text : e.value).replace(/\s+/g, ' ').slice(0, 120); })`);
    const chosen = await ev(F, String.raw`[...document.querySelectorAll('[class*="single-value"], button[aria-pressed="true"]')].map(e => e.innerText).slice(0, 20)`);
    const submitted = await ev(F, String.raw`/thank you for applying|application (?:has been )?submitted/i.test(document.body.innerText)`);
    if (submitted) throw new Error('the form was submitted, which must never happen');
    if (report.err) throw new Error(report.err);
    return `before AI: ${before}; button: "${writeBtn}"; after: ${report.sum}\nSECTIONS: ${report.sections.join(' | ')}\nCARD:\n  ${report.items.join('\n  ')}\nFORM VALUES:\n  ${values.join('\n  ')}\nDROPDOWNS/BUTTONS: ${chosen.join(', ')}`;
  });

  await step('Write to several people: one email each, opened in Gmail one at a time', async () => {
    await ev(BG, String.raw`chrome.tabs.query({ url: ${JSON.stringify(JOB.replace(/\?.*$/, '') + '*')} }).then(t => chrome.tabs.update(t.find(x => !/\/(apply|application)/.test(x.url)).id, { active: true })).then(() => true)`);
    await sleep(1500);
    await tab('Now');
    await click('People', { exact: true, within: '.seg' });
    await sleep(600);
    const add = async (name, role, email) => {
      await ev(P, String.raw`(() => { const d = [...document.querySelectorAll('details')].find(x => x.innerText.startsWith('Add someone')); if (d) d.open = true; })()`);
      await type('input[placeholder="Neha Kapoor"]', name);
      await type('input[placeholder="Talent Partner"]', role);
      const sel = await ev(P, String.raw`(() => { const i = [...document.querySelectorAll('input[type=email]')].find(x => x.offsetParent && /^neha@/.test(x.placeholder)); i.id ||= 'e2e-mail'; return '#' + i.id; })()`);
      await type(sel, email);
      await click('Add', { exact: true });
    };
    await add('Riya Sen', 'Talent Acquisition Partner', 'riya.sen@example.com');
    await add('Arjun Rao', 'Co-founder & CEO', 'arjun@example.com');
    await add('Kabir Shah', 'Engineering Manager', 'kabir.shah@example.com');
    const picked = await ev(P, String.raw`[...document.querySelectorAll('.reach-row')].filter(r => r.querySelector('input').checked).map(r => r.innerText.replace(/\n/g, ' '))`);
    const btn = await ev(P, String.raw`[...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.innerText.trim()).find(b => /^Write \d+ emails?$/.test(b))`);
    if (!btn) throw new Error(`no write button; picked=${picked}`);
    await click(btn);
    await waitFor(String.raw`/Open in Gmail \(1 of|Save \d+ drafts/.test(t) || /couldn|failed|error/i.test(t.slice(-500))`, 300000, 'drafts');
    await sleep(800);
    await shot('13-reach-out');
    const drafts = await ev(P, String.raw`[...document.querySelectorAll('.reach-draft')].map(d => ({ to: d.querySelector('.small').innerText, subject: d.querySelector('input').value, body: d.querySelector('textarea').value, flagged: !!d.querySelector('.callout') }))`);
    const flagged = drafts.filter((d) => d.flagged);
    const before = await ev(P, String.raw`new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('outreach').objectStore('outreach').count(); q.onsuccess = () => res(q.result); }; })`);
    await click('Open in Gmail (1 of');
    await sleep(2000);
    const after = await ev(P, String.raw`new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('outreach').objectStore('outreach').getAll(); q.onsuccess = () => res(q.result.map(o => o.recipientEmail)); }; })`);
    const compose = (await targets()).filter((x) => x.type === 'page' && /mail\.google|accounts\.google/.test(x.url)).length;
    if (after.length !== before + 1) throw new Error(`expected one more logged message, got ${before} -> ${after.length}`);
    if (flagged.length) throw new Error(`unsupported claims in: ${flagged.map((d) => d.to).join(', ')}`);
    return `picked: ${picked.join(' || ')}\nlogged after first open: ${after.join(', ')}; gmail tabs: ${compose}\n` + drafts.map((d) => `--- ${d.to}\nSubject: ${d.subject}\n${d.body}`).join('\n');
  });

  await step('Autopilot: hand over a job, it reads, checks, fills (submit off, no Gmail: nothing is sent)', async () => {
    await tab('You');
    await ev(P, String.raw`(() => { const d = [...document.querySelectorAll('details')].find(x => x.querySelector('summary')?.innerText.trim().startsWith('Autopilot')); d.open = true; d.scrollIntoView(); })()`);
    await sleep(500);
    // Never submit to a real company from a test: switch submitting off before turning Autopilot on.
    await click('Submit applications when every required question is answered');
    await click('Autopilot on');
    await sleep(500);
    const ap = await ev(P, String.raw`new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('settings').objectStore('settings').get('config'); q.onsuccess = () => res(q.result.autopilot); }; })`);
    if (!ap?.enabled || ap.submitForms) throw new Error(`autopilot settings wrong for a test: ${JSON.stringify(ap)}`);
    await ev(BG, String.raw`chrome.tabs.query({ url: ${JSON.stringify(JOB.replace(/\?.*$/, '') + '*')} }).then(t => chrome.tabs.update(t.find(x => !/hirivo_e2e|\/(apply|application)/.test(x.url)).id, { active: true })).then(() => true)`);
    await sleep(1500);
    await tab('Now');
    await click('Hand to Autopilot');
    let row;
    for (let i = 0; i < 480; i++) {
      await sleep(1000);
      row = await ev(P, String.raw`new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('autopilot').objectStore('autopilot').getAll(); q.onsuccess = () => res(q.result[0]); }; })`);
      if (row && !['queued', 'working'].includes(row.status)) break;
    }
    await tab('Pipeline');
    await sleep(800);
    await shot('14-autopilot');
    if (!row) throw new Error('nothing was queued');
    const log = row.steps.map((s) => `[${s.tone}] ${s.text}`).join('\n  ');
    if (row.status === 'done' || row.applied) throw new Error('an application was submitted from a test');
    if (!['needs-you'].includes(row.status)) throw new Error(`status ${row.status}: ${row.needs || ''}\n  ${log}`);
    return `status ${row.status}: ${row.needs}\n  ${log}`;
  });

  await step('Discover finds real jobs for the chosen roles', async () => {
    await tab('Radar');
    await waitFor(`/\\d+ matching jobs/.test(t) || (t.includes('For you') && !t.includes('Searching'))`, 240000, 'discover');
    await sleep(1000);
    await shot('10-discover');
    const t = await text();
    const count = t.match(/(\d+) matching jobs, (\d+) new/)?.[0] || t.match(/For you\s*(\d+)/)?.[0];
    const first = await ev(P, `[...document.querySelectorAll('.job-card .h2, .list-item .h2, .card .h2')].map(e => e.innerText).filter(x => !/Jobs for you|Your 5/.test(x)).slice(0, 4)`);
    const st = await ev(P, `new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('settings').objectStore('settings').get('config'); q.onsuccess = () => res({ chosenRoles: q.result.chosenRoles, search: q.result.search }); }; })`);
    const all = (store) => `new Promise(res => { const r = indexedDB.open('HirivoDB'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => res(q.result); }; })`;
    const fetches = await ev(P, all('sourceFetches'));
    const jobs = await ev(P, all('discovered'));
    const health = fetches.map((f) => `${f.id.split(':')[0]} ${f.error ? 'ERR ' + f.error.slice(0, 60) : f.count}`).join(', ');
    const sites = jobs.filter((j) => ['linkedin', 'naukri', 'indeed', 'internshala', 'unstop'].includes(j.source));
    if (!sites.length) throw new Error(`no jobs from the job sites; sources: ${health}`);
    const undated = sites.filter((j) => !j.postedAt && j.source !== 'naukri').length;
    const sample = sites.slice(0, 3).map((j) => `${j.source}: ${j.title} @ ${j.company}, ${j.location}${j.distanceKm !== undefined ? ` (${j.distanceKm} km)` : ''}`);
    return `${count}; ${sites.length} from job sites (${undated} undated); e.g. ${sample.join(' / ')}\n  sources: ${health}\n  search: ${JSON.stringify(st.search)}`;
  });

  await step('Daily 5 picks today\'s roles', async () => {
    const t0 = await text();
    if (/Pick my 5 now/.test(t0)) await click('Pick my 5 now');
    await waitFor(`/for today/.test(t) && !/Pick my 5 now/.test(t)`, 30000, 'daily 5');
    await sleep(600);
    await shot('11-daily5');
    const t = await text();
    const i = t.indexOf('for today');
    return t.slice(i - 12, i + 400).replace(/\n+/g, ' | ');
  });

  await step('no errors in the panel or background', async () => {
    const errs = [...errorsOf(P.events), ...errorsOf(BG.events)];
    if (errs.length) throw new Error(errs.slice(0, 6).join(' || '));
    return 'clean';
  });
} catch (err) {
  note('harness', false, err.stack);
} finally {
  fs.writeFileSync(path.join(SHOTS, 'log.json'), JSON.stringify(log, null, 2));
  if (log.some((l) => !l.ok)) process.exitCode = 1;
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await exited;
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
