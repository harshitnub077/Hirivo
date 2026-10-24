// Content script for ATS application pages only (Greenhouse, Lever, Ashby, Workable, Workday,
// SmartRecruiters, iCIMS, Recruitee, BambooHR, Keka, Darwinbox, Zoho Recruit, Freshteam).
// It never runs on LinkedIn. It fills fields the user has saved and attaches their resume,
// never overwrites what the user typed, and never presses Submit.
// Job-page reading lives in extractJob.ts and runs only when the user clicks Analyze.

import { attachResume, base64ToFile, fillFields, Profile, SUCCESS_TEXT } from './formFill';

function toast(msg: string) {
  document.getElementById('hirivo-toast')?.remove();
  const el = document.createElement('div');
  el.id = 'hirivo-toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    maxWidth: '340px',
    background: '#0e1116',
    color: '#ffffff',
    borderRadius: '10px',
    padding: '12px 16px',
    font: '500 13px/1.45 system-ui, -apple-system, sans-serif',
    boxShadow: '0 8px 24px rgba(14,17,22,0.25)',
    zIndex: '2147483647',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

const send = <T = any>(message: Record<string, unknown>) => new Promise<T>((resolve) => chrome.runtime.sendMessage(message, resolve));

async function fillAll(manual: boolean) {
  const res = await send<{ profile?: Profile }>({ action: 'GET_AUTOFILL_PROFILE' });
  if (!res?.profile) return;
  const filled = fillFields(res.profile);
  let attached = false;
  const file = await send<{ name?: string; type?: string; base64?: string }>({ action: 'GET_RESUME_FILE' });
  if (file?.base64 && file.name) attached = attachResume(base64ToFile(file.base64, file.name, file.type || 'application/pdf'));

  if (filled || attached) {
    toast(`Hirivo filled ${filled} field${filled === 1 ? '' : 's'}${attached ? ' and attached your resume' : ''}. Check the form, answer any questions, then press Submit yourself.`);
  } else if (manual) {
    toast('Nothing left to fill. Add details in Hirivo → You → Profile, or upload your resume there.');
  }
}

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
    bottom: '84px',
    right: '24px',
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
  btn.addEventListener('click', () => fillAll(true));
  document.body.appendChild(btn);
}

// Wait for single-page forms (Ashby, Lever) to render, then fill once if the user enabled it.
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
  if (!hasApplicationForm()) return;
  addButton();
  if (autoFilled) return;
  autoFilled = true;
  const { autoFill } = await send<{ autoFill?: boolean }>({ action: 'GET_AUTOFILL_SETTINGS' });
  if (autoFill) setTimeout(() => fillAll(false), 600);
}
observer.observe(document.documentElement, { childList: true, subtree: true });
tick();

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'EXECUTE_AUTOFILL') {
    fillAll(true).then(() => sendResponse({ success: true }));
    return true;
  }
  return false;
});
