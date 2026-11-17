# Checking Hirivo end to end

Run these before every release. Steps 1–2 need nothing but Node 22; steps 3–5 need Chrome.

## 1. Install

```bash
npm ci
```

## 2. Automatic checks (the same ones CI runs on every push)

```bash
npm run check
```

That is `typecheck` (tsc), `lint` (ESLint), `test` (all unit tests) and `build` (writes `dist/`). All four must pass.

## 3. Load the built extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → choose the `dist/` folder.
3. Click the Hirivo icon (or press Alt+H) to open the side panel.

## 4. Manual walkthrough

| Area | What to do | What should happen |
|---|---|---|
| First run | Upload a resume (PDF, DOCX or TXT) | Profile fills, roles are suggested, only facts the resume backs are kept |
| AI keys | Add a free Groq or Gemini key in You | Usage shows in You; nothing works silently without a key where AI is needed |
| Analyze | Open a Greenhouse, Lever or Ashby job and press Analyze | Real / Safety / Fit verdicts with reasons and the evidence table |
| Write | Write tab → draft an email | Every claim traces to a resume fact; Open in Gmail prefills a compose window |
| Radar | Edit the search, add an excluded company and title word, Search now | Results arrive; excluded jobs are not listed; Sources shows each site's health |
| Daily 5 | Wait for 8:00 or check Now | At most 5 picks, max 2 per company, no Doubtful/Risky role, no excluded job |
| Autofill | Open a Greenhouse application form | Fields fill; consent boxes stay unticked; nothing is submitted |
| Autopilot | Turn it on in You, hand over one job | Steps logged in Pipeline; the panel shows the daily limit (10 unless set, 25 at most) and minimum fit |
| Applied | Submit an application on a board you opened from Discover | That job moves to Applied; a submission on an unrelated board leaves statuses alone and notifies you |
| Tabs | Run a search with Autopilot working | Never more than 2 background tabs open at once |
| Data | You → Export, then Delete everything | Export has no keys or Gmail tokens; delete empties the panel |

## 5. Optional live checks

```bash
npm run test:live
```

Checks every live job source still answers in the expected shape (needs network).

```bash
npm run build && GROQ_API_KEY=your-key npm run test:e2e
```

Drives the built extension in a throwaway Chrome profile with real AI keys; screenshots land in `tests/e2e/shots/`.
