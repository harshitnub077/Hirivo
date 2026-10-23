// Content script - Non-invasive DOM extraction & 1-Click Form Autofill Automator
// Safe human-in-the-loop design: Autofills forms accurately; user clicks Submit.

export interface ExtractedJobData {
  title: string;
  company: string;
  location: string;
  description: string;
  postedDate?: string;
  isReposted?: boolean;
  atsUrl?: string;
  sourceUrl: string;
}

function extractFromLinkedIn(): ExtractedJobData | null {
  const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1');
  const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .jobs-details-top-card__company-url');
  const locationEl = document.querySelector('.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet');
  const descEl = document.querySelector('.jobs-description__content, #job-details, .jobs-box__html-content');

  const textContent = document.body.innerText;
  const isReposted = /reposted/i.test(textContent);

  let postedDate: string | undefined;
  const timeEl = document.querySelector('.jobs-unified-top-card__posted-date, time');
  if (timeEl) {
    postedDate = (timeEl as HTMLElement).innerText.trim();
  }

  let atsUrl: string | undefined;
  const applyLinks = Array.from(document.querySelectorAll('a[href]'));
  for (const a of applyLinks) {
    const href = (a as HTMLAnchorElement).href;
    if (href.includes('greenhouse.io') || href.includes('lever.co') || href.includes('ashbyhq.com') || href.includes('workable.com')) {
      atsUrl = href;
      break;
    }
  }

  if (titleEl && descEl) {
    return {
      title: (titleEl as HTMLElement).innerText.trim(),
      company: companyEl ? (companyEl as HTMLElement).innerText.trim() : 'Company',
      location: locationEl ? (locationEl as HTMLElement).innerText.trim() : '',
      description: (descEl as HTMLElement).innerText.trim(),
      postedDate,
      isReposted,
      atsUrl,
      sourceUrl: window.location.href,
    };
  }
  return null;
}

function extractFromNaukri(): ExtractedJobData | null {
  const titleEl = document.querySelector('.styles_jd-header-title__rZwM1, .styles_job-header-container h1, h1');
  const companyEl = document.querySelector('.styles_jd-header-comp-name__MvqAI a, .styles_job-header-container a');
  const locationEl = document.querySelector('.styles_jdn-header-loc__N0Wbv, .styles_loc__bxp4j');
  const descEl = document.querySelector('.styles_job-desc-container__yWkrN, .styles_Jd-components__description__nZ3oW');

  if (titleEl && descEl) {
    return {
      title: (titleEl as HTMLElement).innerText.trim(),
      company: companyEl ? (companyEl as HTMLElement).innerText.trim() : 'Company',
      location: locationEl ? (locationEl as HTMLElement).innerText.trim() : '',
      description: (descEl as HTMLElement).innerText.trim(),
      sourceUrl: window.location.href,
    };
  }
  return null;
}

function extractGenericJob(): ExtractedJobData {
  const h1 = document.querySelector('h1');
  const title = h1 ? h1.innerText.trim() : document.title;
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const ogSite = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');

  const main = document.querySelector('main, article, #job-description, .job-description, body');
  const description = main ? (main as HTMLElement).innerText.slice(0, 5000).trim() : '';

  return {
    title: ogTitle || title,
    company: ogSite || 'Target Company',
    location: '',
    description,
    sourceUrl: window.location.href,
  };
}

export function extractCurrentJobData(): ExtractedJobData {
  const host = window.location.hostname.toLowerCase();
  if (host.includes('linkedin.com')) {
    const li = extractFromLinkedIn();
    if (li) return li;
  }
  if (host.includes('naukri.com')) {
    const nk = extractFromNaukri();
    if (nk) return nk;
  }
  return extractGenericJob();
}

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

  showAutofillToast(`⚡ Hirivo Autofilled ${fieldsFilled} fields! Review & press Submit.`);
  return fieldsFilled;
}

function highlightField(el: HTMLElement) {
  el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
  el.style.borderColor = '#10b981';
  el.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.25)';
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
    backgroundColor: '#090d16',
    color: '#34d399',
    border: '1px solid #10b981',
    borderRadius: '10px',
    padding: '12px 18px',
    fontSize: '13px',
    fontWeight: '600',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
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
  btn.innerHTML = `<span style="font-weight:800; color:#38bdf8;">⚡ Hirivo</span> Autofill`;
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '80px',
    right: '24px',
    background: 'linear-gradient(135deg, #090d16 0%, #1e293b 100%)',
    color: '#ffffff',
    border: '1px solid #38bdf8',
    borderRadius: '9999px',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(56, 189, 248, 0.3)',
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
  if (request.action === 'GET_JOB_DATA') {
    const data = extractCurrentJobData();
    sendResponse({ success: true, data });
  } else if (request.action === 'EXECUTE_AUTOFILL') {
    const count = executeFormAutofill(request.profile);
    sendResponse({ success: true, count });
  }
  return true;
});
