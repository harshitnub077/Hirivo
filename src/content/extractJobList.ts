// Runs in the page via chrome.scripting.executeScript: when the user clicks "Save jobs from this
// page", and when Hirivo's search reads a results page in a background tab. Reads only the job cards
// already on the page. It never scrolls, paginates, opens or clicks anything.
// Must stay self-contained (Chrome serialises this function).

export interface ListedJob {
  title: string;
  company: string;
  location: string;
  url: string;
  posted?: string; // as the site shows it: "3 days ago", "Starts in 1-3 months"
  postedAt?: number; // when the site gives an exact time
  id?: string; // the site's own job id
  salary?: string;
  internship?: boolean;
  remote?: boolean;
  snippet?: string;
}

export function extractJobListFromPage(): { host: string; jobs: ListedJob[]; blocked?: string } {
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
      const tuple = card.querySelector('.cust-job-tuple') || card;
      const loc = txt(card, '.locWdth | [class*="loc"]');
      push({
        title: link?.innerText.trim() || link?.getAttribute('title') || '',
        company: txt(card, '.comp-name | [class*="comp-name"] | .subTitle'),
        location: loc,
        url: abs(link?.getAttribute('href')),
        posted: txt(card, '.job-post-day | [class*="post-day"]'),
        id: card.getAttribute('data-job-id') || undefined,
        salary: txt(card, '.sal-wrap span[title] | .sal | [class*="sal"]'),
        internship: /internship/.test(tuple.className) || /\bintern(ship)?\b/i.test(link?.innerText || ''),
        remote: /remote|work from home/i.test(loc),
        snippet: txt(card, '.job-desc | [class*="job-desc"]'),
      });
    }
  } else if (host.includes('indeed.')) {
    // Indeed embeds its result list as JSON; it's more complete than the cards (exact posting time).
    for (const script of Array.from(document.querySelectorAll('script'))) {
      const t = script.textContent || '';
      const at = t.indexOf('window.mosaic.providerData["mosaic-provider-jobcards"]');
      if (at < 0) continue;
      const start = t.indexOf('{', at);
      let depth = 0;
      let end = -1;
      let inStr = false;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (inStr) {
          if (ch === '\\') i++;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          end = i + 1;
          break;
        }
      }
      try {
        const results = JSON.parse(t.slice(start, end))?.metaData?.mosaicProviderJobCardsModel?.results || [];
        for (const r of results) {
          if (!r?.jobkey) continue;
          push({
            title: String(r.displayTitle || r.title || ''),
            company: String(r.company || ''),
            location: String(r.formattedLocation || ''),
            url: `https://${location.host}/viewjob?jk=${r.jobkey}`,
            posted: r.formattedRelativeTime,
            postedAt: typeof r.pubDate === 'number' ? r.pubDate : undefined,
            id: r.jobkey,
            salary: r.salarySnippet?.text || undefined,
            internship: Array.isArray(r.jobTypes) && r.jobTypes.some((x: string) => /intern/i.test(x)),
            remote: Boolean(r.remoteLocation) || /remote/i.test(String(r.formattedLocation || '')),
            snippet: typeof r.snippet === 'string' ? r.snippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) : undefined,
          });
        }
      } catch {
        /* fall back to the cards below */
      }
      break;
    }
    if (!jobs.length) {
      for (const card of Array.from(document.querySelectorAll('.job_seen_beacon, [data-jk]')).slice(0, 60)) {
        const jk = card.getAttribute('data-jk') || card.querySelector('[data-jk]')?.getAttribute('data-jk');
        push({
          title: txt(card, 'h2.jobTitle span[title] | h2.jobTitle | [class*="jobTitle"]'),
          company: txt(card, '[data-testid="company-name"] | .companyName'),
          location: txt(card, '[data-testid="text-location"] | .companyLocation'),
          url: jk ? `https://${location.host}/viewjob?jk=${jk}` : abs((card.querySelector('a') as HTMLAnchorElement | null)?.getAttribute('href')),
          id: jk || undefined,
        });
      }
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
  // Block pages (Akamai, Cloudflare, Google's check, login walls) look like an empty result: say so.
  const title = document.title || '';
  const head = (document.body?.innerText || '').slice(0, 600);
  const blocked =
    !jobs.length && /access denied|request blocked|you have been blocked|unusual traffic|verify you are human|captcha|attention required|are you a robot/i.test(`${title} ${head}`)
      ? title || 'blocked'
      : undefined;
  return { host, jobs, blocked };
}
