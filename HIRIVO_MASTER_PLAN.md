# Hirivo Master Plan

**Hirivo is the job-search co-pilot that never lies to you.** It tells you if a job is real, whether you honestly fit, who to message, and what to say. Then it reminds you to follow up. It's free, private, and safe for your LinkedIn account.

Positioning line: *"Five real jobs a day, the right person to message, and a message that sounds like you."*

This file is the single source of truth for anyone building Hirivo: you, Antigravity, or Claude. Read **Rules for every builder** before changing code.

---

## 1. Rules for every builder (non-negotiable)

1. **No fake data, ever.** Never hardcode scores, "verified" badges, company lists, people, emails, or resume facts. If Hirivo doesn't know something, the UI says so. (v1 shipped a hardcoded "Radar" that gave every company a 95/100 trust score and guessed CEO emails. It has been removed. Don't bring it back.)
2. **Never automate LinkedIn.** No auto-click, auto-connect, auto-message or auto-apply. No content script that runs on `linkedin.com` by itself. Hirivo reads the open job only when the user presses **Analyze**, through `chrome.scripting.executeScript`. It doesn't add `web_accessible_resources` and doesn't inject UI into LinkedIn.
3. **The user always presses Send and Submit.** Emails open as prefilled Gmail compose windows, and forms are filled but never submitted.
4. **Every claim is backed by a resume fact.** Drafts cite `[FACT-xx]`, and `checkGrounding()` flags any claim without a citation. Citations are stripped before anything leaves the browser.
5. **Business emails only.** Never look up personal emails or phone numbers. Label guessed addresses as guesses.
6. **Local-first.** All data lives in IndexedDB (`HirivoDB`). There is no Hirivo server. AI calls go straight from the browser to the provider the user picked, using the user's own key.
7. **No hardcoded model IDs in calls.** Use `pickModel(provider, key, role)` from `src/llm/registry.ts`. To change a model, edit the preference lists there.
8. **Free resources only**: Groq, Gemini and OpenRouter free tiers, Chrome's built-in Gemini Nano, and public ATS feeds, RDAP and DNS-over-HTTPS.
9. **Job sources: public APIs only, credited, within their limits.** No background scraping of LinkedIn, Naukri or any site whose terms forbid it. Search-result pages are read only on a user click, only for what is visible, with no scrolling or paging. Every listing links back to its source.
10. **Design system only.** Use the tokens and classes in `src/sidepanel/styles/globals.css`, with no new colours, gradients or glassmorphism. Inline styles are for one-off spacing only.

---

## 2. Brand

| Item | Decision |
|---|---|
| Name | **hirivo** (always lowercase in the wordmark) |
| Mark | The **Verified "h"**: a check mark that is also the stem of an italic h. Green tick, ink shoulder. |
| Files | `public/brand/`: `hirivo-mark.svg`, `-dark`, `-mono`, `hirivo-icon.svg` (app tile), `hirivo-icon-small.svg` (heavier stroke for 16–32 px), `hirivo-wordmark.svg`, `-dark` (outlined, no font needed) |
| Icons | `npm run generate-icons` renders `public/icons/*.png` and `store/promo-small-440x280.png` from the SVGs |
| Type | **Geist** (UI) and **Geist Mono** (fact tags, numbers). Bundled locally via `@fontsource-variable`, never loaded from Google Fonts. |
| Colour (light) | ink `#0E1116`, paper `#FAFAF7`, surface `#FFFFFF`, line `#E7E5DF`, **Verified Green `#0F7A55`**, caution `#A15C00`, risk `#B42318` |
| Colour (dark) | ink `#ECEDEE`, paper `#0D0F12`, surface `#15181D`, line `#262A31`, green `#3FD69B`, caution `#F2B84B`, risk `#F97066` |
| Voice | Plain, direct, kind. Say "skip this one for now", not "DO NOT APPLY". Never hype. |

**Signature UI element:** the Verdict Strip on every job, four pills that answer "should I bother?" at a glance:
`Real · Fit · People · Safety`

---

## 3. What exists today (v2.1, built and verified)

| Area | Status | Where |
|---|---|---|
| Side panel shell: Now / Radar / Pipeline / You, light and dark | Done | `src/sidepanel/App.tsx`, `views/*` |
| Analyze on click (JSON-LD JobPosting first, then LinkedIn, Naukri, generic), per-site permission prompt for unknown career sites | Done | `src/content/extractJob.ts`, `src/sidepanel/page.ts` |
| Ghost-job check against the company's real Greenhouse/Lever/Ashby board, using real posting dates | Done | `src/services/ghostJobShield.ts`, `atsFeeds.ts` |
| Company legitimacy: RDAP domain age, MX records | Done (existing) | `src/services/legitimacyScorer.ts` |
| Honest fit score from the user's resume facts (no fallback resume, no clamping) | Done | `src/services/fitAdvisor.ts` |
| Proof-linked writer, grounding re-checked on every edit, cliché linter with India-specific rules | Done | `proofWriter.ts`, `phraseLinter.ts`, `views/WritePanel.tsx` |
| Warm path from the LinkedIn `Connections.csv` export; email-pattern guesses (labelled) | Done | `warmPathMatcher.ts`, `views/PeoplePanel.tsx` |
| Send via prefilled Gmail compose (no OAuth); LinkedIn note copy and log | Done | `src/services/outreach.ts` |
| Follow-ups on day 4 and day 9, notifications, toolbar badge, daily cap | Done | `src/background/index.ts`, `views/PipelineView.tsx` |
| Watchlist Radar: real ATS feeds, Early-Bird alerts every 6 h, hiring pulse, live-checked seed list | Done | `src/services/watchlist.ts`, `scripts/verify-seeds.js` |
| LLM router: Groq → Gemini → OpenRouter → Gemini Nano, model registry, cache, daily usage | Done | `src/llm/*` |
| Autofill on Greenhouse/Lever/Ashby/Workable (empty fields stay empty) | Done | `src/content/index.ts`, `formAutofill.ts` |
| Export data, delete everything | Done | `views/YouView.tsx` |
| Resume upload (PDF via pdf.js, DOCX via fflate, TXT): fills profile, keeps only traceable facts, suggests roles; first-run step | Done | `src/services/resumeImport.ts`, `views/ResumeImport.tsx` |
| Discover: Remotive, Remote OK, Himalayas, Jobicy, Arbeitnow, HN Who is hiring, YC hiring startups (board finder), watchlist; ranking with reasons; small-teams filter; India-first location | Done | `src/services/discover/*`, `views/DiscoverPanel.tsx` |
| Save visible jobs from LinkedIn/Naukri/Indeed/JSON-LD search pages (on click only) | Done | `src/content/extractJobList.ts` |
| Apply flow: auto-fill ATS forms on open, attach resume file, detect confirmation, mark applied | Done | `src/content/index.ts`, `src/content/formFill.ts` |
| Tests: 55 unit tests incl. a real Greenhouse form fixture; live source checks; GitHub Actions CI | Done | `tests/`, `.github/workflows/ci.yml` |

**Commands**

```
npm run build           # tsc + vite → dist/ (load unpacked in chrome://extensions)
npm run generate-icons  # brand SVG → PNG icons + store tile
npm run verify-seeds    # re-check the Radar suggestion list against live boards
npm run preview:panel   # dev server; open /sidepanel.html?demo for sample data
npm test                # unit tests (runs in CI on every push)
npm run test:live       # checks every live job source still answers in the expected shape
```

---

## 4. Roadmap: one Antigravity prompt per phase

Paste each prompt as is. Each one assumes the rules in section 1 and ends with acceptance criteria. Run `npm run build` after each phase and load `dist/` in Chrome to check.

### Phase A: Scam Shield and repost fingerprint (India-first)

> In the Hirivo Chrome extension (read HIRIVO_MASTER_PLAN.md section 1 first), add `src/services/scamShield.ts`.
>
> It runs deterministic checks on the extracted job description and contact details, and returns `{ level: 'clear' | 'caution' | 'risk', reasons: string[] }`. The checks:
> - Asks for any fee or deposit (registration, training, security, kit, refundable).
> - Says to contact only via WhatsApp or Telegram, or gives a personal phone number as the only contact.
> - Recruiter or contact email on a free domain (gmail, yahoo, outlook, rediffmail…) for a company that has its own domain.
> - Salary that is extreme for the title, e.g. above ₹1L/day or "earn ₹50,000 weekly from home".
> - Urgency phrases ("limited seats", "joining today").
> - Domain younger than 90 days, or no MX record (reuse `legitimacyScorer.ts`).
>
> Then add a repost fingerprint:
> - Normalise the description (lowercase, strip numbers and dates and whitespace), SHA-256 it, and store `{hash, jobId, firstSeen, lastSeen, seenCount}` in a new Dexie table `fingerprints` (schema version 4).
> - If the same hash appears with a different job id or a newer posted date, add a reason "Same description seen N times since <date>".
>
> Feed both into the Safety pill and the "Is the company real?" card in `EvidencePanel.tsx`.
>
> Acceptance:
> - A pasted fake listing ("pay ₹1,999 registration, WhatsApp only") shows Safety: Risky with the exact reasons.
> - A real Razorpay posting shows Clear.
> - No network calls beyond RDAP and DoH.

### Phase B: Evidence-table fit and Proof Sprint

> Replace the single-prompt fit check in `src/services/fitAdvisor.ts` with a two-step check that uses `routeLLMRequest`.
>
> 1. Extract a requirements list from the job description: `[{id, text, kind: 'must'|'nice', years?}]`, using taskType 'general' so it runs on the fast model.
> 2. For each requirement, return the best matching resume fact id or null, plus a one-line reason. Use taskType 'fit_analysis'.
>
> Compute the score in code: musts count 2× and nice-to-haves 1×. Never let the model invent the number.
>
> Show an evidence table in `EvidencePanel.tsx`: each requirement with a green fact tag or a red "gap".
>
> Then add `src/services/proofSprint.ts`. When the score is between 40 and 70, generate a 3–7 day mini-project that closes the biggest must-have gap: title, scope, stack, daily steps, and what to show at the end. Show it under "Close the gap" with a button "I finished this", which adds a new resume fact ("Built X to learn Y").
>
> Acceptance:
> - The score equals the formula applied to the table.
> - A frontend resume against a senior Go job scores under 40 with gaps listed.
> - Finishing a sprint adds a FACT that the writer can cite.

### Phase C: Contact ladder and Hook Finder

> Add `src/services/contactLadder.ts` returning ranked candidates with a `why` field, in this order:
> 1. 1st-degree connections (existing CSV)
> 2. Alumni: connections whose Position/Company history matches the user's college. Also add a `school` column parse if the CSV has one.
> 3. People named on the company's own `/team`, `/about`, `/people` and `/leadership` pages, fetched only after the user approves that origin via `chrome.permissions.request`.
> 4. Public GitHub org members (`api.github.com/orgs/{org}/members`, unauthenticated, 60 requests/h, cached).
> 5. The careers@ inbox.
>
> Add `src/services/hookFinder.ts` for recent, linkable signals. It uses only these free sources:
> - The company blog RSS/Atom (discover `<link rel="alternate" type="application/rss+xml">` on the homepage).
> - GitHub releases for their top repos.
> - Hacker News via `hn.algolia.com/api/v1/search?query=<company>&tags=story`.
> - Google News RSS `news.google.com/rss/search?q=<company>`.
>
> Show the 3 freshest items with dates and links in the Write panel, so a click fills the hook field. Never generate a hook without a source link.
>
> Acceptance:
> - Each hook has a URL and a date under 90 days old, or none is shown.
> - Every contact shows why it is ranked where it is.

### Phase D: Reply-Likelihood meter, A/B subjects, learning loop

> Add `src/services/replyMeter.ts`, a deterministic score from 0 to 100 with a named reason for each failed check:
> - 50–125 words
> - Exactly one question or ask
> - A sourced hook in the first two sentences
> - Subject of 6 words or fewer, with no "Application for"
> - No attachment mention
> - Flesch reading ease of 60 or more
> - Linter clean
> - At least one fact cited
>
> Show it as a `Meter` in `WritePanel.tsx`, with the failing checks listed.
>
> Generate 2 subject options and record which one was sent.
>
> In `PipelineView.tsx`, show reply rate by subject style, hook type and contact type (stored on `OutreachRecord`). After 10 or more sends, pass the best-performing pattern to the writer prompt as a hint.
>
> Acceptance:
> - The meter changes live as you edit.
> - Pipeline shows reply rate per contact type.

### Phase E: Daily 5 and Interview Pack

> Add a "Daily 5" card at the top of Radar. Once a day (alarm at 8:00 local time), pick the 5 best roles from the watchlist plus recently analyzed jobs.
> - Rank by fit (if scored), freshness (days on board) and a warm path existing.
> - Exclude roles marked doubtful or risky.
>
> Send one notification: "Your 5 for today".
>
> When an outreach is marked "Got a reply", generate an Interview Pack: what the company does (from their homepage meta and the hooks), 8 likely questions for the role, the user's 3 strongest facts for it, and 3 smart questions to ask. Store it on the outreach record and show it in Pipeline.
>
> Acceptance:
> - Daily 5 never includes a role whose Real pill is Doubtful.
> - The Interview Pack only cites facts from the resume.

### Phase F: Gmail power mode (bring your own OAuth client)

> Add an optional "Connect Gmail" flow in You.
> - Explain step by step how the user creates their own Google Cloud project, enables the Gmail API, creates a Chrome-extension OAuth client with this extension's ID, sets the consent screen to Testing, and adds themselves as a test user.
> - Store the client ID locally and use `chrome.identity.launchWebAuthFlow`, so no `oauth2` key is needed in the manifest. Request `gmail.compose` and `gmail.readonly`.
> - When connected: create real drafts in-thread for follow-ups, and poll threads every 3 hours to auto-mark replies (stop follow-ups).
> - When not connected: keep the current compose-URL flow.
>
> Note: these are restricted scopes. A public OAuth client would need Google verification, which is why each user brings their own.
>
> Acceptance:
> - Without setup, nothing changes.
> - With setup, a reply in Gmail flips the record to Replied within one poll.

### Phase G: Store launch

> Update `CHROMEWEBSTORE.md`: rewrite the listing from section 2 and 3 of this file, justify every permission in `public/manifest.json`, and make no unverifiable numbers ("10x", "23% ban rate").
>
> Create 1280×800 screenshots of Now, Radar, Pipeline and You, from `npm run preview:panel` with `?demo` at 400 px wide, centred on a paper background with a one-line caption each.
>
> Write a privacy policy page (`docs/privacy.md`) that matches section 1 rules 5 and 6.
>
> Acceptance: every permission in the manifest is used in code and justified in the doc.

---

### Phase H: More discovery sources (after A–G)

> Add sources to `src/services/discover/` following `boards.ts`: return `RawJob[]`, credit the source, respect its limits, and add a live test in `tests/live/`.
>
> Candidates:
> - Wellfound and Instahyre via JSON-LD on pages the user opens (already supported by save-from-page).
> - Public Workable (`apply.workable.com/api/v1/widget/accounts/{slug}`) and SmartRecruiters (`api.smartrecruiters.com/v1/companies/{id}/postings`) boards in the YC board finder.
> - Indian startup lists with open data licences.
>
> Never add a source that requires login or forbids automated access.
>
> Acceptance: `npm run test:live` passes for the new source, and Discover credits it.

## 5. Growth and money (after 100 real users, not before)

- **Free forever:** everything above with your own free keys.
- **Pro (~₹149/month or ₹999/year):** hosted AI so there's no key setup, sync across devices, unlimited watchlist and alerts. This is the only reason to ever run a server. Build it on Cloudflare Workers' free tier first.
- **Campus:** placement cells and bootcamps, priced per batch, with a cohort dashboard of anonymised reply rates.
- **Where users come from:** r/developersIndia and r/cscareerquestionsIndia, college WhatsApp and Telegram groups, LinkedIn build-in-public posts (show real screenshots of the Scam Shield catching fake jobs), and Product Hunt after the store listing is live.

## 6. Honest limits to keep in mind

- LinkedIn changes its page structure often. When Analyze fails there, update the selectors in `extractJob.ts`. JSON-LD covers most other sites.
- Free AI limits change. Groq and Gemini publish current limits in their consoles. The You tab shows today's usage.
- Gemini Nano needs a capable desktop GPU, so treat it as a bonus, never a requirement.
- Company boards not on Greenhouse, Lever or Ashby show "Unconfirmed" on the Real pill rather than a fake verdict.
