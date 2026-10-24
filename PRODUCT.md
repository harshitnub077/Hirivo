# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: college students and freshers in India hunting internships and first jobs. Secondary: experienced job seekers. They use Hirivo in Chrome's side panel, next to the page they are on: LinkedIn, Naukri, Internshala, Indeed, Unstop, and company career pages (Greenhouse, Lever, Ashby, Workday). Many are applying in volume between classes, often late at night, on laptops of every size.

## Product Purpose

Hirivo is a job and internship automator. The user says once what they want (internship or job, city and radius, how recent, work mode, minimum stipend), and Hirivo finds the freshest matching jobs across job sites, checks each one is real and safe, scores the fit honestly, finds the company's people (founders, HR, hiring managers), writes and sends grounded emails from the user's own Gmail, prepares LinkedIn notes for the user to send, and fills the application. Success is more real applications and replies with less of the user's time, and no embarrassing or false claims sent in their name.

## Positioning

Hands-off but honest. It does the work for the user, yet every sentence it writes is traced to a line on the user's resume, it never acts on LinkedIn for them (no account risk), guessed email addresses are never sent to automatically, and everything stays in the user's browser: no Hirivo server, no account, no analytics.

## Operating Context

- Chrome MV3 side panel, about 360-420 px wide, opened next to a job page (Alt+H). Four tabs: Now (the job on screen), Radar (search and matches), Pipeline (outreach, Autopilot, LinkedIn notes, applications), You (resume, answers, keys, Gmail, Autopilot, appearance).
- An in-page results card on application forms ("Fill with Hirivo") and system notifications.
- AI runs on the user's own free Groq, Gemini or OpenRouter key, or Chrome's built-in AI.

## Capabilities and Constraints

- Search: LinkedIn (logged-out), Naukri, Indeed, Internshala, Unstop, YC startups, Hacker News, remote boards; posted time, distance, internship labels, source health.
- Checks: Real (on the company's own board, how long open), Fit (evidence table from resume facts), People, Safety (Scam Shield).
- People and email: company site, YC founders, LinkedIn pages the user reads, LinkedIn export, GitHub; email formats confirmed only by real addresses.
- Writing: grounded emails, LinkedIn notes (200 characters max), tailored resume, application answers.
- Fill: answers form questions from the profile, resume and job; leaves consent, diversity and personal questions to the user.
- Autopilot: opt-in; research, email, notes, fill and submit; optional automatic apply to new matches with limits.
- Technical: React 19 + TypeScript + Vite, Dexie (IndexedDB), lucide-react icons, Geist fonts bundled locally (MV3 CSP: no remote fonts or scripts). The content script must stay self-contained.
- Undecided: in-portal apply on Naukri and Internshala.

## Brand Commitments

- Name: Hirivo, written as the lowercase wordmark "hirivo".
- The green check-mark logo and the lowercase wordmark stay as they are (`public/brand/`). Everything else in the UI may change.
- Dark is the default theme; a light theme stays available (You → Appearance).
- Visual standing preference (Oct 2026): the category standard for a dark productivity tool, executed at the craft level of Linear, Raycast and Vercel/Geist. Not a novelty theme; no neon-hacker styling.
- Voice: plain, direct, specific; never hype, never invents. Tagline in the README: "Get noticed. Get connected. Get hired."

## Evidence on Hand

- Real behaviour verified live: searches returning jobs from Naukri, Indeed, Internshala and Unstop; fills on live Greenhouse, Lever and Ashby forms; YC founder lookups.
- Store screenshots in `store/` (from the demo panel, `src/sidepanel/demo.ts`).
- No user testimonials, usage numbers, press or ratings exist. Do not fabricate any.

## Product Principles

1. Do the work, but never say anything about the user that their resume doesn't back.
2. Show the reason behind every number and every action (why this score, why this person, why this question was left).
3. The user's accounts and data are theirs: nothing on LinkedIn is automated, nothing leaves the browser except to the services the user chose.
4. Automation is opt-in and visible: every step Autopilot takes is logged where the user can see it.
5. Be fast to scan in a narrow panel: the next action is always obvious.

## Accessibility & Inclusion

WCAG 2.2 AA in both themes: text contrast, visible focus, full keyboard use, and reduced-motion respected. Many users are on low-end laptops: motion and effects must stay light.
