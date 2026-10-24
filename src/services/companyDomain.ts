// Which website a company owns, from a URL Hirivo saw. Job boards, ATS hosts and social sites
// are never the company's own domain, and careers subdomains ("careers.acme.com",
// "acme.wd5.myworkdayjobs.com") are reduced to the registrable domain, so domain-age and
// mail checks look at the company, not at a job board or a subdomain with no mail server.

// Hosts that carry other companies' jobs or profiles. Matched on the registrable domain.
const NOT_A_COMPANY = new Set([
  'linkedin.com', 'naukri.com', 'indeed.com', 'glassdoor.com', 'glassdoor.co.in', 'wellfound.com', 'angel.co', 'instahyre.com',
  'cutshort.io', 'foundit.in', 'monster.com', 'shine.com', 'iimjobs.com', 'hirist.tech', 'hirist.com', 'internshala.com', 'apna.co',
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com', 'myworkdayjobs.com', 'workday.com', 'icims.com',
  'recruitee.com', 'bamboohr.com', 'keka.com', 'darwinbox.in', 'zohorecruit.com', 'zohorecruit.in', 'freshteam.com', 'breezy.hr',
  'jobvite.com', 'teamtailor.com', 'personio.de', 'personio.com', 'rippling.com', 'remotive.com', 'remoteok.com', 'himalayas.app',
  'jobicy.com', 'arbeitnow.com', 'ycombinator.com', 'workatastartup.com', 'wellfound.co', 'forms.gle', 'facebook.com',
  'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'github.com', 'medium.com', 'crunchbase.com', 'notion.site', 'notion.so',
  'github.io', 'vercel.app', 'netlify.app', 'herokuapp.com', 'pages.dev', 'wixsite.com', 'webflow.io', 'framer.website', 'substack.com',
]);

// Shared hosts on a real company's domain: a job "posted" as a Google Form says nothing about Google.
const SHARED_HOSTS = /^(?:docs|forms|sites|drive|groups)\.google\.com$/;

// Second-level suffixes where the registrable domain has three labels (acme.co.in).
const TWO_PART_SUFFIX = /\.(?:co|com|net|org|gov|ac|edu|firm|gen|ind|res)\.(?:in|uk|au|nz|sg|jp|za|br|mx|my|id|ph|hk|cn|tr|il|ke|ng|pk|bd|lk|np)$/;

/** "careers.acme.co.in" → "acme.co.in". Returns the input lower-cased when it is already registrable. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const labels = h.split('.');
  const keep = TWO_PART_SUFFIX.test(h) ? 3 : 2;
  return labels.length > keep ? labels.slice(-keep).join('.') : h;
}

/** The company's own domain from a URL or bare host, or undefined for job boards and junk. */
export function companyDomainOf(urlOrHost: string | undefined): string | undefined {
  if (!urlOrHost) return undefined;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(urlOrHost) ? urlOrHost : `https://${urlOrHost.trim()}`).hostname;
  } catch {
    return undefined;
  }
  host = host.toLowerCase();
  if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || SHARED_HOSTS.test(host)) return undefined;
  const root = registrableDomain(host);
  return NOT_A_COMPANY.has(root) ? undefined : root;
}
