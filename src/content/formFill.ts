// Pure form-filling logic for ATS application pages, kept separate so it can be tested
// against real saved forms. Imported only by the content script (keeps content.js self-contained).

export interface Profile {
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

export const SUCCESS_TEXT = /thank you for (applying|your (application|interest))|application (has been |was )?(submitted|received)|we('ve| have) received your application/i;

export function describe(el: Field): string {
  const id = el.id;
  const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '';
  const wrapping = el.closest('label')?.textContent;
  const labelledBy = (el.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .map((ref) => (ref ? document.getElementById(ref)?.textContent : ''))
    .join(' ');
  // A wrapper's label only counts when that wrapper holds this one field; section wrappers
  // label many fields and would mislabel all of them.
  let group = '';
  if (!byFor && !wrapping && !labelledBy.trim()) {
    const box = el.closest('.field, .application-question, [class*="field"], [class*="question"]');
    if (box && box.querySelectorAll('input:not([type="hidden"]), textarea, select').length === 1) {
      group = box.querySelector('label, legend')?.textContent || '';
    }
  }
  return [el.name, id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('autocomplete'), byFor, wrapping, labelledBy, group]
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

export function fillFields(profile: Profile): number {
  let filled = 0;
  const fields = Array.from(document.querySelectorAll<Field>('input:not([type="hidden"]):not([type="submit"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'));
  for (const el of fields) {
    if (el.disabled || (el as HTMLInputElement).readOnly || el.value.trim()) continue; // never overwrite the user
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-hidden') === 'true') continue; // custom dropdowns break if typed into
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

export function base64ToFile(b64: string, name: string, type: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}

export function attachResume(file: File): boolean {
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
