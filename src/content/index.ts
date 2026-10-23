// Content script for ATS application pages (Greenhouse, Lever, Ashby, Workable) only.
// It never runs on LinkedIn. It fills fields the user has saved, and the user always presses Submit.
// Job-page reading lives in extractJob.ts and runs only when the user clicks Analyze.

// -------------------------------------------------------------
// FORM AUTOFILL AUTOMATOR ENGINE
// -------------------------------------------------------------

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
  const prototype = Object.getPrototypeOf(element);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function executeFormAutofill(profile: any): number {
  let fieldsFilled = 0;
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input:not([type="hidden"]):not([type="submit"]), textarea, select'
  ));

  for (const input of inputs) {
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
    const aria = (input.getAttribute('aria-label') || '').toLowerCase();
    const label = input.closest('label')?.innerText.toLowerCase() || '';
    const key = `${name} ${id} ${placeholder} ${aria} ${label}`;

    // First Name
    if (/\b(first_?name|fname|given_?name)\b/.test(key) && profile.firstName) {
      setNativeValue(input, profile.firstName);
      fieldsFilled++;
      highlightField(input);
      continue;
    }

    // Last Name
    if (/\b(last_?name|lname|family_?name|surname)\b/.test(key) && profile.lastName) {
      setNativeValue(input, profile.lastName);
      fieldsFilled++;
      highlightField(input);
      continue;
    }

    // Full Name
    if (/\b(full_?name|name)\b/.test(key) && !/first|last|company|school/i.test(key) && profile.fullName) {
      setNativeValue(input, profile.fullName);
      fieldsFilled++;
      highlightField(input);
      continue;
    }

    // Email
    if (/\b(email|e-mail)\b/.test(key) && profile.email) {
      setNativeValue(input, profile.email);
      fieldsFilled++;
      highlightField(input);
      continue;
    }

    // Phone
    if (/\b(phone|mobile|tel|contact_?number)\b/.test(key) && profile.phone) {
      setNativeValue(input, profile.phone);
      fieldsFilled++;
      highlightField(input);
      continue;
    }

    // LinkedIn URL
    if (/\b(linkedin|urls\[linkedin\])\b/.test(key) && profile.linkedinUrl) {
      setNativeValue(input, profile.linkedinUrl);
      fieldsFilled++;
      highlightField(input);
      continue;
    }

    // GitHub URL
    if (/\b(github|urls\[github\])\b/.test(key) && profile.githubUrl) {
      setNativeValue(input, profile.githubUrl);
      fieldsFilled++;
      highlightField(input);
      continue;
    }

    // Portfolio / Website
    if (/\b(portfolio|website|urls\[portfolio\]|personal_?site)\b/.test(key) && profile.portfolioUrl) {
      setNativeValue(input, profile.portfolioUrl);
      fieldsFilled++;
      highlightField(input);
      continue;
    }

    // Location / City
    if (/\b(location|city|address)\b/.test(key) && profile.location) {
      setNativeValue(input, profile.location);
      fieldsFilled++;
      highlightField(input);
      continue;
    }
  }

  showAutofillToast(
    fieldsFilled > 0
      ? `Hirivo filled ${fieldsFilled} field${fieldsFilled === 1 ? '' : 's'}. Check them, then press Submit yourself.`
      : 'Nothing to fill yet. Add your details in Hirivo → You → Profile.'
  );
  return fieldsFilled;
}

function highlightField(el: HTMLElement) {
  el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
  el.style.borderColor = '#0f7a55';
  el.style.boxShadow = '0 0 0 3px rgba(15, 122, 85, 0.22)';
}

function showAutofillToast(msg: string) {
  const existing = document.getElementById('hirivo-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'hirivo-toast';
  toast.innerText = msg;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    backgroundColor: '#0e1116',
    color: '#ffffff',
    border: '1px solid #0e1116',
    borderRadius: '10px',
    padding: '12px 16px',
    fontSize: '13px',
    fontWeight: '500',
    maxWidth: '320px',
    boxShadow: '0 8px 24px rgba(14,17,22,0.25)',
    zIndex: '2147483647',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    transition: 'all 0.3s ease',
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Inject floating 1-Click Autofill Trigger button on job forms
function injectFloatingAutofillButton() {
  const isJobForm = document.querySelector('form, #application-form, .application-form, [data-qa="application-form"]');
  if (!isJobForm || document.getElementById('hirivo-float-trigger')) return;

  const btn = document.createElement('button');
  btn.id = 'hirivo-float-trigger';
  btn.textContent = 'Fill with Hirivo';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '80px',
    right: '24px',
    background: '#0f7a55',
    color: '#ffffff',
    border: '0',
    borderRadius: '9999px',
    padding: '9px 16px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(14, 17, 22, 0.2)',
    zIndex: '2147483646',
    fontFamily: 'system-ui, sans-serif',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  });

  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'GET_AUTOFILL_PROFILE' }, (response) => {
      if (response?.profile) {
        executeFormAutofill(response.profile);
      }
    });
  });

  document.body.appendChild(btn);
}

// Run detector after page load
setTimeout(injectFloatingAutofillButton, 1500);

// Listen for messages from sidepanel
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'EXECUTE_AUTOFILL') {
    const count = executeFormAutofill(request.profile);
    sendResponse({ success: true, count });
  }
  return true;
});
