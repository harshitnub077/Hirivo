# Chrome Web Store Metadata & Review Justifications
**Extension Name**: Hirivo - Verified Job Outreach Assistant  
**Version**: 1.0.0  
**Category**: Productivity / Search Tools  
**Last Updated**: October 23, 2026  

---

## 1. Store Listing Copy

### Short Description (Max 132 chars)
Verify ghost jobs, check company domain age, get honest fit advice, and draft proof-linked outreach from your resume with zero ban risk.

### Detailed Description
Hirivo is the privacy-first, anti-ban job application outreach assistant that operates right in your browser's side panel.

Unlike spam automation bots that get your LinkedIn account banned, Hirivo follows the Zero-Ban Rule: strictly read-only analysis with no automated clicks, no auto-connects, and no mass auto-submits. You always stay in control.

KEY FEATURES:

1. GHOST-JOB SHIELD & REAL-TIME ATS SYNC
• Automatically verifies if a posting on LinkedIn, Naukri, or Indeed is still live on the company's official Greenhouse, Lever, or Ashby job board.
• Detects stale, cycled, and evergreen resume-collection postings to protect your outreach time.

2. COMPANY LEGITIMACY & DOMAIN AGE CHECK
• Direct ICANN RDAP domain registration check: flags domains created less than 90 days ago to warn you of potential fraudulent entities.
• Real-time DNS Mail Exchanger (MX) verification via DNS-over-HTTPS ensures the company has active Google Workspace or enterprise mail servers.
• Alerts you when corporate roles are posted with free personal webmail addresses.

3. HONEST FIT ADVISOR (POWERED BY LLAMA 3.1 8B INSTANT)
• The opposite of spray-and-pray. Calculates your true qualification match.
• If your match is below 55%, Hirivo honestly advises you "DO NOT APPLY" and pinpoints hard missing qualifications and actionable bridge-the-gap study recommendations.

4. PROOF-LINKED WRITING ENGINE
• Every claim or metric in generated outreach must link to an atomic fact in your uploaded resume (e.g., [FACT-03]).
• Prevents AI hallucinations and corporate fluff. Unsupported boasts are detected and blocked before you draft.

5. BANNED-PHRASE LINTER & VOICE FINGERPRINT
• Flags 50+ robotic clichés ("I hope this email finds you well", "delve", "testament to", "game-changer", "spearheaded") with 1-click human rewrites.
• Learns your natural writing style (sentence length, greeting, sign-off) from past emails.

6. WARM-PATH REFERRAL FINDER
• Import your official LinkedIn Connections CSV export (stored 100% locally in browser IndexedDB).
• Instantly detects 1st-degree connections and university alumni currently working at the target company.
• Generates warm, thoughtful referral request notes that convert 10x higher than cold emails.

7. SAFE GMAIL DRAFTS AUTOPILOT
• Creates drafts directly in your Gmail web app—never auto-sends.
• Automatically schedules Day 4 and Day 9 follow-up cadences.
• Detects incoming replies from recipients and automatically halts pending follow-ups.
• Enforces a configurable daily send cap to protect your email domain reputation.

---

## 2. Permissions Justifications (Chrome Web Store Review)

| Permission | Justification |
| :--- | :--- |
| `sidePanel` | Required to provide a persistent, docked intelligence workspace beside active job postings without obstructing page content. |
| `storage` | Required to store user settings, BYOK API keys, and local prompt response cache preferences. |
| `tabs` | Required to detect the URL and title of the active tab when analyzing job postings from LinkedIn, Naukri, and career sites. |
| `scripting` | Required to execute read-only content parsers on job board tabs upon user trigger. |
| `identity` | Required for Google OAuth authentication to create email drafts in the user's own Gmail account and check for incoming replies. |
| `alarms` | Required to schedule periodic local checks (every 4 hours) for outreach thread replies and follow-up cadences. |

### Host Permissions Justification
- `https://api.groq.com/*`, `https://generativelanguage.googleapis.com/*`, `https://openrouter.ai/*`: Required to send user-initiated prompt requests to the user's BYOK LLM provider.
- `https://*.rdap.org/*`, `https://rdap.org/*`: Required for client-side ICANN RDAP domain registration age queries.
- `https://dns.google/*`, `https://cloudflare-dns.com/*`: Required for DNS-over-HTTPS mail exchanger (MX) record verification.
- `https://boards-api.greenhouse.io/*`, `https://api.lever.co/*`, `https://api.ashbyhq.com/*`: Required to verify whether a job is actively listed on the employer's official ATS feed.
- `https://gmail.googleapis.com/*`: Required to create drafts in Gmail and check thread replies.
- `https://*.linkedin.com/*`, `https://*.naukri.com/*`, `https://*.indeed.com/*`, `https://*.wellfound.com/*`: Required for content script DOM extraction of job postings.

---

## 3. Privacy & Data Use Disclosure
- **Does Hirivo sell user data?** No. Zero data is sold or shared.
- **Is user data sent to external servers?** Only to the user's configured LLM provider (Groq / Gemini / OpenRouter) when generating fit analyses or drafts.
- **Where are resumes and LinkedIn connections stored?** 100% locally in the browser's IndexedDB (`HirivoDB`). No external databases or tracking servers are used.
