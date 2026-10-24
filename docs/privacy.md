# Hirivo privacy policy

**Effective:** 24 October 2026
**Applies to:** the Hirivo Chrome extension, version 2.11.0 and later

Hirivo is built so that your job search stays yours. There is no Hirivo server, no Hirivo account and no analytics. The people who make Hirivo cannot see your resume, your contacts, your messages or which jobs you look at.

## The short version

- Everything Hirivo knows about you is stored in your own browser.
- Hirivo sends data only where you point it: your chosen AI provider, the public sources that check a job, and Gmail when you choose to send.
- Hirivo finds business contact details only, never personal emails or phone numbers, and labels guessed addresses as guesses.
- You can export or delete everything at any time from **You → Privacy and safety**.

## What Hirivo stores, and where

All of this lives on your computer, in the browser's IndexedDB database for Hirivo (`HirivoDB`) and in the extension's local storage. None of it is synced to your Google account or sent to Hirivo.

| What | Where it comes from |
|---|---|
| Your profile: name, email, phone, college, links | You type it in, or Hirivo reads it from the resume you upload |
| Application answers: current company and title, degree, notice period, current and expected salary, countries you can work in, languages | You type them in (some come from your resume); Fill uses them on application forms |
| Resume facts and your original resume file | The resume you upload |
| Jobs you analyse or save, with their verdicts | Pages you open and press Analyze or Save jobs on, and the public job boards Discover reads |
| Connections | The `Connections.csv` file you export from LinkedIn yourself and import |
| Contacts at a company | The company's own public team page, its public GitHub organisation, and its published hiring inbox |
| Drafts and outreach history | What you write and send with Hirivo |
| Your writing style | Sample emails you paste in, reduced to style notes |
| AI keys | You paste them in; they stay in this browser |
| Gmail connection (optional) | Your own Google OAuth client ID and secret, and the tokens Google returns |
| Caches | Recent AI answers, job-board results, company site lookups and daily AI usage counts, to save your free quota |

## Where your data goes

Hirivo sends data off your computer only in these cases, and only directly from your browser to the service named.

**Your AI provider.** When you use an AI feature (writing an email, checking fit, tailoring your resume), Hirivo sends the job description and the relevant resume facts to the provider you set up: Groq, Google Gemini or OpenRouter, using your own key. Their privacy policies apply to that request. If your computer supports Chrome's built-in AI, some checks run on your device and nothing is sent. Many features, including Scam Shield's rules, the keyword check and autofill, use no AI at all.

**Public sources that check a job.** To tell you whether a job is real and safe, Hirivo looks up the company's name or domain on public services: Greenhouse, Lever and Ashby job boards, RDAP (domain age), Google's public DNS (mail records), GitHub, Google News and Hacker News search. These requests contain the company name or domain, not your personal details.

**Job sites for your search.** Hirivo asks LinkedIn (its public job listings, without your LinkedIn sign-in), Naukri, Indeed, Internshala, Unstop, Remotive, Remote OK, Himalayas, Jobicy, Arbeitnow, Hacker News search and the open YC company list for open roles. Naukri and Indeed are read by opening their results page in a background tab, which closes after reading. A request contains your search: role words such as "frontend intern", the city and radius, and how recent. It never includes your name, email or resume.

**Pages you open.** When you press Analyze, Save jobs or Read people on this page, Hirivo reads the page in that tab, on your computer. If you turn on autofill, Hirivo fills your saved details into application forms on Greenhouse, Lever, Ashby, Workable, Workday and similar sites, and attaches your resume. When you press Fill with Hirivo, the open questions on that form (for example "Why do you want to work here?") are sent with your resume facts to your AI provider to write answers. Hirivo never ticks consent boxes, never answers diversity questions unless you chose "decline to self-identify" in Hirivo, and nothing is submitted until you press Submit.

**Gmail.** By default, Hirivo opens a Gmail compose window with your draft filled in, and you press Send. If you choose to connect Gmail power mode with your own Google OAuth client, Hirivo talks to the Gmail API directly from your browser to save drafts in your account (with your resume attached, if you choose) and to read the threads it started, so it can tell when someone has replied. It does not read other email. You can disconnect at any time from **You → Gmail**, and you can revoke access from your Google account's security settings.

**Autopilot (only if you turn it on).** For each job you hand it, Autopilot reads the posting and the company's public website, writes to people at the company whose work address is listed publicly, in your own LinkedIn export, in the company's email format proven by real addresses there, or the company's hiring inbox, and sends those emails from your Gmail with your resume attached. It then fills and submits the application on the job's own application form. It also writes LinkedIn notes for you to send yourself. If you turn on "Apply automatically to new matches", Autopilot does the same for the best new jobs from each search, within the limits you set. For jobs found on LinkedIn it reads LinkedIn's public job page without your LinkedIn sign-in, and looks for the same job on the company's own Greenhouse, Lever or Ashby board by asking those boards' public APIs for the company's open roles. It never emails a guessed address, never ticks consent boxes, never solves CAPTCHAs, and never acts on LinkedIn. Everything it does is logged in Hirivo → Pipeline.

Hirivo does not sell, rent or share your data with anyone, does not use it for advertising, and does not use it for any purpose other than helping you find and apply for jobs.

## Contact details of other people

Hirivo helps you find the right person to contact at a company. It follows strict limits:

- **Business details only.** Hirivo looks for work email addresses at the company's own domain and the company's published hiring inboxes. It never looks up personal email addresses or phone numbers.
- **Guesses are labelled.** When Hirivo suggests an address from a common pattern (like `first.last@company.com`), it marks it as a guess, and only suggests it if the company's domain receives mail.
- **Public, work-related sources only.** Names and roles come from the company's own team page, its public GitHub organisation, its public YC company page (founders), your own LinkedIn connections export, or a LinkedIn page you open and ask Hirivo to read. Hirivo learns a company's email format (for example first.last@) only from real addresses at that company: ones listed on its site, in your export, or in its public GitHub commits. Those commit addresses are used only to learn the format; Hirivo doesn't store them or write to those people. Hirivo leaves out investors, customers quoted in testimonials and people who work elsewhere.
- **Nothing is collected in bulk.** Hirivo looks up one company at a time, when you ask, and keeps the result only on your computer.

## Your keys and Gmail tokens

Your AI keys, your Google OAuth client secret and your Gmail tokens are stored only in this browser's local database. They are never synced, never sent anywhere except to the service they belong to, and never included in an export. When you import a backup, your current keys stay as they are.

## LinkedIn

Hirivo never uses your LinkedIn session to search. Your saved search reads LinkedIn's public job listings, the same ones anyone sees without signing in, and sends no LinkedIn cookies. On LinkedIn pages, Hirivo reads the job, search results or people you are looking at only when you press Analyze, Save jobs or Read people on this page. It writes connection notes for you to paste, and it never clicks, connects, messages or applies on LinkedIn for you.

## Export and delete

- **Export:** You → Privacy and safety → Export downloads everything Hirivo stores as a JSON file, with your keys and Gmail tokens removed.
- **Delete everything:** You → Privacy and safety → Delete everything erases Hirivo's database and local storage on this computer. It cannot be undone.
- **Uninstall:** removing the extension from Chrome removes all its data.

## Children

Hirivo is meant for job seekers and is not directed at children under 16.

## Changes

If this policy changes, the new version will be published at this address with a new effective date, and the change will be listed in the release notes. Hirivo will never start sending your data somewhere new without asking you first.

## Contact

Questions or concerns: open an issue at [github.com/harshitnub077/Hirivo/issues](https://github.com/harshitnub077/Hirivo/issues).
