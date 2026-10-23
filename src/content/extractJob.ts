// Runs inside the job page via chrome.scripting.executeScript, only when the user clicks Analyze.
// It must stay fully self-contained: Chrome serialises this function, so it cannot use imports
// or anything defined outside its own body. It only reads the page; it never clicks or edits.

export interface ExtractedJobData {
  title: string;
  company: string;
  companyDomain?: string;
  location: string;
  description: string;
  postedDate?: string;
  isReposted?: boolean;
  atsUrl?: string;
  sourceUrl: string;
  source: 'json-ld' | 'linkedin' | 'naukri' | 'generic';
}

export function extractJobFromPage(): ExtractedJobData {
  const text = (sel: string, root: ParentNode = document): string => {
    for (const s of sel.split('|')) {
      const el = root.querySelector(s.trim()) as HTMLElement | null;
      const value = el?.innerText?.trim();
      if (value) return value;
    }
    return '';
  };
  const stripHtml = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.innerText || div.textContent || '').trim();
  };
  const domainOf = (url?: string) => {
    try {
      return url ? new URL(url).hostname.replace(/^www\./, '') : undefined;
    } catch {
      return undefined;
    }
  };

  const href = location.href;
  const host = location.hostname;

  let atsUrl: string | undefined;
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (/greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com/.test(a.href)) {
      atsUrl = a.href;
      break;
    }
  }
  if (/greenhouse\.io|lever\.co|ashbyhq\.com/.test(host)) atsUrl = href;

  // 1. LinkedIn: read the open job pane only.
  if (host.endsWith('linkedin.com')) {
    const meta = text(
      '.job-details-jobs-unified-top-card__tertiary-description-container | .job-details-jobs-unified-top-card__primary-description-container | .jobs-unified-top-card__subtitle-primary-grouping'
    );
    const title = text('.job-details-jobs-unified-top-card__job-title h1 | .job-details-jobs-unified-top-card__job-title | .jobs-unified-top-card__job-title | h1');
    const description = text('#job-details | .jobs-description__content | .jobs-box__html-content');
    if (title && description) {
      const posted = meta.match(/(reposted\s+)?(\d+\s+\w+\s+ago)/i);
      return {
        title,
        company: text('.job-details-jobs-unified-top-card__company-name a | .job-details-jobs-unified-top-card__company-name | .jobs-unified-top-card__company-name'),
        location: meta.split('·')[0]?.trim() || '',
        description: description.slice(0, 12000),
        postedDate: posted?.[2],
        isReposted: /reposted/i.test(meta),
        atsUrl,
        sourceUrl: href,
        source: 'linkedin',
      };
    }
  }

  // 2. schema.org JobPosting: most job sites and career pages publish it for Google Jobs.
  const postings: any[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent || '');
      const queue = Array.isArray(data) ? [...data] : [data];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        const type = item['@type'];
        if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) postings.push(item);
      }
    } catch {
      /* malformed JSON-LD is common; skip it */
    }
  }
  if (postings.length > 0) {
    const p = postings[0];
    const org = Array.isArray(p.hiringOrganization) ? p.hiringOrganization[0] : p.hiringOrganization;
    const place = Array.isArray(p.jobLocation) ? p.jobLocation[0] : p.jobLocation;
    const address = place?.address || {};
    const remote = p.jobLocationType === 'TELECOMMUTE' ? 'Remote' : '';
    return {
      title: String(p.title || text('h1')),
      company: String(org?.name || ''),
      companyDomain: domainOf(org?.sameAs || org?.url),
      location: [address.addressLocality, address.addressRegion, address.addressCountry?.name || address.addressCountry, remote]
        .filter((x) => typeof x === 'string' && x)
        .join(', '),
      description: stripHtml(String(p.description || '')).slice(0, 12000),
      postedDate: p.datePosted ? String(p.datePosted).slice(0, 10) : undefined,
      atsUrl,
      sourceUrl: href,
      source: 'json-ld',
    };
  }

  // 3. Naukri without JSON-LD.
  if (host.endsWith('naukri.com')) {
    const title = text('h1');
    const description = text('[class*="job-desc"] | [class*="JDC"] | section[class*="description"]');
    if (title && description) {
      return {
        title,
        company: text('[class*="jd-header-comp-name"] a | [class*="comp-name"]'),
        location: text('[class*="loc"] a | [class*="location"]'),
        description: description.slice(0, 12000),
        postedDate: text('[class*="stat"] span'),
        atsUrl,
        sourceUrl: href,
        source: 'naukri',
      };
    }
  }

  // 4. Anything else: best effort from headings and Open Graph tags.
  const og = (prop: string) => document.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') || '';
  const main = document.querySelector('main, article, [class*="job-description"], [id*="job-description"]') as HTMLElement | null;
  return {
    title: text('h1') || og('og:title') || document.title,
    company: og('og:site_name'),
    companyDomain: /linkedin|naukri|indeed|wellfound|instahyre|foundit|cutshort|greenhouse|lever\.co|ashbyhq|workable/.test(host)
      ? undefined
      : domainOf(href),
    location: '',
    description: (main || document.body).innerText.slice(0, 12000).trim(),
    atsUrl,
    sourceUrl: href,
    source: 'generic',
  };
}
