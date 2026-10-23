// Content script for ATS application pages (Greenhouse, Lever, Ashby, Workable) only.
// It never runs on LinkedIn. It fills fields the user has saved and attaches their resume,
// never overwrites what the user typed, and never presses Submit.
// Job-page reading lives in extractJob.ts and runs only when the user clicks Analyze.

interface Profile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  college: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// Order matters: the first rule that matches a field wins.
const RULES: { key: keyof Profile; test: RegExp; not?: RegExp }[] = [
  { key: 'firstName', test: /\b(first[_\s-]?name|fname|given[_\s-]?name|preferred first)\b/ },
  { key: 'lastName', test: /\b(last[_\s-]?name|lname|family[_\s-]?name|surname)\b/ },
  { key: 'email', test: /\be-?mail\b/ },
  { key: 'phone', test: /\b(phone|mobile|tel|contact[_\s-]?number|whatsapp)\b/ },
  { key: 'linkedinUrl', test: /linkedin/ },
  { key: 'githubUrl', test: /github/ },
  { key: 'portfolioUrl', test: /\b(portfolio|website|personal[_\s-]?site|blog|other url)\b/ },
  { key: 'college', test: /\b(school|university|college|institution)\b/, not: /high school|degree|discipline|major/ },
  { key: 'location', test: /\b(current )?(location|city)\b/, not: /relocat|willing|preferred/ },
  { key: 'fullName', test: /\b(full[_\s-]?name|your name|^name)\b|^name\b/, not: /first|last|company|school|reference|employer/ },
];

const SUCCESS_TEXT = /thank you for (applying|your (application|interest))|application (has been |was )?(submitted|received)|we('ve| have) received your application/i;

function describe(el: Field): string {
  const id = el.id;
  const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '';
  const wrapLabel = el.closest('label')?.textContent || '';
  const group = el.closest('.field, .application-question, [class*="field"], [class*="question"]')?.querySelector('label, legend')?.textContent || '';
  return [el.name, id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('autocomplete'), forLabel, wrapLabel, group]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function setNativeValue(element: Field, value: string) {
  const proto = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function highlight(el: HTMLElement) {
  el.style.transition = 'box-shadow 0.3s ease';
  el.style.boxShadow = '0 0 0 2px rgba(15, 122, 85, 0.45)';
}

function fillFields(profile: Profile): number {
  let filled = 0;
  const fields = Array.from(document.querySelectorAll<Field>('input:not([type="hidden"]):not([type="submit"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'));
  for (const el of fields) {
    if (el.disabled || (el as HTMLInputElement).readOnly || el.value.trim()) continue; // never overwrite the user
    const text = describe(el);
    if (el instanceof HTMLTextAreaElement && !/linkedin|github|website|portfolio/.test(text)) continue; // free-text answers are the user's to write
    const rule = RULES.find((r) => r.test.test(text) && !(r.not && r.not.test(text)));
    const value = rule ? profile[rule.key] : '';
    if (!value) continue;
    setNativeValue(el, value);
    highlight(el);
    filled++;
  }
  return filled;
}

function base64ToFile(b64: string, name: string, type: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}

function attachResume(file: File): boolean {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  const target =
    inputs.find((i) => /resume|cv\b|curriculum/.test(describe(i)) && !/cover/.test(describe(i))) ||
    (inputs.length === 1 && !/cover/.test(describe(inputs[0])) ? inputs[0] : undefined);
  if (!target || (target.files && target.files.length > 0)) return false;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  target.files = transfer.files;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

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
    background: '#0f7a55',
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
  if (!reported && SUCCESS_TEXT.test(document.body.innerText.slice(0, 5000))) {
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
