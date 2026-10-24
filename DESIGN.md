---
name: Hirivo
description: A precise dark instrument for judging, chasing and applying to jobs from Chrome's side panel.
colors:
  ink: "#ededef"
  ink-2: "#b6b7bd"
  muted: "#8b8c94"
  paper: "#08090a"
  surface: "#0e0f11"
  surface-2: "#141518"
  surface-3: "#1b1c20"
  well: "#0b0c0e"
  line: "#1d1e22"
  line-strong: "#2a2b31"
  hover: "rgb(255 255 255 / 0.04)"
  press: "rgb(255 255 255 / 0.07)"
  brand: "#4bc994"
  brand-strong: "#6dd8a9"
  brand-ink: "#04140c"
  brand-soft: "rgb(75 201 148 / 0.1)"
  brand-line: "rgb(75 201 148 / 0.32)"
  caution: "#efb44f"
  caution-soft: "rgb(239 180 79 / 0.1)"
  risk: "#f37868"
  risk-soft: "rgb(243 120 104 / 0.1)"
  light-ink: "#0b0b0d"
  light-ink-2: "#3c3d44"
  light-muted: "#64656d"
  light-paper: "#fafafa"
  light-surface: "#ffffff"
  light-surface-2: "#f4f4f5"
  light-surface-3: "#ececee"
  light-well: "#ffffff"
  light-line: "#e7e7ea"
  light-line-strong: "#d4d4d8"
  light-hover: "rgb(10 10 12 / 0.035)"
  light-press: "rgb(10 10 12 / 0.06)"
  light-brand: "#08774e"
  light-brand-strong: "#066642"
  light-brand-ink: "#ffffff"
  light-brand-soft: "rgb(8 119 78 / 0.08)"
  light-brand-line: "rgb(8 119 78 / 0.3)"
  light-caution: "#9a5800"
  light-caution-soft: "rgb(154 88 0 / 0.08)"
  light-risk: "#bf2a1d"
  light-risk-soft: "rgb(191 42 29 / 0.07)"
typography:
  wordmark:
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.28
    letterSpacing: "-0.022em"
  title:
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.012em"
  body:
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'ss01', 'cv11'"
  body-small:
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  value:
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  score:
    fontFamily: "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "'tnum'"
  numeric:
    fontFamily: "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace"
    letterSpacing: "-0.02em"
    fontFeature: "'tnum'"
  mono-small:
    fontFamily: "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "-0.01em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "999px"
spacing:
  row-gap: "8px"
  stack: "10px"
  block: "12px"
  gutter: "14px"
  section: "16px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.brand-strong}"
    textColor: "{colors.brand-ink}"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-3}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  button-small:
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
    height: "32px"
  pill:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  pill-ok:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.brand}"
  pill-caution:
    backgroundColor: "{colors.caution-soft}"
    textColor: "{colors.caution}"
  pill-risk:
    backgroundColor: "{colors.risk-soft}"
    textColor: "{colors.risk}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "26px"
  chip-on:
    backgroundColor: "{colors.brand-soft}"
    textColor: "{colors.ink}"
  verdict-strip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  verdict-cell:
    typography: "{typography.value}"
    padding: "9px 10px 10px"
    height: "58px"
  callout:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  topbar:
    textColor: "{colors.ink}"
    padding: "0 14px"
    height: "44px"
  host-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    typography: "{typography.mono-small}"
    rounded: "{rounded.sm}"
    padding: "0 9px"
    height: "24px"
  segmented:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.md}"
    padding: "3px"
  segmented-indicator:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.sm}"
  tabbar-indicator:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
  kbd:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.xs}"
    padding: "0 5px"
    height: "18px"
---

# Design System: Hirivo

## Overview

**Creative North Star: "The Precise Dark Instrument"**

Hirivo's side panel is a measuring instrument, not a stack of cards. A neutral near-black ground carries three surface steps that are told apart by 1px hairlines rather than shadows; every number is set in Geist Mono with tabular figures, and colour is spent only where it carries meaning: jade for verified, primary and selected, amber for caution, coral for risk. The craft benchmark is the category standard for a dark productivity tool: Linear's calm hierarchy, Raycast's dense lists, Geist's strictness.

The panel lives at 360-420px, so density is the point. Top-level blocks run full-bleed and are split by a hairline; lists are rows with a hover fill and inset dividers, not boxes. Headings are ink, not muted labels. Motion follows one grammar (a 140ms state change, a 200ms movement, ease-out-expo), with longer reveals kept for data that has just been measured, and all of it collapses under reduced motion.

Dark is the default. The light theme is a full, independently tuned token set (deeper jade, darker amber and coral for AA on white), not an inversion. The green check mark and the lowercase "hirivo" wordmark are fixed brand assets and stay as they are. Rejected on purpose: every block boxed in a rounded, shadowed card; gradient glows; pill soup; neon-hacker styling.

**Key Characteristics:**
- Neutral near-black ground with three surface steps and 1px hairlines; flat by default.
- Geist for text, Geist Mono tabular figures for every number.
- One jade primary action per view; state colour sits on values, not surfaces.
- Full-bleed hairline sections and row lists instead of cards.
- Lucide icons at 1.75 stroke on a two-step scale (16px / 14px).
- One motion grammar: 140ms / 200ms, cubic-bezier(0.16, 1, 0.3, 1), sliding indicators, all off under reduced motion.

## Colors

A neutral graphite instrument with one jade voice and two warning tones, tuned separately for dark and light.

### Primary
- **Instrument Jade** (`brand`; light `light-brand`): verified results, the one primary button, the active nav icon, the tab underline, selection states (checked boxes, chosen chips and role options, focused inputs), links and the brand half of the mark. Its hover is **Lit Jade** (`brand-strong`), and text on it is **Jade Ink** (`brand-ink`, near-black in dark, white in light).
- **Jade Wash** (`brand-soft`) and **Jade Rule** (`brand-line`): the tinted fill and border of an ok pill, ok callout, chosen chip, fact tag, dropzone hover and empty-state tile.

### Secondary
- **Caution Amber** (`caution`, wash `caution-soft`): a value that needs attention (partial fit, due follow-up), the "waiting on you" nav dot, caution callouts and pills.

### Tertiary
- **Risk Coral** (`risk`, wash `risk-soft`): a value that is unsafe or failing, risk callouts and pills, danger buttons. Never used as an attention dot.

### Neutral
- **Signal White** (`ink`): headings, values, primary text.
- **Soft Graphite Text** (`ink-2`): secondary text, button labels on ghost buttons, field labels, callout body.
- **Quiet Graphite** (`muted`): metadata, cell labels, inactive nav and tab labels, placeholders.
- **Panel Black** (`paper`): the ground of the whole panel.
- **Surface steps** (`surface`, `surface-2`, `surface-3`): the verdict strip and callouts; buttons, pills and the nav indicator; hover and the segmented indicator.
- **Well** (`well`): recessed ground for inputs, checkboxes and segmented tracks.
- **Hairline** (`line`) and **Strong Hairline** (`line-strong`): section dividers and row dividers; control borders.
- **Hover / Press veils** (`hover`, `press`): translucent fills over any surface.

Light theme values carry the `light-` prefix and are applied under `data-theme='light'` and under `data-theme='system'` when the OS prefers light.

### Named Rules
**The One Jade Rule.** Each view state shows one jade primary button; everything else is a secondary (surface) or ghost button. Jade elsewhere means verified or selected, never decoration.

**The Value Carries the State Rule.** In the verdict strip and the fit score, amber, coral or jade colours the value and its icon only; the cell, its label and its background stay neutral. Tinted washes appear only on elements that are themselves the message (callouts, pills, chosen chips).

**The Badge Dot Rule.** On the bottom nav, a jade dot means something new to see, an amber dot means something waiting on the user. Coral is reserved for risk and is never a dot.

## Typography

**Body Font:** Geist Variable (with ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif)
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, 'SF Mono', Menlo, monospace)

Both are bundled through @fontsource-variable; MV3's CSP allows no remote fonts. Body text enables stylistic sets `ss01` and `cv11`.

**Character:** One tight grotesque for everything said, one mono for everything measured. Negative tracking grows with size; there is no display tier, because the panel never shouts.

### Hierarchy
- **Headline** (600, 17px, 1.28, -0.022em, balanced wrap): the job title on Now, the single top heading of a view.
- **Title** (600, 13.5px, 1.35, -0.012em, ink): section headings, empty-state titles, list row names.
- **Body** (400, 13px, 1.5): running text and controls.
- **Body small** (400, 12.5px): checklists, evidence rows, empty-state copy, setup steps.
- **Label** (500, 12px): field labels, segmented options, small buttons, pill text at 11.5px.
- **Value** (600, 14px, 1.15, -0.015em): the answer in each verdict cell.
- **Score** (Geist Mono 600, 28px, 1, -0.04em, tabular): the fit percentage.
- **Numeric** (Geist Mono, tabular, -0.02em): every count, percentage and number; CountUp renders through it.
- **Mono small** (Geist Mono 10.5-11.5px): the host chip, kbd keys, fact tags, timeline days, evidence kinds.
- **Wordmark** (600, 15px, -0.025em): "hirivo", lowercase, beside the 22px mark.

### Named Rules
**The Mono Figures Rule.** Every number on screen is Geist Mono with tabular figures, so columns of counts and scores align and read as measured.

**The Ink Heading Rule.** A section is headed by a 13.5px semibold ink title. Small muted text over a section reads as an eyebrow and is not a heading.

## Layout

A single column inside a 14px gutter (`gutter`), max 560px, in a three-row shell: a 44px top bar, a scrolling content region, and the bottom navigation. The top bar and bottom nav are translucent paper (88% and 92%) with a 10px backdrop blur and a hairline edge.

Top-level blocks in a view are sections, not cards: they bleed to the panel edge (negative gutter margin), take 16px vertical padding and are divided by a 1px hairline; the last loses its rule. Sections nested inside a panel (Evidence, People) are flattened the same way with zero side padding. Non-section blocks sit 12px apart. Inside a section, stacks use 10px gaps and rows 8px.

Sub-navigation (Evidence, People, Write, Resume, Answers) is a full-bleed underline tab bar that sticks to the top of the scroll region. Lists extend 8px past the content edge so the hover fill has room, with dividers inset 8px.

The layout does not reflow between 360 and 420px; it narrows. The verdict strip keeps four equal cells; text wraps, and the host chip truncates at 58% of the bar.

### Named Rules
**The Hairline Section Rule.** A top-level block is a full-bleed section split by a 1px hairline, never a rounded, bordered card floating in the gutter.

## Elevation & Depth

Flat by default. Depth comes from the three surface steps, 1px hairlines and translucent veils, not shadows. Raised controls (buttons, the nav and segmented indicators, the verdict strip) carry a 1px inner top highlight in dark (`--sheen`), removed in light. The primary button alone carries a faint lift so the jade action sits forward. A floating-layer shadow is defined for menus and popovers and is the only full drop shadow the system allows.

### Shadow Vocabulary
- **Sheen** (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04)`; light: none): top-edge highlight on raised controls.
- **Primary lift** (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.18), 0 1px 2px rgb(0 0 0 / 0.25)`): the jade button only.
- **Float** (dark `0 0 0 1px var(--line-strong), 0 12px 32px -12px rgb(0 0 0 / 0.75), 0 2px 6px -2px rgb(0 0 0 / 0.5)`): floating layers only.
- **Focus ring** (`0 0 0 2px var(--paper), 0 0 0 4px` jade at 60% dark / 45% light): every keyboard-focusable control. Inputs instead take a jade border plus a 3px `brand-soft` halo.

### Named Rules
**The Flat-by-Default Rule.** Surfaces never cast shadows at rest. A shadow means the element floats above the panel or has keyboard focus.

## Shapes

Rounded but tight. Controls (buttons, inputs, segmented track, list row hover, callouts) take 8px (`md`); pills, chips, the host chip and the segmented indicator take 6px (`sm`); kbd keys and fact tags take 4px (`xs`). The few true containers (the verdict strip, the dropzone, the empty-state icon tile) take 12px (`lg`). Fully round (`full`) is kept for meters, scrollbar thumbs and status dots. Checkboxes are 16px squares at 5px. Disclosure chevrons are drawn as rotated 1.75px border corners, matching the icon stroke.

Icons are Lucide at 1.75 stroke on two sizes: 16px for controls, rows and navigation; 14px inline with small text (meta lines, pills, chips, small buttons, verdict labels, callouts, checklists, evidence). The stylesheet enforces this whatever size a component passes. The empty state is the one exception: a 40px jade tile.

### Named Rules
**The Two-Step Icon Rule.** Icons are 16px or 14px at 1.75 stroke, nothing else; the size follows the text they sit with.

## Components

### Buttons
Quiet, exact controls that press.
- **Shape:** gently rounded (8px), 32px tall, 12px side padding; small is 28px with 10px padding and 12px text; icon-only buttons are square.
- **Primary:** jade fill, jade-ink label at 600, primary lift. Hover lightens to Lit Jade.
- **Secondary (default):** surface-2 fill, strong hairline border, sheen; hover moves to surface-3 with a brighter border.
- **Ghost:** transparent, ink-2 label; hover adds the hover veil and ink label.
- **Danger:** coral label; hover adds the coral wash and border.
- **States:** press scales to 0.98 at 140ms; disabled drops to 45% opacity; focus shows the jade ring.

### Chips
- **Style:** 26px, 6px radius, strong hairline border, transparent, ink-2 text at 12px.
- **State:** on adds the jade wash and rule, ink text and a 6px jade dot before the label.

### Pills
- **Style:** 22px, 6px radius, surface-2 with a strong hairline, 11.5px medium text. Tones (ok, caution, risk) swap to the matching wash, border and coloured text. In a collapsible settings row a pill becomes plain coloured text, not a badge.

### Verdict Strip (signature)
The four answers on Now (Real, Fit, People, Safety) as one instrument: a 12px container on surface with a strong hairline and sheen, four equal cells split by 1px hairlines. Each cell stacks a muted 11px label with its 14px icon over a 14px semibold value; state colour falls on the value and icon only. On a fresh result the values rise in with a 3px blur, staggered 60ms; Fit counts up. While loading, values become shimmer bars.

### Cards / Containers
- **Corner Style:** 12px only when a block is a true container (verdict strip, dropzone); at view level a card is flattened into a hairline section.
- **Background:** surface; `raised` uses surface-2 with sheen.
- **Border:** 1px hairline.
- **Internal Padding:** 14px; 16px vertical as a section.

### Callouts
8px radius, 10px 12px padding, 12px ink-2 text on surface with a hairline. Ok, caution and risk swap to the matching wash with a 32-34% border and ink text. They drop in from 3px above.

### Inputs / Fields
- **Style:** well fill, strong hairline, 8px radius, 32px minimum, 13px text; textareas resize vertically at 1.55 leading. Selects carry a drawn 12px chevron.
- **Focus:** jade border plus a 3px jade-wash halo; hover brightens the border.
- **Field:** 12px medium ink-2 label above, 11.5px muted hint below, 5px apart.
- **Checkbox:** 16px, 5px radius; checked fills jade and the tick scales in over 200ms.

### Lists
Rows, not boxes: 10px 8px padding, 8px radius on the hover fill, inset 1px dividers that disappear around the hovered row. Rows rise 4px on entry, staggered 18ms over the first eight. The Daily 5 list numbers each row with a 20px mono rank tile on the jade wash.

### Navigation
- **Top bar:** 44px; 22px mark and lowercase wordmark on the left, the current host on the right as a 24px mono chip with a 6px jade dot.
- **Bottom nav:** four equal buttons (Now, Radar, Pipeline, You), 16px icon over an 11.5px medium label. One 8px surface-2 indicator slides between them in 200ms. The active label is ink and its icon jade, lifted 1px; inactive labels are muted. A 7px badge dot with a paper ring scales in at the icon's top right (see the Badge Dot Rule).
- **Segmented control:** well track with 3px padding; a surface-3 indicator with sheen slides and resizes to the chosen option. The first placement does not animate.
- **Underline tabs:** the same component, full-bleed and sticky on a 97% paper blur; the indicator becomes a 2px jade underline sitting on the hairline.

### Meters and Timeline
4px fully rounded meters on surface-3, filled jade, amber or coral, growing over 520ms. The follow-up timeline is three 2px rails: done rails draw in jade, a due rail and its label are amber.

### Keyboard Hints
Small mono keycaps (18px, 4px radius, 2px bottom border on surface-2) only for real shortcuts. Today that is Alt+H.

### Motion
One grammar: 140ms (`--t-fast`) for colour, border and press; 200ms (`--t`) for movement (indicators, view entry, chevrons, ticks), both on ease-out-expo `cubic-bezier(0.16, 1, 0.3, 1)`. Views fade in from 25% with a 6px rise. Longer durations are kept for data reveals: rows 260ms, verdict values 360ms, meters and the verified-check stroke draw 520ms, timeline rails 600ms, CountUp 650ms with a quartic ease-out. Skeletons shimmer on a 1.1s linear loop.

### Named Rules
**The Still Number Rule.** A count that cannot run must never leave a wrong value on screen. CountUp shows the real number at once when reduced motion is set or the document is hidden, and a settle timer lands it on the value if frames stop mid-count.

**The Reduced Motion Rule.** Under `prefers-reduced-motion: reduce`, every animation and transition collapses to 0.01ms with no delay. Nothing depends on motion to be understood.

## Do's and Don'ts

### Do:
- **Do** build every colour from the theme tokens and give each new token a light value tuned for AA, not an inversion.
- **Do** split top-level blocks with a 1px hairline and run them full-bleed.
- **Do** keep one jade primary per view state; make the rest secondary or ghost.
- **Do** put state colour on the value and its icon, and leave labels muted.
- **Do** set every number in Geist Mono with tabular figures.
- **Do** use Lucide at 1.75 stroke, 16px with controls and rows, 14px with small text.
- **Do** move things with 140ms / 200ms on cubic-bezier(0.16, 1, 0.3, 1), and slide one indicator rather than swapping highlights.
- **Do** head sections with 13.5px semibold ink titles.
- **Do** keep the check-mark logo and the lowercase "hirivo" wordmark exactly as they are.

### Don't:
- **Don't** box top-level blocks in rounded, bordered, shadowed cards.
- **Don't** cast shadows on resting surfaces; shadows are for floating layers and focus.
- **Don't** use gradient glows or neon accents; the only gradient is the loading shimmer.
- **Don't** use fully rounded capsule badges; pills and chips are 6px.
- **Don't** put small muted or uppercase labels above sections as headings.
- **Don't** use coral for anything but risk, or a badge dot for anything but new (jade) or waiting (amber).
- **Don't** show keyboard hints for shortcuts that don't exist.
- **Don't** ship motion that survives reduced motion, or a counter that can rest on a wrong number.
