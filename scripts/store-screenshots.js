// scripts/store-screenshots.js
// Renders the four Chrome Web Store screenshots (1280×800) from the demo side panel.
// Each shot loads store/frame.html, which centres the panel at 400 px on the paper colour with a
// one-line caption, in headless Chrome driven over the DevTools protocol. Uses the dev server on
// port 5199 if it is running (npm run preview:panel), otherwise starts one.
// Set CHROME_PATH if Chrome is not in the usual place.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const DEBUG_PORT = 9339;
const BASE = `http://localhost:${PORT}`;

// Captions match CHROMEWEBSTORE.md. Each `ready` is checked inside the panel; `prepare` runs once it holds.
const SHOTS = [
  {
    file: 'screenshot-1-now.png',
    view: 'now',
    caption: 'Every job gets four answers: is it real, do you fit, who to ask, is it safe.',
    ready: `d.body.innerText.includes('Is it still open?')`,
  },
  {
    file: 'screenshot-2-radar.png',
    view: 'radar',
    caption: 'One search across LinkedIn, Naukri, Indeed, Internshala and more: posted time, distance and reasons.',
    ready: `d.body.innerText.includes('Search now') && !d.body.innerText.includes('Searching')`,
    prepare: `[...d.querySelectorAll('.h2')].find((e) => e.textContent.trim() === 'Search')?.closest('.card')?.scrollIntoView({ block: 'start' })`,
  },
  {
    file: 'screenshot-3-pipeline.png',
    view: 'pipeline',
    caption: 'Follow-ups on day 4 and day 9, stopped when someone replies.',
    ready: `d.body.innerText.includes('Follow up today')`,
  },
  {
    file: 'screenshot-4-you.png',
    view: 'you',
    caption: 'Your resume becomes facts, and Hirivo only claims what they say.',
    ready: `d.body.innerText.includes('FACT-01') || d.querySelectorAll('details').length > 5`,
    prepare: `[...d.querySelectorAll('details')].find((x) => x.querySelector('summary').textContent.startsWith('Resume')).open = true`,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isUp = (url) => fetch(url).then((r) => r.ok, () => false);

async function devServer() {
  if (await isUp(`${BASE}/sidepanel.html`)) return null;
  const { createServer } = await import('vite');
  const server = await createServer({ root, server: { port: PORT, strictPort: true } });
  await server.listen();
  return server;
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
}

/** Minimal DevTools protocol client over Node's built-in WebSocket. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => ws.close() };
}

/** Evaluates `expr` with `d` bound to the panel iframe's document. */
async function inPanel(cdp, expr) {
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const d = document.getElementById('panel')?.contentDocument; if (!d?.body) return false; return (${expr}); })()`,
    returnByValue: true,
  });
  return result.value;
}

async function waitFor(cdp, expr, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await inPanel(cdp, expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
}

async function main() {
  const server = await devServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hirivo-shots-'));
  const chrome = spawn(
    chromePath(),
    ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--window-size=1280,800', 'about:blank'],
    { stdio: 'ignore' }
  );
  try {
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      await sleep(200);
      const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json(), () => []);
      page = targets.find((t) => t.type === 'page');
    }
    if (!page) throw new Error('Headless Chrome did not start.');
    const cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

    fs.mkdirSync(path.join(root, 'store'), { recursive: true });
    for (const shot of SHOTS) {
      const q = new URLSearchParams({ view: shot.view, caption: shot.caption });
      await cdp.send('Page.navigate', { url: `${BASE}/store/frame.html?${q}` });
      // Discover asks live job boards, so Radar can take a while; capture what is there after 45 s.
      if (!(await waitFor(cdp, shot.ready, 45_000))) console.warn(`${shot.file}: not fully loaded, capturing anyway`);
      if (shot.prepare) await inPanel(cdp, `(${shot.prepare}, true)`);
      await sleep(1500); // let the verdict reveal and fonts settle
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 800, scale: 1 } });
      fs.writeFileSync(path.join(root, 'store', shot.file), Buffer.from(data, 'base64'));
      console.log(`store/${shot.file}`);
    }
    cdp.close();
  } finally {
    const exited = new Promise((r) => chrome.once('exit', r));
    chrome.kill();
    await exited;
    await server?.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
