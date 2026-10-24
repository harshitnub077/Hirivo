# Chrome Web Store listing

**Name:** Hirivo: Real Jobs, Right People
**Version:** 2.8.0
**Category:** Productivity

## Short description (≤132 chars)
Checks if a job is real, tells you honestly if you fit, finds who to message, and writes outreach that sounds like you.

## Detailed description
Upload your resume and Hirivo fills your profile, suggests roles that fit, and finds matching jobs from Remotive, Remote OK, Himalayas, Jobicy, Arbeitnow, Hacker News "Who is hiring" and YC startups. It ranks every job with clear reasons, and can show only small teams. It tailors your resume to each job without adding a single claim, and fills Greenhouse, Lever, Ashby, Workday and 9 other application forms with your details and resume; you press Submit.

Next to any job posting, press Analyze and it answers four questions:

**Is it real?** Hirivo looks for the role on the company's own hiring board (Greenhouse, Lever, Ashby) and reads how long it has been open. Stale or missing roles are flagged before you spend time on them.

**Is the company safe?** Domain age and mail records catch fake companies, and Hirivo reminds you that real employers never charge fees.

**Do you fit?** Hirivo scores your resume against the job honestly. If it's a long shot, it says so and shows what to learn first.

**Who do I message, and what do I say?** It shows people you already know there (from your own LinkedIn data export) and helps you find the hiring manager. Then it writes a short email where every claim is backed by a line from your resume, in your own voice, with robotic clichés removed.

Then Hirivo opens the email in Gmail for you to send, and reminds you to follow up on day 4 and day 9.

**Radar** follows the companies you care about and notifies you when a matching role is posted.

**Safe for your LinkedIn account.** Hirivo never clicks, connects or sends anything on LinkedIn. It reads the job you are viewing only when you press Analyze.

**Private.** There is no Hirivo server. Your resume, contacts and history stay in your browser. AI runs on your own free Groq or Gemini key, or on Chrome's built-in AI where available.

## Permission justifications

| Permission | Why |
|---|---|
| `sidePanel` | Hirivo's interface lives in the side panel. |
| `storage` | Remembers daily AI usage counts locally. |
| `scripting` | Reads the job on the current tab when the user presses Analyze. |
| `activeTab` | Allows Analyze on the tab the user opened Hirivo from, without broad access. |
| `alarms` | Checks watched companies every 6 hours, follow-ups every 3 hours, Discover every 12 hours, and builds the Daily 5 at 8:00 local time. |
| `notifications` | Tells the user about new matching roles, due follow-ups, the morning Daily 5, and a one-time nudge a week after applying. |
| Host: `api.groq.com`, `generativelanguage.googleapis.com`, `openrouter.ai` | Sends the user's own AI requests to the provider they chose, with their key. |
| Host: `rdap.org`, `dns.google` | Domain age and mail-record checks for company legitimacy. |
| Host: `boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com` | Reads public job-board feeds to confirm roles are live and power Radar. |
| Host: LinkedIn, Naukri, Indeed, Wellfound, Instahyre, Cutshort, foundit | Reads the job page on Analyze only. No script runs on these sites by itself. |
| Host: `*.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `apply.workable.com` | Reads job pages, fills application forms and attaches the user's resume. The user always submits. |
| Host: `remotive.com`, `remoteok.com`, `himalayas.app`, `jobicy.com`, `www.arbeitnow.com`, `hn.algolia.com`, `yc-oss.github.io` | Public job APIs and open datasets for Discover. Each listing is credited and links to its source. |
| Host: `api.github.com`, `news.google.com` | GitHub org members and releases, and Google News headlines, for the contact ladder and opening-line suggestions. |
| Optional `identity`, optional host: `gmail.googleapis.com`, `oauth2.googleapis.com` | Asked only if the user connects Gmail with their own Google OAuth client: sign-in, saving drafts, and reading their own threads to spot replies. |
| Optional host: `https://*/*` | Requested one site at a time, only when the user presses Analyze, Look up or Read this page on a site outside the list above. |

## Data use disclosure
- Hirivo does not sell, share or transfer user data, and has no server.
- Resume text and job descriptions are sent only to the AI provider the user configured, only when they use an AI feature.
- With optional Gmail power mode, Hirivo talks to Gmail directly from the browser using the user's own Google app; tokens stay on the device and are never exported.
- LinkedIn connections, outreach history and settings are stored in the browser's IndexedDB and can be exported or deleted from You → Privacy and safety.
