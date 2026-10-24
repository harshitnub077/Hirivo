# Job sources

Every search runs in the user's own Chrome, on their own connection. Servers get turned away by
LinkedIn (HTTP 429), Naukri ("recaptcha required") and Indeed (a Cloudflare check); a normal
browser does not. Adapters live in `src/services/discover/sources/`, each with a saved real page
in `tests/fixtures/sources/` and a test in `tests/unit/sources.test.ts`.

| Site | How it is read | Filters sent | Posted time | Limits |
|---|---|---|---|---|
| LinkedIn | `fetch` of `jobs-guest/jobs/api/seeMoreJobPostings/search`, `credentials: 'omit'` (never the user's session) | `keywords`, `location` (city + country, `India` or `Worldwide`), `distance` (miles = km × 0.621), `f_TPR=r<seconds>`, `f_JT` (`I` internship, `F` full-time), `f_WT` (1 on-site, 2 remote, 3 hybrid), `f_E` | `<time datetime>` on each card | 3 queries × 2 pages, 2.5 s apart; 429/999 → "Blocked" |
| Naukri | results page opened in an inactive background tab, read by `extractJobListFromPage`, tab closed | path `/<query>-jobs-in-<city>`, `jobAge`, `experience` | `.job-post-day` ("2 days ago"); "Starts in…" is ignored | at most 2 background tabs at a time; a check page → "Blocked" |
| Indeed India | same as Naukri, `in.indeed.com/jobs` | `q`, `l`, `radius` (km), `fromage`, `sc=0kf:jt(internship);` | `pubDate` in the page's `mosaic-provider-jobcards` JSON | as Naukri; Cloudflare check → "Blocked" |
| Internshala | `fetch` of the listing HTML | path `/internships/<category>-internship-in-<city>/` (31 categories; nearby cities for the radius; `work-from-home`), `/jobs/…` for jobs | `.color-labels` ("1 day ago", "Just now") | one page per category and city |
| Unstop | `fetch` of the public search API | `opportunity=internships|jobs`, `searchTerm` | `approved_date` / `updated_at` | one call per query |
| YC, HN, remote boards, Watchlist | public JSON APIs (unchanged) | role keywords | from the API | as before |

**Radius.** LinkedIn and Indeed take a radius directly. Naukri and Internshala are searched for
each city within the radius (`nearbyCities` in `discover/geo.ts`), and every result whose location
names a known city is filtered by straight-line distance.

**Duplicates.** One job per company + title + city (`dedupeKey`). A copy with no city
("Worldwide", "Remote") counts as the same job as any city's copy. The company's own board wins,
then the copy with the clearest way to apply (`SOURCE_RANK`).

**When a site blocks.** The source shows "needs attention" under Radar → Search → Sources with the
reason, and the other sites keep working. Opening the site once in Chrome and passing its check
usually clears it.

**Markup changes.** If a site's page changes and an adapter finds nothing, its fixture test still
passes but Sources shows 0 jobs. Save a fresh page into `tests/fixtures/sources/`, update the
selectors, and rerun `npm test`.

## People

| Source | What it gives | How |
|---|---|---|
| Company website | Names, roles, listed addresses, hiring inboxes | Home, /about, /team and similar pages, with the user's OK for that site |
| YC company page | Founders, titles, the LinkedIn links they published | `ycombinator.com/companies/<slug>`, `data-page` JSON; matched by website |
| LinkedIn (user-opened) | Current staff on a people search or a company's People tab | The user opens the page (Find them on LinkedIn) and presses Read people on this page; Hirivo reads the visible cards once |
| LinkedIn export | People the user knows, sometimes with emails | `Connections.csv` the user imports |
| GitHub | Engineers in the org; commit addresses as email-format evidence only | Public API, 3 calls at most per company |

**Email format.** A format (first.last, flast, first…) is confirmed only when at least one real
address at the domain fits it, no other real address contradicts it, and the domain has MX
records. Shared inboxes and nicknames are ignored. Confirmed addresses are labelled with the
proof ("seen in priya.sharma@acme.in"); everything else stays a labelled guess and is never
emailed automatically.

**Not used.** Search-engine LinkedIn discovery (`site:linkedin.com/in`): checked live in October
2026, Google ignores the operator and wraps result links, and Bing and DuckDuckGo answer with a
check. Wellfound's people pages sit behind a Cloudflare check. LinkedIn company pages need a
sign-in.
