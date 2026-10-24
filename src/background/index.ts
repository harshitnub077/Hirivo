// Background service worker (MV3). It holds no state between wake-ups: everything lives in IndexedDB.
import { db } from '../db';
import { getSettings } from '../db/settings';
import { buildFillProfile, sourceForUrl } from '../services/formAutofill';
import { answerFormQuestions } from '../services/formAnswers';
import { matchesTargets, refreshAll } from '../services/watchlist';
import { dueFollowupStage } from '../services/outreach';
import { buildDaily5, localDayKey, nextDailyAt } from '../services/daily5';
import { createDraft, draftFollowupInThread, GmailNeedsReconnect, gmailConnected, pollGmailReplies, sendDraft } from '../services/gmail';
import { followupText, markFollowupSent } from '../services/outreach';
import { resumeAttachment } from '../services/multiOutreach';
import { extractJobFromPage } from '../content/extractJob';
import { extractJobListFromPage } from '../content/extractJobList';
import type { ApplyReport } from '../services/autopilot/run';

const RADAR_ALARM = 'radar-poll';
const FOLLOWUP_ALARM = 'followup-check';
const DISCOVER_ALARM = 'discover-run';
const DAILY_ALARM = 'daily-5';
const AUTOPILOT_ALARM = 'autopilot';

async function ensureAlarms() {
  if (!(await chrome.alarms.get(RADAR_ALARM))) chrome.alarms.create(RADAR_ALARM, { periodInMinutes: 360, delayInMinutes: 1 });
  if (!(await chrome.alarms.get(FOLLOWUP_ALARM))) chrome.alarms.create(FOLLOWUP_ALARM, { periodInMinutes: 180, delayInMinutes: 1 });
  // Saved search: every 2 hours, so new postings are seen while they're fresh.
  if ((await chrome.alarms.get(DISCOVER_ALARM))?.periodInMinutes !== 120) chrome.alarms.create(DISCOVER_ALARM, { periodInMinutes: 120, delayInMinutes: 3 });
  if (!(await chrome.alarms.get(DAILY_ALARM))) chrome.alarms.create(DAILY_ALARM, { when: nextDailyAt(), periodInMinutes: 1440 });
  if (!(await chrome.alarms.get(AUTOPILOT_ALARM))) chrome.alarms.create(AUTOPILOT_ALARM, { periodInMinutes: 5, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // The old "check-replies" alarm did nothing; remove it for anyone upgrading.
  await chrome.alarms.clear('check-replies-alarm');
  await ensureAlarms();
});

chrome.runtime.onStartup.addListener(ensureAlarms);

const JOBS: Record<string, () => Promise<void>> = {
  [RADAR_ALARM]: pollWatchlist,
  [FOLLOWUP_ALARM]: checkFollowups,
  [DISCOVER_ALARM]: discoverInBackground,
  [DAILY_ALARM]: morningShortlist,
  [AUTOPILOT_ALARM]: startAutopilot,
};

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // A failing feed or a network blip must not stop the badge, or the next alarm, from running.
  try {
    await JOBS[alarm.name]?.();
  } catch (err) {
    console.warn(`Hirivo: ${alarm.name} failed`, err);
  }
  await updateBadge().catch(() => undefined);
});

async function pollWatchlist() {
  const settings = await getSettings();
  const fresh = await refreshAll();
  const relevant = fresh.filter(({ role }) => matchesTargets(role.title, settings.targetRoles));
  if (!settings.earlyBirdAlerts || relevant.length === 0) return;

  const first = relevant[0];
  chrome.notifications.create(`radar:${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: relevant.length === 1 ? `New role at ${first.company.name}` : `${relevant.length} new roles on your watchlist`,
    message:
      relevant.length === 1
        ? `${first.role.title}${first.role.location ? ` · ${first.role.location}` : ''}. Applying early helps.`
        : relevant
            .slice(0, 3)
            .map(({ company, role }) => `${company.name}: ${role.title}`)
            .join('\n'),
    priority: 1,
  });
}

/** 8:00 local: refresh the feed if it's stale, then pick today's five (when the search finishes). */
async function morningShortlist() {
  const settings = await getSettings();
  const lastRun = Math.max(0, ...(await db.sourceFetches.toArray()).map((f) => f.fetchedAt));
  if (settings.targetRoles?.length && Date.now() - lastRun > 6 * 3_600_000) return startSearch('daily');
  await sendDaily5();
}

async function sendDaily5() {
  const settings = await getSettings();
  const { picks } = await buildDaily5();
  if (!settings.earlyBirdAlerts || picks.length === 0) return;
  chrome.notifications.create(`daily5:${localDayKey()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: picks.length === 5 ? 'Your 5 for today' : `Your ${picks.length} for today`,
    message: picks
      .slice(0, 3)
      .map((p) => `${p.company}: ${p.title}`)
      .join('\n'),
    priority: 1,
  });
}

async function discoverInBackground() {
  const settings = await getSettings();
  if (!settings.targetRoles?.length && !settings.chosenRoles?.length) return;
  await startSearch('alert');
}

/** Searches run in the offscreen document: the job sites need an HTML parser the worker lacks. */
async function startSearch(reason: 'alert' | 'daily') {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ target: 'offscreen', action: 'SEARCH_RUN', reason }).catch(() => undefined);
}

async function searchDone(reason: 'alert' | 'daily', newTopMatches: { title: string; company: string }[]) {
  if (reason === 'daily') return sendDaily5();
  const settings = await getSettings();
  if (!settings.earlyBirdAlerts || newTopMatches.length === 0) return;
  const top = newTopMatches[0];
  chrome.notifications.create(`discover:${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: newTopMatches.length === 1 ? `Strong match: ${top.title}` : `${newTopMatches.length} strong new matches`,
    message: newTopMatches
      .slice(0, 3)
      .map((j) => `${j.company}: ${j.title}`)
      .join('\n'),
    priority: 1,
  });
}

/** A week after applying with no outreach logged, suggest messaging someone on the team. Once per job. */
async function nudgeAfterApplying() {
  const week = 7 * 86_400_000;
  const applied = await db.discovered.where('status').equals('applied').toArray();
  const contacted = new Set((await db.outreach.toArray()).map((r) => r.companyName.toLowerCase()));
  const due = applied.filter((j) => j.appliedAt && Date.now() - j.appliedAt >= week && !j.nudgedAt && !contacted.has(j.company.toLowerCase()));
  for (const j of due.slice(0, 3)) {
    chrome.notifications.create(`nudge:${j.id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `No word from ${j.company}?`,
      message: `You applied for ${j.title} a week ago. A short note to someone on the team helps your application get read. Open the job and press Analyze, then People.`,
      priority: 1,
    });
    await db.discovered.update(j.id, { nudgedAt: Date.now() });
  }
}

/** Gmail power mode: mark replies first, so nobody gets a follow-up reminder for a thread that was answered. */
async function checkGmailReplies() {
  const before = (await getSettings()).gmail;
  if (!before || before.needsReconnect) return;
  try {
    for (const { record } of await pollGmailReplies()) {
      chrome.notifications.create(`reply:${record.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `${record.recipientName} replied`,
        message: `About ${record.jobTitle} at ${record.companyName}. Follow-ups stopped; your interview pack is one click away in Pipeline.`,
        priority: 2,
      });
    }
  } catch (err) {
    if (err instanceof GmailNeedsReconnect) {
      chrome.notifications.create('gmail-reconnect', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Reconnect Gmail',
        message: 'Hirivo can’t check your replies until you reconnect Gmail (You → Gmail).',
        priority: 1,
      });
    }
  }
}

async function checkFollowups() {
  await checkGmailReplies();
  await nudgeAfterApplying().catch(() => undefined);
  const open = await db.outreach.where('status').equals('SENT').toArray();
  const settings = await getSettings();
  const autoSend = Boolean(settings.autopilot?.enabled && settings.autopilot.sendEmails && (await gmailConnected()));
  for (const r of open) {
    const stage = dueFollowupStage(r);
    if (stage === 0 || (r.notifiedStage ?? 0) >= stage) continue;
    // Autopilot's own emails get their follow-ups sent in the same thread; replies stop them first.
    if (autoSend && r.autopilot && r.gmailThreadId) {
      try {
        const note = followupText(r, stage, settings.userFullName).body.split('\n\n---\n')[0];
        const d = await draftFollowupInThread(r, note);
        await sendDraft(d.draftId);
        await markFollowupSent(r, stage);
        continue;
      } catch {
        /* fall back to the reminder below */
      }
    }
    chrome.notifications.create(`followup:${r.id}:${stage}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: stage === 1 ? `Time to follow up with ${r.recipientName}` : `Last follow-up for ${r.companyName}`,
      message: `${r.jobTitle} at ${r.companyName}. Your follow-up is ready in Hirivo → Pipeline.`,
      priority: 1,
    });
    await db.outreach.update(r.id, { notifiedStage: stage });
  }
}

async function updateBadge() {
  const [open, companies] = await Promise.all([db.outreach.where('status').equals('SENT').toArray(), db.watchlist.toArray()]);
  const due = open.filter((r) => dueFollowupStage(r) > 0).length;
  const fresh = companies.reduce((n, c) => n + c.newRoleIds.length, 0);
  const count = due + fresh;
  await chrome.action.setBadgeBackgroundColor({ color: due > 0 ? '#9A5A00' : '#0A714B' });
  await chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '' });
}

async function resumeAsBase64() {
  const file = await db.resumeFiles.get('primary');
  if (!file) return {};
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: file.name, type: file.type, base64: btoa(binary) };
}

/** Marks the job the user opened from Discover as applied when its board shows a success page. */
async function markApplied(pageUrl: string) {
  const applying = await db.discovered.where('status').equals('applying').toArray();
  if (applying.length === 0) return;
  const boardKey = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.hostname.replace(/^(job-boards|boards)\./, '')}/${url.pathname.split('/').filter(Boolean)[0] || ''}`;
    } catch {
      return '';
    }
  };
  const key = boardKey(pageUrl);
  const match = applying.find((j) => boardKey(j.url) === key) || (applying.length === 1 ? applying[0] : undefined);
  if (match) await db.discovered.update(match.id, { status: 'applied', appliedAt: Date.now() });
}

// ---------- Autopilot ----------

/** Starts (or nudges) the offscreen runner when there's work and Autopilot is on. */
async function startAutopilot() {
  const s = await getSettings();
  if (!s.autopilot?.enabled) return;
  const pending = await db.autopilot.where('status').anyOf('queued', 'working').count();
  if (!pending) return;
  await ensureOffscreen();
  chrome.runtime.sendMessage({ target: 'offscreen', action: 'AP_RUN' }).catch(() => undefined);
}

async function ensureOffscreen() {
  const exists = await (chrome.offscreen as any).hasDocument?.().catch(() => false);
  if (exists) return;
  await chrome.offscreen
    .createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.DOM_PARSER], justification: 'Reads job-site results and company websites for the saved search and Autopilot.' })
    .catch(() => undefined); // already open
  await sleep(800); // let its message listener register before the first message
}

// At most two background tabs at a time, so a search never floods the browser.
let tabsInUse = 0;
const tabWaiters: (() => void)[] = [];
async function withTabSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (tabsInUse >= 2) await new Promise<void>((r) => tabWaiters.push(r));
  tabsInUse++;
  try {
    return await fn();
  } finally {
    tabsInUse--;
    tabWaiters.shift()?.();
  }
}

/** Reads the job cards on a job-site results page in a background tab, then closes it. */
async function scrapeInTab(url: string) {
  return withTabSlot(async () => {
    const tab = await chrome.tabs.create({ url, active: false });
    try {
      await waitForLoad(tab.id!);
      await sleep(2500); // results render after load on most job sites
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: extractJobListFromPage });
      return r?.result ?? { host: new URL(url).hostname, jobs: [] };
    } finally {
      chrome.tabs.remove(tab.id!).catch(() => undefined);
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForLoad(tabId: number, timeoutMs = 30_000) {
  return new Promise<void>((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => id === tabId && info.status === 'complete' && done();
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && done(), done);
  });
}

async function readPageInTab(url: string) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id!);
    await sleep(2500); // single-page boards render after load
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: extractJobFromPage });
    return r?.result ?? null;
  } finally {
    chrome.tabs.remove(tab.id!).catch(() => undefined);
  }
}

async function applyInTab(url: string, submit: boolean): Promise<ApplyReport> {
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id!;
  await waitForLoad(tabId);
  await sleep(3000);
  let report: ApplyReport | undefined;
  for (let i = 0; i < 10 && !report; i++) {
    report = await chrome.tabs.sendMessage(tabId, { action: 'AUTOPILOT_FILL', submit }).catch(() => undefined);
    if (report) break;
    // Forms outside the built-in ATS list: load the form filler on demand (needs the any-site grant).
    if (i === 2) await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => undefined);
    await sleep(1500);
  }
  if (!report) return { status: 'failed', filled: 0, written: 0, left: [], error: 'the form page never answered', tabId };
  if (report.status === 'submitted') setTimeout(() => chrome.tabs.remove(tabId).catch(() => undefined), 5000);
  return { ...report, tabId };
}

async function sendEmail(m: { to: string; subject: string; body: string; attachResume: boolean }) {
  const attachment = m.attachResume ? await resumeAttachment() : undefined;
  const draft = await createDraft({ to: m.to, subject: m.subject, body: m.body, attachment });
  const sent = await sendDraft(draft.draftId);
  return { draftId: draft.draftId, threadId: sent.threadId || draft.threadId };
}

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  // An Autopilot job that needs one step: bring its form tab forward.
  if (id.startsWith('autopilot:')) {
    const job = await db.autopilot.get(id.split(':').slice(1, -1).join(':'));
    if (job?.tabId) {
      const tab = await chrome.tabs.update(job.tabId, { active: true }).catch(() => undefined);
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
      if (tab) return;
    }
  }
  const win = await chrome.windows.getLastFocused();
  if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'GET_FILL_PROFILE') {
    Promise.all([getSettings(), db.resumes.get('primary'), sourceForUrl(String(request.url || ''))])
      .then(([settings, resume, source]) => sendResponse({ success: true, profile: buildFillProfile(settings, resume?.rawText), source }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.action === 'FORM_ANSWERS') {
    answerFormQuestions(request.request)
      .then(sendResponse)
      .catch((err) => sendResponse({ answers: {}, error: err.message }));
    return true;
  }
  if (request.action === 'GET_AUTOFILL_SETTINGS') {
    getSettings().then((s) => sendResponse({ autoFill: s.autoFillForms !== false }));
    return true;
  }
  if (request.action === 'GET_RESUME_FILE') {
    resumeAsBase64().then(sendResponse, () => sendResponse({}));
    return true;
  }
  if (request.action === 'APPLICATION_SUBMITTED') {
    markApplied(String(request.url || '')).finally(() => sendResponse({ success: true }));
    return true;
  }
  const reply = (p: Promise<unknown>) => {
    p.then((r) => sendResponse(r ?? {}), (err) => sendResponse({ error: err?.message || String(err) }));
    return true;
  };
  if (request.action === 'AP_START') return reply(startAutopilot());
  if (request.action === 'TAB_SCRAPE') return reply(scrapeInTab(String(request.url)));
  if (request.action === 'SEARCH_DONE') return reply(searchDone(request.reason, request.newTopMatches || []));
  if (request.action === 'AP_CAN_READ') return reply(chrome.permissions.contains({ origins: ['https://*/*'] }).then((ok) => ({ ok })));
  if (request.action === 'AP_READ_PAGE') return reply(readPageInTab(String(request.url)).then((page) => ({ page })));
  if (request.action === 'AP_APPLY') return reply(applyInTab(String(request.url), Boolean(request.submit)));
  if (request.action === 'AP_SEND') return reply(sendEmail(request));
  if (request.action === 'AP_NOTIFY') {
    chrome.notifications.create(`autopilot:${request.jobId}:${Date.now()}`, { type: 'basic', iconUrl: 'icons/icon128.png', title: String(request.title), message: String(request.message), priority: 1 });
    sendResponse({});
    return false;
  }
  if (request.action === 'REFRESH_BADGE') {
    updateBadge().finally(() => sendResponse({ success: true }));
    return true;
  }
  return false;
});
