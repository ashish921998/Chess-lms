# Design System — Castle Academy ("Paper Mono")

The single source of truth for how Castle Academy looks and feels. Read this
before any visual or UI work. It governs **every** surface — the marketing
site, the student app, and the tutor app — not just the homepage.

Reference implementation: `src/app/globals.css` (landing page) and
`src/app/page.tsx`. Live comparison of directions that were considered:
`design-variants.html` (variant **I — Paper Mono** was chosen).

---

## Product Context
- **What this is:** A private chess LMS. Tutors assign calibrated puzzle sets; students solve them daily and track progress.
- **Who it's for:** Ambitious students who already live on lichess / chess.com every day, and the coaches who teach them.
- **Space/industry:** Chess education / EdTech. Peers students know: lichess, chess.com, Chessable, Aimchess.
- **Project type:** Hybrid — marketing site (`app/page.tsx`, `(auth)`) + two data-dense apps (`(student)`, `(tutor)`).
- **The one thing to remember:** *A quiet study desk for chess.* Calm, editorial, tool-like — the opposite of a gamified, notification-heavy feed. It respects players who already know the game.

## Aesthetic Direction
- **Direction:** Editorial / near-monospace on warm paper. Restrained, print-inspired.
- **Decoration level:** Minimal → intentional. Type, thin rules, and framed panels do the work. No shadows-as-decoration, no gradients, no blobs, no rounded-everything.
- **Mood:** Considered, literate, unhurried. Reads like a well-set training manual, not a game.
- **Signature moves (keep these consistent everywhere):**
  1. **Mono for the interface, serif for the voice.** All UI text, labels, and data are Geist Mono, usually uppercase with wide tracking. Every headline and any editorial/quote text is Georgia serif.
  2. **Sharp corners.** Default `border-radius: 0`. Circles (`50%`) only for avatars, status dots, and numbered badges. No 8–16px bubble radius on cards/buttons.
  3. **Hairline structure over shadow.** Separate with 1px `--line` rules and thin frames, not drop shadows or elevation.
  4. **Rust is the only accent.** One warm terracotta, used sparingly and meaningfully (see Color).

## Typography
- **Display / Hero / all headings (h1–h3, blockquote):** **Georgia** (serif), weight 500, tight tracking (`-.02em` to `-.025em`). Emphasis via *italic* in `--rust`. Rationale: warm, editorial, and universally installed — zero webfont cost, and it's the "study manual" voice that makes the product feel considered rather than gamified.
- **UI / Labels / Body / Data:** **Geist Mono** (already loaded in `layout.tsx` as `--font-geist-mono`). Labels and eyebrows are UPPERCASE with `.05em–.14em` letter-spacing. Rationale: monospace signals "tool for people who read boards and notation" and gives the whole product its distinct, non-AI-slop face.
- **Sans fallback:** **Geist Sans** (`--font-geist-sans`, loaded) is available for dense app UI where mono at small sizes hurts readability (e.g. long paragraphs, tables with many columns). Use sparingly; mono is the default.
- **Code / notation (PGN, FEN, move lists):** Geist Mono. Already the body font, so notation sits naturally in the UI.
- **Loading:** Geist Sans + Geist Mono via `next/font/google` in `src/app/layout.tsx`. Georgia is a system serif — no loading needed.
- **Scale (px):** 9–10 (eyebrows/micro-labels, uppercase mono) · 11–12 (button labels, table cells, captions) · 13–14 (body, intro) · 18–25 (h3 / card titles, serif) · clamp(40,4.4vw,66) (h2, serif) · clamp(44,5.4vw,78) (h1, serif) · clamp(52,7vw,100) (final CTA, serif).
  - **Readability floor:** body copy a user must actually read is **≥13px** and passes 4.5:1 contrast. Reserve 9–11px for uppercase labels/metadata only.
  - Body line-height 1.7–1.8; headings 1.06–1.15.

## Color
- **Approach:** Restrained. Warm neutral canvas + one accent. Color is rare and always means something.
- **Core tokens** (from `globals.css :root`):
  - `--ink: #2a2824` — primary text, dark surfaces (dark cards, final CTA).
  - `--paper: #eeeae1` — page background.
  - `--panel: #f4f1ea` — cards / raised surfaces on paper.
  - `--shade: #e5e0d5` — alternating section background (e.g. quote section).
  - `--rust: #a4562f` — **the accent.** Italic emphasis, links/underlines, primary CTA fill, active states, key data highlights, live/status dots. Use it deliberately; if everything is rust, nothing is.
  - `--line: #c9c2b2` — hairline borders, rules, dividers.
  - `--muted: #77726a` / `--muted2: #8a8479` — secondary/label text, metadata.
  - `--body: #5f5a52` — long-form body copy on paper.
- **Semantic** (tuned to sit in the warm palette — desaturated, earthy, distinct from rust):
  - success `#5f7a3f` (olive) · warning `#9c7a2f` (mustard) · error `#a0332a` (brick, redder/darker than rust so they never read as the same thing) · info `#4c6672` (dusty blue).
  - **Never encode meaning by color alone** (lichess-native users include colorblind players): pair every semantic color with an icon or label.
- **Dark mode:** Not a separate theme yet. Dark *sections* invert to `--ink` background with `--paper` text, `--rust` accent, and muted `#b3ab9c` for secondary text (see `.feature-tall`, `.final-cta`). If a full dark app theme is added later: keep `--ink` as base surface, lift panels ~6% lighter, hold rust, reduce any semantic saturation ~15%.

### Chess board colors (important — this is a chess product)
There are two board treatments; don't mix them up.
- **Brand board** (marketing, decorative, non-interactive): light `#f2efe8` (`--lt`), dark `#cdc6b6` (`--dk`). Paper-tinted to match the page. White pieces `#f7f4ed` with a subtle text-shadow for contrast; black pieces `--ink`. Square aspect ratio, pieces snapped to the 8×8 grid.
- **Play board** (the real solving surface in the student app, via `react-chessboard`): use board colors familiar to lichess/chess.com users but warmed to the palette — light `#ece4d2`, dark `#a8926b`. Highlights: last-move `rgba(164,86,47,.35)` (rust), selected/legal-move dots `--rust`, check `#a0332a`. Familiar tones lower friction for players who solve hundreds of these a day; don't invent an exotic board.

## Spacing
- **Base unit:** 4px.
- **Density:** Comfortable on marketing (generous section padding, 90–130px), compact-comfortable in the apps (tables and lists tighter).
- **Scale:** 4 · 8 · 12 · 14 · 16 · 24 · 32 · 48 · 64 · 90 · 130. Use scale values, no magic numbers.

## Layout
- **Approach:** Hybrid — editorial for marketing (asymmetric hero grid, framed board, ticker), grid-disciplined for the apps (predictable columns, aligned tables).
- **Grid / max width:** Content max **1280px** (marketing) / **1200px** (method & steps sections). App shells can go wider for tables. Gutters `4.5vw`.
- **Border radius:** `0` everywhere by default. `50%` for avatars, status dots, numbered badges. No other radii. This sharpness is part of the identity — resist adding rounded cards.
- **Borders:** 1px `--line` for structure; 1px `--ink` for framed emphasis (hero board frame, mini-cards). No box-shadows for elevation.

## Motion
- **Approach:** Intentional but quiet. Entrance reveals on the hero, hover nudges on arrows/links, a slow ticker. Nothing bouncy or scroll-choreographed.
- **Easing:** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for enter/move; plain `ease` for color.
- **Duration:** micro 50–100ms · short 150–250ms (buttons, hovers) · medium 250–400ms · long ~700ms (hero reveal). Marquee drift 30s linear.
- **Always** respect `prefers-reduced-motion: reduce` — disable reveals, ticker, and smooth-scroll (already wired in `globals.css`).

## Component conventions
- **Buttons:** min-height 44px, uppercase mono 11px, `.07em` tracking, square. Primary = `--rust` fill / `--paper` text (`.button-accent`). Dark = `--ink` fill / `--paper` text (`.button-dark`). Secondary/ghost = 1px `--ink` border on transparent. Active `scale(.98)`. Icon nudges 4px right on hover.
- **Links (inline/nav):** rust underline that animates in on hover (`.nav-links a::after`); text links carry a persistent rust underline.
- **Cards / panels:** `--panel` background, 1px `--line` border, square. One dark variant (`--ink`) per group max, for contrast.
- **Eyebrows / section labels:** uppercase mono, `--muted2`, with a leading 26px hairline (`.eyebrow::before`).
- **Data / tables (apps):** mono, tabular feel; header row uppercase mono `--muted`; 1px `--line` row separators; rust for the one number that matters (rating, streak, delta). Right-align numerics.
- **Avatars / badges:** circles, 2px `--paper` ring when overlapping, initials in mono 8px.

## Accessibility (non-negotiable)
- Text a user reads ≥13px and ≥4.5:1 contrast. Uppercase mono micro-labels may be smaller but must still clear 4.5:1.
- Never rely on color alone (esp. board highlights and semantic states) — pair with icon/label.
- Visible keyboard focus everywhere (don't strip default outlines; add `:focus-visible` where custom).
- Decorative board/art marked `aria-hidden`; interactive board must be fully keyboard-operable.
- Touch targets ≥44×44px.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-14 | Adopted "Paper Mono" (variant I) as the product-wide system | Chosen by the user from `design-variants.html` after rejecting heavier/gamified directions; students are daily lichess/chess.com users who want quiet, tool-like UI, not marketing bombast. |
| 2026-07-14 | Georgia serif headlines + Geist Mono UI; sharp corners; single rust accent | These three moves are the recognizable identity and keep the product off the AI-slop path (no gradients, no bubble radius, no icon-circle grids). |
| 2026-07-14 | Two board treatments (brand vs. play); play board tuned to lichess-familiar tones | Marketing board matches the paper aesthetic; the real solving board prioritizes familiarity and legibility for heavy daily use. |
| 2026-07-14 | Semantic colors + play-board highlight hexes proposed by design, not yet user-confirmed | Filled sensible defaults so the apps have a complete palette; flagged for review. |
