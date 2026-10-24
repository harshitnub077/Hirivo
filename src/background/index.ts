// Background service worker (MV3). It holds no state between wake-ups: everything lives in IndexedDB.
import { db } from '../db';
import { getSettings } from '../db/settings';
import { buildAutofillProfile } from '../services/formAutofill';
import { matchesTargets, refreshAll } from '../services/watchlist';
import { dueFollowupStage } from '../services/outreach';
import { runDiscover } from '../services/discover';
import { buildDaily5, localDayKey, nextDailyAt } from '../services/daily5';
import { GmailNeedsReconnect, pollGmailReplies } from '../services/gmail';

const RADAR_ALARM = 'radar-poll';
const FOLLOWUP_ALARM = 'followup-check';
const DISCOVER_ALARM = 'discover-run';
const DAILY_ALARM = 'daily-5';

async function ensureAlarms() {
  if (!(await chrome.alarms.get(RADAR_ALARM))) chrome.alarms.create(RADAR_ALARM, { periodInMinutes: 360, delayInMinutes: 1 });
  if (!(await chrome.alarms.get(FOLLOWUP_ALARM))) chrome.alarms.create(FOLLOWUP_ALARM, { periodInMinutes: 180, delayInMinutes: 1 });
  if (!(await chrome.alarms.get(DISCOVER_ALARM))) chrome.alarms.create(DISCOVER_ALARM, { periodInMinutes: 720, delayInMinutes: 5 });
  if (!(await chrome.alarms.get(DAILY_ALARM))) chrome.alarms.create(DAILY_ALARM, { when: nextDailyAt(), periodInMinutes: 1440 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // The old "check-replies" alarm did nothing; remove it for anyone upgrading.
  await chrome.alarms.clear('check-replies-alarm');
  await ensureAlarms();
});

chrome.runtime.onStartup.addListener(ensureAlarms);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === RADAR_ALARM) await pollWatchlist();
  if (alarm.name === FOLLOWUP_ALARM) await checkFollowups();
  if (alarm.name === DISCOVER_ALARM) await discoverInBackground();
  if (alarm.name === DAILY_ALARM) await morningShortlist();
  await updateBadge();
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

/** 8:00 local: refresh the feed if it's stale, pick today's five, send one notification. */
async function morningShortlist() {
  const settings = await getSettings();
  const lastRun = Math.max(0, ...(await db.sourceFetches.toArray()).map((f) => f.fetchedAt));
  if (settings.targetRoles?.length && Date.now() - lastRun > 6 * 3_600_000) await runDiscover().catch(() => undefined);
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
  if (!settings.targetRoles?.length) return;
  const { newTopMatches } = await runDiscover();
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
  await nudgeAfterApplying();
  const open = await db.outreach.where('status').equals('SENT').toArray();
  for (const r of open) {
    const stage = dueFollowupStage(r);
    if (stage === 0 || (r.notifiedStage ?? 0) >= stage) continue;
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
  await chrome.action.setBadgeBackgroundColor({ color: due > 0 ? '#A15C00' : '#0F7A55' });
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

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  const win = await chrome.windows.getLastFocused();
  if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'GET_AUTOFILL_PROFILE') {
    getSettings()
      .then((settings) => sendResponse({ success: true, profile: buildAutofillProfile(settings) }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
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
  if (request.action === 'REFRESH_BADGE') {
    updateBadge().finally(() => sendResponse({ success: true }));
    return true;
  }
  return false;
});
