// Background Service Worker (Manifest V3)
// Ephemeral execution: All persistent state is in chrome.storage.local or IndexedDB
import { db } from '../db';
import { buildAutofillProfile } from '../services/formAutofill';

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Hirivo Extension Installed');

  // Configure Side Panel to automatically open when the user clicks the extension action icon
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  // Set recurring alarm for checking outreach replies and follow-up cadences every 4 hours
  chrome.alarms.create('check-replies-alarm', {
    periodInMinutes: 240,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'check-replies-alarm') {
    console.log('Running periodic reply and follow-up check...');
  }
});

// Relay listener for async cross-origin fetches & autofill profile delivery
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'GET_AUTOFILL_PROFILE') {
    (async () => {
      try {
        const settings = await db.settings.get('config');
        const profile = buildAutofillProfile(settings || null);
        sendResponse({ success: true, profile });
      } catch (err: any) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message channel open for async response
  }
  return true;
});
