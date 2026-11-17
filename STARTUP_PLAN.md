# Hirivo startup plan (November 2026)

The product plan and the builder rules are in [HIRIVO_MASTER_PLAN.md](HIRIVO_MASTER_PLAN.md). This file covers the startup side: where Hirivo stands, who it competes with, what to build next and in what order, and how to reach the first users. It starts from a full audit of v3.2.0.

---

## 1. Where Hirivo stands

### Solid (checked in this audit)
- The build is clean. `tsc` passes, there are 373 unit tests, and CI runs on every push.
- The built extension loads in Chromium, registers all five alarms (search every 2 h, follow-ups every 3 h, watchlist every 6 h, Daily 5 at 8:00, Autopilot every 5 min), and renders the first-run screen with no errors.
- Breadth already matches or beats paid tools:
  - Search across 5 Indian portals plus startups.
  - Real / Fit / People / Safety checks.
  - Grounded outreach.
  - Form filling on 13+ ATS.
  - Gmail drafts.
  - Opt-in Autopilot.
- The trust rules (no LinkedIn automation, resume-backed claims only, no guessed emails sent automatically, local-first) are enforced in code and covered by tests. No competitor can claim that combination.

### Fixed in this audit (v3.2.0)
| Issue | Risk | Fix |
|---|---|---|
| Any content script could ask the background worker to send email (`AP_SEND`), open tabs or scrape | If a script on a third-party page were ever compromised, it could send mail from the user's Gmail | `src/background/senders.ts`: privileged actions are accepted only from Hirivo's own pages. Tested |
| Recipient and thread headers went into the MIME message unsanitised | A scraped address with a line break could add `Bcc:` | `buildRawMessage` strips CR/LF from header values. Tested |
| On-device AI was called without its required language | Console error at startup; Chrome may refuse the session | `nano.ts` declares English input and output |
| First-run text said "every 12 hours"; the search runs every 2 h | Wrong expectation at onboarding | Copy fixed |
| The reply notification pointed to the Interview Pack, removed in v2.12 | Dead end for the user | Copy fixed |
| No website, no hosted privacy policy, no installable download | The store requires a privacy URL; nobody could find or install Hirivo | Website, Pages deploy and release zip (below) |

### Known risks still open
1. **LinkedIn markup drift.** Guest search and the job page change often. `tests/live` catches it; run `npm run test:live` weekly, ideally on a scheduled CI job.
2. **Background tab limit isn't global.** `applyInTab` and `readPageInTab` (in `src/background/index.ts`) don't go through `withTabSlot`, and the counter is in-memory, so it resets when the worker sleeps. During a large Autopilot batch, more than two background tabs can open. Fix: route all three through the slot and keep the count in `chrome.storage.session`.
3. **`markApplied` falls back to "the only job marked applying"** when the board doesn't match. If the user submits on an unrelated board, the wrong job can be marked applied. Fix: require the board key to match, and ask in the side panel otherwise.
4. **AI setup friction.** Fit, writing and answers need a Groq/Gemini key. This is the biggest gap to activation (see M5).
5. **Single maintainer, no telemetry.** Correct for privacy, but there is no signal when a source breaks for users. Mitigation: the live tests, plus an opt-in "send a diagnostic report" button that opens a prefilled GitHub issue (no server).

---

## 2. Competitors (2026)

| Product | What it is | Price | India coverage | Risk to the user |
|---|---|---|---|---|
| Simplify Copilot | Autofill across 100+ ATS, plus an Autopilot that submits for you | Free tier; paid around $35–40/mo | Weak: US boards | Low for autofill; Autopilot sends without a per-application review |
| Jobright | AI job matching, tailoring and an apply agent | Around $40/mo after a price rise in early 2026 | Weak: built around the US market | Generated claims about you |
| Teal | Tracker and resume builder with keyword insights | Free tier; Teal+ around $29/mo | You bring the jobs | Low |
| Careerflow | All-in-one: resume, LinkedIn optimisation, tracker, mock interviews | Paid tiers | General | Low |
| AutoApplyMax, LazyApply, LoopCV | Bulk auto-apply bots, often LinkedIn Easy Apply | ₹299–999/mo or lifetime deals | Some India focus | LinkedIn automation can get accounts flagged; spray-and-pray hurts reply rates |
| Internshala, Naukri, Unstop (portals) | Where Indian students actually apply | Free, with paid boosts | Native | Fake and ghost listings are common |

Prices come from vendor and review pages and conflict between sources, so treat them as approximate. Sources: Jobright's own 2026 comparison, Teal's "Teal vs Simplify" page, Stork's Simplify vs Teal page, Scoutify's JobCopilot alternatives roundup, and India roundups from FastApply, AutoApplyMax and the Free Press Journal.

### Hirivo's wedge
1. **India-first.** It is the only tool that searches LinkedIn, Naukri, Indeed, Internshala and Unstop together, and fills Indian ATS (Keka, Darwinbox, Zoho Recruit) with campus-specific answers (CGPA, 10th and 12th marks, CTC in LPA, notice period).
2. **Honest.** Every sentence it writes is traced to the resume. Competitors generate freely, and the embarrassment risk falls on the student.
3. **Ban-safe.** It never automates LinkedIn. That is a real fear for students and a clear message.
4. **Safety.** Scam Shield fits India, where fee and task-job scams aimed at freshers are common. No competitor leads with it.
5. **Free and private.** No server and no account, with the user's own free AI keys. Competitors charge ₹2,500–3,500 a month at US prices.

What Hirivo still lacks against them:
- **Zero-setup AI**, which competitors host (M5).
- **Store presence and reviews** (M6).
- **A visible Pro tier**, which matters for later revenue but not now (M9).

---

## 3. Roadmap

Each milestone ends with something a user can see. Keep the builder rules in the master plan.

### M5: zero-setup first value (next, about 1 week)
- When no key is set, route `fast` and `general` tasks to Chrome's on-device model where it is available (`src/llm/router.ts` currently allows it only for `fast`). Keep writing gated on a real key, and say why in the UI.
- Guided Groq key flow: "Get a free key" opens the console. Hirivo detects a pasted `gsk_` key on the clipboard when the user returns and asks before saving it.
- First-run order: resume, then roles, then the first search runs immediately (not in 2 h), then show the first 5 matches with no key needed.
- **Done when** a new user sees ranked, checked jobs within 2 minutes of install, with no key.

### M6: Chrome Web Store launch (about 1 week, mostly waiting on review)
- Turn on GitHub Pages (Settings → Pages → GitHub Actions). The privacy URL becomes `…/privacy.html`.
- Submit with `CHROMEWEBSTORE.md` and `store/` screenshots, then set `storeUrl` in `web/site.config.ts`.
- Tag `v3.2.0` so the release zip exists for people installing before review finishes.
- **Done when** the store listing is live and every "Add to Chrome" button points at it.

### M7: activation and retention (2 weeks)
- A weekly digest notification: "This week: 34 new matches, 3 replies, 2 follow-ups due."
- Close the background tab-limit and `markApplied` risks above.
- Scheduled `test:live` in CI, with a failing source shown on the Radar health strip.
- **Done when** a user who installs on Monday still opens Hirivo on Friday (measured with the opt-in counters in section 5).

### M8: portal apply on Naukri and Internshala (deferred by the owner, needs a logged-in capture session)
- Fill the portals' own apply forms the same way as the ATS forms. The user presses Submit, and the portals' terms are respected.

### M9: Hirivo Pro (only after 100 weekly active users)
- Hosted AI, so no key is needed, plus sync across devices. Built on Cloudflare Workers' free tier; the server stores no resume, only proxied model calls with rate limits.
- About ₹149/month or ₹999/year, which undercuts every competitor by 10×. The free tier stays complete.

### M10: Campus
- Placement-cell and bootcamp batches: one setup for a cohort and an anonymised reply-rate dashboard. Priced per batch.

---

## 4. Go-to-market (first 1,000 users)

1. **The free tools are the top of the funnel.**
   - The website's *Is this job a scam?* and *Resume keyword match* pages run the extension's real code with no install.
   - They target what students search for ("is this job fake", "registration fee job scam", "ATS keyword checker free").
   - Add more as pages, with the same rule: real engine, nothing sent anywhere. Next up: an Internshala/Naukri listing checker by URL, and a cold-email grounding checker.
2. **Build in public with real catches.** Post screenshots of Scam Shield flagging real fake listings (with company names blurred) on LinkedIn and X. Students share warnings about scams.
3. **Communities:** r/developersIndia, r/cscareerquestionsIndia, college WhatsApp and Telegram placement groups, and Discord servers for tech clubs. Lead with the free scam check, not the install.
4. **Campus ambassadors:** one student per college who gets early features in return for a 10-minute demo in their placement group.
5. **Product Hunt** once the store listing has its first reviews.

Never fabricate testimonials, user counts or ratings (PRODUCT.md). Use real catches and real screenshots only.

---

## 5. Metrics that matter

Hirivo has no server, so every metric is local first, shown to the user, and shared only if they opt in.

| Stage | Signal |
|---|---|
| Acquisition | Store installs; website visits to install clicks (GitHub Pages traffic and the store's own stats) |
| Activation | Resume uploaded, then first search, then first job analysed, all within the first session |
| Value | Emails sent per week; applications filled |
| Outcome | Replies received (Gmail power mode detects them); interviews the user marks |
| Retention | Opened on 3 or more days in week 2 |

Opt-in sharing comes later, as an anonymous weekly count sent to a Pages-hosted form or a Worker. Not before M9.

---

## 6. What was added for the startup in v3.2.0

- **Website** (`web/`, built with `npm run site:build`, deployed by `.github/workflows/site.yml`):
  - Landing page: hero, four verdicts, how it works, features with real panel captures, trust rules, comparison, install steps and FAQ.
  - The free scam check and keyword match tools.
  - The privacy policy rendered from `docs/privacy.md`, and a 404 page.
  - Dark and light themes, accessible, no layout overflow down to 375 px, and no analytics or third-party requests.
- **Release pipeline:** pushing a `v*` tag runs the tests, builds `hirivo-extension.zip` and attaches it to a GitHub Release (`.github/workflows/release.yml`). The website's download button points at the latest release.
- **Shared code:** `src/services/resumeFile.ts` (resume reader with no database or AI imports), so the extension and the website use the same PDF/DOCX reader.
