// Runs in the page via chrome.scripting.executeScript when the user clicks "Save jobs from this page".
// Reads only the job cards already on screen. It never scrolls, paginates, opens or clicks anything.
// Must stay self-contained (Chrome serialises this function).

export interface ListedJob {
  title: string;
  company: string;
  location: string;
  url: string;
  posted?: string;
}

export function extractJobListFromPage(): { host: string; jobs: ListedJob[] } {
  const host = location.hostname.replace(/^www\./, '');
  const txt = (root: Element, sel: string) => {
    for (const s of sel.split('|')) {
      const el = root.querySelector(s.trim()) as HTMLElement | null;
      const v = el?.innerText?.trim().split('\n')[0];
      if (v) return v;
    }
    return '';
  };
  const abs = (href: string | null | undefined) => {
    try {
      return href ? new URL(href, location.href).toString() : '';
    } catch {
      return '';
    }
  };
  const jobs: ListedJob[] = [];
  const push = (j: ListedJob) => {
    if (j.title && j.url && !jobs.some((x) => x.url === j.url)) jobs.push(j);
  };

  if (host.endsWith('linkedin.com')) {
    for (const card of Array.from(document.querySelectorAll('li[data-occludable-job-id], .job-card-container, .base-card')).slice(0, 60)) {
      const id = card.getAttribute('data-occludable-job-id') || card.querySelector('[data-job-id]')?.getAttribute('data-job-id');
      const link = card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement | null;
      push({
        title: txt(card, '.job-card-list__title--link strong | .job-card-list__title | .base-search-card__title | a[href*="/jobs/view/"]'),
        company: txt(card, '.artdeco-entity-lockup__subtitle | .job-card-container__primary-description | .base-search-card__subtitle'),
        location: txt(card, '.job-card-container__metadata-wrapper li | .job-card-container__metadata-item | .job-search-card__location'),
        url: id ? `https://www.linkedin.com/jobs/view/${id}/` : abs(link?.getAttribute('href'))?.split('?')[0],
        posted: txt(card, 'time'),
      });
    }
  } else if (host.endsWith('naukri.com')) {
    for (const card of Array.from(document.querySelectorAll('.srp-jobtuple-wrapper, article.jobTuple, [class*="jobTuple"]')).slice(0, 60)) {
      const link = card.querySelector('a.title, a[class*="title"]') as HTMLAnchorElement | null;
      push({
        title: link?.innerText.trim() || '',
        company: txt(card, '.comp-name | [class*="comp-name"] | .subTitle'),
        location: txt(card, '.locWdth | [class*="loc"]'),
        url: abs(link?.getAttribute('href')),
        posted: txt(card, '.job-post-day | [class*="post-day"]'),
      });
    }
  } else if (host.includes('indeed.')) {
    for (const card of Array.from(document.querySelectorAll('.job_seen_beacon, [data-jk]')).slice(0, 60)) {
      const jk = card.getAttribute('data-jk') || card.querySelector('[data-jk]')?.getAttribute('data-jk');
      push({
        title: txt(card, 'h2.jobTitle span[title] | h2.jobTitle | [class*="jobTitle"]'),
        company: txt(card, '[data-testid="company-name"] | .companyName'),
        location: txt(card, '[data-testid="text-location"] | .companyLocation'),
        url: jk ? `https://${location.host}/viewjob?jk=${jk}` : abs((card.querySelector('a') as HTMLAnchorElement | null)?.getAttribute('href')),
      });
    }
  }

  // Any site that publishes schema.org JobPosting lists (Wellfound, Instahyre, many career pages).
  if (jobs.length === 0) {
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const data = JSON.parse(script.textContent || '');
        const queue = Array.isArray(data) ? [...data] : [data];
        while (queue.length) {
          const item = queue.shift();
          if (!item || typeof item !== 'object') continue;
          if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
          if (Array.isArray(item.itemListElement)) queue.push(...item.itemListElement.map((e: any) => e.item || e));
          if (item['@type'] === 'JobPosting') {
            const org = Array.isArray(item.hiringOrganization) ? item.hiringOrganization[0] : item.hiringOrganization;
            const place = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation;
            push({
              title: String(item.title || ''),
              company: String(org?.name || ''),
              location: String(place?.address?.addressLocality || (item.jobLocationType === 'TELECOMMUTE' ? 'Remote' : '')),
              url: abs(item.url) || location.href,
              posted: item.datePosted ? String(item.datePosted).slice(0, 10) : undefined,
            });
          }
        }
      } catch {
        /* skip malformed JSON-LD */
      }
    }
  }
  return { host, jobs };
}
