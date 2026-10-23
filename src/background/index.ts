// Background service worker (MV3). It holds no state between wake-ups: everything lives in IndexedDB.
import { db } from '../db';
import { getSettings } from '../db/settings';
import { buildAutofillProfile } from '../services/formAutofill';
import { matchesTargets, refreshAll } from '../services/watchlist';
import { dueFollowupStage } from '../services/outreach';
import { runDiscover } from '../services/discover';

const RADAR_ALARM = 'radar-poll';
const FOLLOWUP_ALARM = 'followup-check';
const DISCOVER_ALARM = 'discover-run';

async function ensureAlarms() {
  if (!(await chrome.alarms.get(RADAR_ALARM))) chrome.alarms.create(RADAR_ALARM, { periodInMinutes: 360, delayInMinutes: 1 });
  if (!(await chrome.alarms.get(FOLLOWUP_ALARM))) chrome.alarms.create(FOLLOWUP_ALARM, { periodInMinutes: 180, delayInMinutes: 1 });
  if (!(await chrome.alarms.get(DISCOVER_ALARM))) chrome.alarms.create(DISCOVER_ALARM, { periodInMinutes: 720, delayInMinutes: 5 });
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

async function checkFollowups() {
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
  if (request.action === 'REFRESH_BADGE') {
    updateBadge().finally(() => sendResponse({ success: true }));
    return true;
  }
  return false;
});
