---
version: 1
slug: "src-sidepanel"
primary_target: "src/sidepanel"
related_targets: []
---

# Side panel (src/sidepanel)

Scope: the whole Hirivo side panel: Now, Radar, Pipeline, You, and shared components. Mode: Operate.
Audience and job: Indian students and freshers scanning matches, judging one job, watching Autopilot, setting up once. All four tabs are daily surfaces.
Constraints: 360-420 px wide; dark default with a light theme; WCAG AA; brand mark and wordmark unchanged; bundled fonts only (MV3 CSP); light motion for low-end laptops; reduced motion honored.
Avoid: bland corporate. The user chose the category standard on purpose, benchmarked against Linear, Raycast and Vercel/Geist.

## Direction contract

THESIS: A precise dark instrument, not a stack of cards. Linear's calm hierarchy, Raycast's dense keyboard-fast lists, Geist's strictness. Refuses the default of every block boxed in a rounded, shadowed card, gradient glows and pill soup.

OWN-WORLD: Neutral near-black ground with three surface steps separated by 1px hairlines, never drop shadows except on floating layers. Geist for text, Geist Mono tabular figures for every number. Jade only for verified, primary and selection; amber caution; coral risk. 8px control radius, 12px for the few true containers. Full-bleed list rows with hover fill and a left accent bar on selection. Lucide icons at 1.75 stroke on a two-step scale (amended at review): 16px for controls, rows and navigation; 14px inline with small text. Keyboard hints as small mono kbd chips only for real shortcuts (Alt+H); none are invented.

STORY: Open the panel and the job on screen is already judged; the next action is always the one jade button. Radar is a ranked list you scan in seconds; Pipeline shows work moving; You is a quiet settings sheet.

FIRST VIEWPORT: Now. A 44px header (mark, wordmark, current host chip). Job title 17px semibold, company and place muted below. One hairline-divided verdict strip: four equal cells (icon, label, value) with state colour on the value only. Under it, the primary action row: jade "Hand to Autopilot", a secondary "Write". Then underline sub-tabs (Evidence, People, Write, Resume, Answers) with a sliding indicator, and content as flat sections headed in 13.5px semibold ink (amended at review: small muted headers read as eyebrows; the ink heading carries the section). Bottom nav: four icons with labels and a sliding active pill.

FORM: the category standard (canon card), chosen by the user over the roll; benchmarks Linear, Raycast, Vercel/Geist. Seed key a77b00bc.

SIGNATURE INTERACTION AND MOTION: one motion grammar: 160-220ms, ease-out-expo; a sliding indicator under every tab set and the bottom nav; view changes fade with a 6px rise; list rows stagger 18ms (first 8 only); the verdict values count up and the verified check draws its stroke once; buttons press to 0.98; skeleton shimmer while loading. All of it off under prefers-reduced-motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
