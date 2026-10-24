# Chrome Web Store listing

**Name:** Hirivo: Real Jobs, Right People
**Version:** 3.0.0
**Category:** Productivity
**Language:** English (India), English
**Privacy policy:** [docs/privacy.md](docs/privacy.md). Publish it at a public URL (GitHub Pages, or the file's GitHub link) and paste that link into the dashboard.

## Short description (≤132 chars)
Finds internships and jobs near you on LinkedIn, Naukri and more, emails the right people, and fills every application for you.

## Detailed description

Hirivo is a job and internship automator for students and job seekers. Say once what you want (internship or job, your city and a radius, how recent), and Hirivo finds the freshest matches across LinkedIn, Naukri, Indeed, Internshala, Unstop and startup boards, researches each company and its people, emails them from your own Gmail, writes LinkedIn notes for you to send, and fills the application. It never invents anything about you and never acts on LinkedIn for you. You press Send and Submit yourself, unless you turn on Autopilot.

**Start with your resume.** Upload a PDF, Word or text resume. Hirivo fills your profile, keeps only facts it can trace back to the file, and suggests the roles you fit.

**Find real jobs near you.** Set what you want once: internships or jobs, your city and a radius, how recent, work mode, experience and minimum stipend. Hirivo searches LinkedIn's public listings, Naukri, Indeed, Internshala and Unstop from your own browser, plus YC startups, Hacker News "Who is hiring" and remote boards (Remotive, Remote OK, Himalayas, Jobicy, Arbeitnow). Every job shows when it was posted and how far away it is, and the same job on several sites appears once. When a company has its own Greenhouse, Lever or Ashby board, Hirivo links there instead of a copy. Every listing names its source. Radar follows the companies you choose and notifies you when a matching role is posted. Each morning, the Daily 5 picks the best verified roles for you.

**Four answers on every job.** Open a posting on any job site or careers page and press Analyze. The Verdict Strip answers:

- **Real:** is the role on the company's own hiring board, and how long has it been open? Reposted descriptions are recognised.
- **Fit:** each requirement in the job is matched to a line on your resume, or marked as a gap. The score comes from that table, so a long shot is shown as a long shot.
- **People:** people you already know there (from your own LinkedIn data export), people on the company's team page and GitHub, and the hiring inbox, ranked by who is most likely to help and why.
- **Safety:** Scam Shield quotes the exact lines that look like fake-job tricks: registration fees, deposits, OTP or bank requests, chat-app-only contact, a personal email for a company role, a very new domain or one with no mail server.

**Write like a person.** Hirivo drafts a short email, a LinkedIn note and a referral ask. Every claim must point to a line on your resume, and lines it can't back up are flagged before you send. The opening line uses something real and recent from the company, with a link. Robotic phrases ("kindly do the needful", "I hope this finds you well") are caught. A reply meter shows which simple checks the draft fails, such as too long or more than one ask.

**Fill the whole application.** On Greenhouse, Lever, Ashby, Workable, Workday and other application forms, Fill with Hirivo answers every question it honestly can: contact details, current role, education, notice period, salary, languages, work authorization, dropdowns, radio buttons and Yes/No questions. Open questions like "Why do you want to work here?" get answers written from your resume, in your voice. It attaches your resume, leaves consent boxes and diversity questions to you, lists anything it couldn't answer, and never presses Submit. Hirivo also tailors your resume to each job by reordering and rewording what is already there, never by adding claims.

**Write to several people.** Pick up to five people at the company (the hiring manager, a recruiter, a founder, the hiring inbox, someone you know) and Hirivo writes each one their own email for their role. Sentences your resume doesn't back are cut before you see them.

**Follow up on time.** The email opens in Gmail for you to send. Hirivo reminds you on day 4 and day 9 and stops when you get a reply. Optional Gmail power mode, with your own Google app, saves real drafts (with your resume attached if you like), keeps follow-ups in the same thread and spots replies by itself.

**Apply automatically, if you choose.** Turn on "Apply automatically to new matches" and each search (every 2 hours) hands its best new jobs to Autopilot: at or above the match score you pick, at most two roles per company a week, with an optional daily limit. For jobs found on LinkedIn, Naukri, Indeed or Internshala, Hirivo applies on the company's own Greenhouse, Lever or Ashby page when the same job is there; otherwise it emails the people, prepares LinkedIn notes and leaves that portal's Apply button to you. Applications go out one to three minutes apart.

**Autopilot, when you want it.** Turn it on, hand it the jobs you choose, and it does the rest: reads each posting, checks the job is real and safe, finds the company's website and the people there, emails everyone with a verified address (listed, or in the company's email format proven by real addresses) from your own Gmail, prepares LinkedIn notes for you to send (with your resume attached and every claim backed by it), fills the application and submits it. It stops and notifies you only when a form needs your consent tick or a CAPTCHA, and it never emails a guessed address or touches LinkedIn.

**Safe for your LinkedIn account.** Hirivo never uses your LinkedIn session for searching: it reads LinkedIn's public job listings, the ones anyone sees without signing in. On LinkedIn pages it reads only what you are viewing when you press Analyze or Save jobs, and it never clicks, connects, messages or applies there.

**Private and free.** There is no Hirivo server and no account. Your resume, contacts and history stay in your browser, and you can export or delete all of it in one click. AI runs on your own free Groq, Gemini or OpenRouter key, or on Chrome's built-in AI where your computer supports it. Many checks work with no key at all.

## Screenshots (1280×800)

| File | Caption |
|---|---|
| `store/screenshot-1-now.png` | Every job gets four answers: is it real, do you fit, who to ask, is it safe. |
| `store/screenshot-2-radar.png` | One search across LinkedIn, Naukri, Indeed, Internshala and more, by city, radius and date. |
| `store/screenshot-3-pipeline.png` | Follow-ups on day 4 and day 9, stopped when someone replies. |
| `store/screenshot-4-you.png` | Your resume becomes facts, and Hirivo only claims what they say. |

Small promo tile: `store/promo-small-440x280.png`. Regenerate screenshots with `npm run store:screenshots` (see `scripts/store-screenshots.js`).

## Single purpose

Help a job seeker decide which jobs are worth applying to and reach the right person at each one, with messages backed by their own resume.

## Permission justifications

| Permission | Why |
|---|---|
| `sidePanel` | Hirivo's interface lives in the side panel and opens from the toolbar icon or Alt+H. |
| `storage` | Keeps small local caches: daily AI usage counts, recent job-board results, company site lookups and which sites the user has allowed. |
| `scripting` | Reads the job on the current tab when the user presses Analyze, Save jobs or Read people on this page, and, for jobs the user handed to Autopilot, reads the posting and loads the form filler in a background tab. Nothing is injected otherwise. |
| `activeTab` | Gives Hirivo the open tab's address and one-time read access when the user opens the panel, so Analyze works without broad site access. |
| `alarms` | Checks followed companies every 6 hours, follow-ups and Gmail replies every 3 hours, Discover every 12 hours, and builds the Daily 5 at 8:00 local time. |
| `offscreen` | Autopilot's research runs in an offscreen document, because reading company websites needs an HTML parser that the background worker doesn't have. It only runs while there are jobs the user handed to Autopilot. |
| `notifications` | Tells the user about new matching roles, due follow-ups, replies, the morning Daily 5, and a single check-in a week after applying. |
| Host: `api.groq.com`, `generativelanguage.googleapis.com`, `openrouter.ai` | Sends the user's AI requests straight to the provider they chose, with their own key. |
| Host: `rdap.org`, `dns.google` | Domain age and mail-server checks for company legitimacy and Scam Shield. |
| Host: `boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com` | Reads public job-board feeds to confirm a role is live, read its posting date and power Radar. |
| Host: `*.linkedin.com`, `*.naukri.com`, `*.indeed.com`, `*.wellfound.com`, `*.instahyre.com`, `*.cutshort.io`, `*.foundit.in` | Reads the job or the visible search results when the user presses Analyze or Save jobs. The saved search also reads public job listings: LinkedIn's logged-out job search (never with the user's LinkedIn session), and Naukri and Indeed results pages opened in a background tab and closed after reading. Nothing is clicked or posted on these sites. |
| Host: `*.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `apply.workable.com` | Reads job pages on Analyze, and fills application forms with the user's details and resume. The user always submits. |
| Host: `www.ycombinator.com` | For YC companies, reads the company's public YC page for its founders' names, titles and the LinkedIn links they published, so the user can write to them. |
| Host: `internshala.com`, `unstop.com` | The saved search reads public internship and job listings on Internshala and Unstop, filtered to the user's roles, city and dates. Each listing links back to its source. |
| Host: `remotive.com`, `remoteok.com`, `himalayas.app`, `jobicy.com`, `www.arbeitnow.com`, `hn.algolia.com`, `yc-oss.github.io` | Public job APIs and open datasets for Discover. Each listing is credited and links to its source. Hacker News search also finds recent company news for opening lines. |
| Host: `api.github.com`, `news.google.com` | Public GitHub org members and releases, and Google News headlines, for the contact ladder and opening-line suggestions. |
| Optional `identity` | Asked only when the user connects Gmail with their own Google OAuth client, to run Google's sign-in window. |
| Optional host: `gmail.googleapis.com`, `oauth2.googleapis.com`, `accounts.google.com`, `*.chromiumapp.org` | Asked only on Connect Gmail: saving drafts in the user's Gmail and reading their own threads to spot replies; checking the user's Google sign-in setup before the sign-in opens; and catching the sign-in result when it runs in an ordinary tab (the extension's own chromiumapp.org redirect address). |
| Optional host: `https://*/*` | Requested one site at a time when the user presses Analyze, Look up or Read people on this page on a site not listed above. If the user turns on Autopilot, it asks once for all sites, so Autopilot can read company websites, careers pages and job postings for the jobs the user hands it. |
| Content scripts: `boards.greenhouse.io`, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.eu.greenhouse.io`, `jobs.lever.co`, `jobs.eu.lever.co`, `jobs.ashbyhq.com`, `apply.workable.com`, `*.myworkdayjobs.com`, `*.smartrecruiters.com`, `*.icims.com`, `*.recruitee.com`, `*.bamboohr.com`, `*.keka.com`, `*.darwinbox.in`, `*.zohorecruit.com`, `*.zohorecruit.in`, `*.freshteam.com` | Application-form pages only. Fills empty fields with the user's saved answers, writes answers to open questions from their resume when they press Fill with Hirivo, and attaches their resume. It presses Submit only for jobs the user handed to Autopilot with submitting turned on, and never ticks consent boxes. |

Hirivo uses no remote code. Everything it runs ships in the package. It has no `web_accessible_resources`.

## Data use disclosure (dashboard answers)

**Data collected:** Hirivo collects nothing. It has no server. The data below stays on the user's device, and leaves it only as described.

| Dashboard category | Handled? | How |
|---|---|---|
| Personally identifiable information | Yes, on device | Name, email and phone from the user's own resume and profile, used to fill application forms the user opens. |
| Authentication information | Yes, on device | The user's own AI keys and, if connected, Gmail tokens. Stored in the browser, never synced or exported. |
| Personal communications | Yes, on device | With Gmail power mode, Hirivo reads only the threads it started, to spot replies. With Autopilot on, it sends the emails and follow-ups the user asked it to send. |
| Website content | Yes, on device | Job pages the user analyses, kept in local history. |
| Health, financial, location, web history, user activity | No | |

**Certifications:**
- Hirivo does not sell or transfer user data to third parties, outside the approved use cases.
- Hirivo does not use or transfer user data for purposes unrelated to its single purpose.
- Hirivo does not use or transfer user data to determine creditworthiness or for lending.

**Where data goes when the user acts:**
- Resume text and job descriptions go only to the AI provider the user set up, only when they use an AI feature.
- Company names and domains go to the public sources above (job boards, RDAP, DNS, GitHub, Google News, Hacker News search) to check and research a job.
- Emails go to Gmail only when the user opens a compose window or, in power mode, saves a draft. The user always presses Send.

See [docs/privacy.md](docs/privacy.md) for the full policy.
