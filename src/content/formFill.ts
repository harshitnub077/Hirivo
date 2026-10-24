// Helpers for ATS application pages: field descriptions, resume attachment and the success-page
// check. Imported only by the content script (keeps content.js self-contained).

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export const SUCCESS_TEXT =
  /thank(?:s| you) for (?:applying|your application|submitting your application)|(?:your )?application (?:has been |was )?(?:successfully )?(?:submitted|received)|we(?:'ve| have) received your application/i;

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
  // Workday and other React-heavy systems label fields with test ids like "legalNameSection_firstName".
  const automation = (el.getAttribute('data-automation-id') || el.getAttribute('data-testid') || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return [el.name, id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('autocomplete'), automation, byFor, wrapping, labelledBy, group]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
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
