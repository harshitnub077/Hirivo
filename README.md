<p align="center">
  <img src="public/brand/hirivo-wordmark.svg" alt="hirivo" height="56">
</p>

<p align="center"><b>Get noticed. Get connected. Get hired.</b><br>
A free Chrome extension that finds real jobs that fit you, tells you honestly whether to apply, and helps you reach the right person, without ever risking your LinkedIn account.</p>

---

## What it does

1. **Reads your resume.** Upload a PDF, DOCX or TXT file. Hirivo fills in your profile (name, email, phone, links, college), pulls out your real achievements, and suggests roles that fit you.
2. **Finds jobs everywhere it is allowed to look.** Remotive, Remote OK, Himalayas, Jobicy, Arbeitnow, Hacker News "Who is hiring", and YC startups that are hiring (Hirivo finds each startup's own Greenhouse, Lever or Ashby board). Every job is ranked against your roles and skills, with reasons. India-first, with remote and worldwide options.
3. **Surfaces underrated companies.** You can filter to small teams (under 100 people). Small YC startups with no public job board are listed separately, so you can approach them directly.
4. **Checks the job is real and safe.** It looks for the role on the company's own hiring board and reads how long it has been open. Scam Shield flags fee demands, requests for OTPs or bank details, "task job" scams, personal Gmail recruiters impersonating real companies, chat-app-only interviews and recycled listings, and quotes the exact words that triggered each flag. Domain age and mail records catch fake companies.
5. **Tells you honestly if you fit, and how to close the gap.** It lists every requirement next to the resume fact that proves it, or marks it as a gap. The score is counted from that table (must-haves count twice), never guessed. For partial fits, a **Proof Sprint** plans a one-week project that closes your biggest gap. Finish it, and it becomes a resume fact your outreach can cite.
6. **Helps you apply.** On Greenhouse, Lever, Ashby and Workable forms, Hirivo fills in your details and attaches your resume. It marks the job as applied when the confirmation page appears. **You always press Submit.**
7. **Helps you reach the right person.** A ranked contact ladder: people you know there (from your own LinkedIn data export), then staff from the company's own website ranked by how close they are to the hiring decision (investors and quoted customers are filtered out), engineers in its GitHub org, then the careers inbox. Every contact says why it's ranked there. The Hook Finder pulls recent, linked news (company blog, GitHub releases, Hacker News, Google News) for your opening line. Then Hirivo writes a short email where every claim is backed by your resume. It opens the email in Gmail for you to send, then reminds you to follow up on day 4 and day 9.

8. **Answers application questions and writes cover letters** from the same facts, with the same check that nothing is claimed without proof.

Dark by default, with a light theme in You → Appearance. Press **Alt+H** on any page to open Hirivo.

## Install (developer mode)

```bash
npm install
npm run build
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `dist` folder. Click the Hirivo icon to open the side panel. Each CI run also uploads a ready-to-load `dist` as an artifact.

Optional: add a free [Groq key](https://console.groq.com/keys) under **You → AI keys** for better resume parsing, fit scores and writing. Without a key, resume reading, Discover, the watchlist, the job checks and autofill all still work.

## Safety rules (built into the code)

- **Never automates LinkedIn.** No auto-click, connect, message or apply. On LinkedIn or Naukri pages, Hirivo reads only what you're viewing, and only when you click.
- **Never submits anything for you.** Forms are filled; you press Submit. Emails open in Gmail; you press Send.
- **No fake data.** Scores come with reasons. Facts must trace back to your resume. Guessed emails are labelled as guesses.
- **Local-first.** Everything is stored in your browser. There is no Hirivo server. AI calls go straight to the provider you choose, with your key.
- **Credits its sources.** Every listing links back to where it came from, and each API is called within its stated limits.

## Development

```bash
npm run preview:panel   # dev server; open http://localhost:5199/sidepanel.html?demo for sample data
npm test                # unit tests (form filling against a real Greenhouse form, parsing, ranking, Discover end-to-end)
npm run test:live       # checks every live job source still answers in the expected shape
npm run verify-seeds    # re-checks the watchlist suggestion list against live boards
npm run generate-icons  # brand SVGs → PNG icons and store tile
```

See [HIRIVO_MASTER_PLAN.md](HIRIVO_MASTER_PLAN.md) for the roadmap, the rules every contributor follows, and ready-to-paste prompts for each next phase.
