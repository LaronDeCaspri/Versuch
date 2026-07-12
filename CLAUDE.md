# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

A small **static marketing landing page** for *Electro Train Studio* — an
apprenticeship-management ("Ausbildungsverwaltung") product for electrical-trade
businesses. The site is in **German** (`<html lang="de">`) and targets four
roles: **Betrieb** (business), **Ausbilder** (trainer), **Azubi** (apprentice),
and **Eltern** (parents), which all connect through a shared digital
*Berichtsheft* (training logbook).

There is no framework, no build step, and no backend. It is plain HTML, CSS, and
a single vanilla-JS file, opened directly in a browser.

## Layout

```
index.html            Main landing page (hero, roles, flow, spec table, demo form)
styles.css            Global stylesheet (design tokens + component styles)
script.js             Vanilla-JS interactivity (single IIFE)
rollen-section.html   Standalone, self-contained "Rollen" section experiment
                      (own inline <style>, own palette — not linked from index.html)
assets/vendor/        Vendored GSAP libraries (gsap.min.js, ScrollTrigger.min.js)
package.json          Declares the gsap dependency only
.gitignore            Ignores node_modules/
```

`rollen-section.html` is a **separate exploratory build**: it does not share
`styles.css`, uses a different font (Manrope) and a navy/gold palette, and links
to remote `clicksites.ai` images. Treat it as a design scratch file, not part of
the main page.

## Running it

No build or server is required. Open `index.html` in a browser, or serve the
folder statically:

```
python3 -m http.server 8000     # then open http://localhost:8000
```

`npm install` only fetches GSAP into `node_modules/`; the page already loads GSAP
from the checked-in `assets/vendor/` copies, so installing is optional.

## Conventions

- **Language:** all user-facing copy is German. Keep new copy in German and match
  the existing register (direct address with "du").
- **CSS design tokens:** defined as custom properties in `:root` at the top of
  `styles.css`. Reuse them instead of hardcoding values:
  - Colors: `--graphite` (bg), `--graphite-raised`, `--graphite-line` (borders),
    `--copper` / `--copper-bright` (primary accent), `--volt` (secondary/teal
    accent), `--bone` (text), `--muted` (secondary text).
  - Fonts: `--font-display` (Unbounded), `--font-body` (IBM Plex Sans),
    `--font-mono` (IBM Plex Mono). Layout: `--content-width` (1180px),
    `--radius`.
- **Naming:** BEM-style class names (`block__element--modifier`), e.g.
  `panel__tab`, `role-card__link`, `btn--primary`.
- **Accessibility:** the codebase takes this seriously — keep it up.
  - Honor `prefers-reduced-motion`: `styles.css` neutralizes animations/scroll
    behavior under it, and `script.js` skips its timers. Guard any new motion the
    same way.
  - Use `:focus-visible` outlines (already defined globally), ARIA roles/labels
    on interactive widgets (tabs, form status via `aria-live`), and `aria-hidden`
    on decorative SVGs.
- **Responsive:** mobile-first breakpoints via `@media (max-width: …)`; common
  cutoffs are 980px, 760px, 600px, 560px.

## ⚠️ Known inconsistency — read before editing styles.css or script.js

`index.html` was rewritten, but `styles.css` and `script.js` still carry large
chunks from a **previous, unrelated template** (an EMS/fitness "training studio"
page). They are partially out of sync with the current markup:

- **`script.js`** looks up IDs that **do not exist** in `index.html`
  (`freqSlider`, `impulseSlider`, `zoneCount`, `sessionClock`, `.body-diagram
  .node`, …). Because it is one IIFE, the very first missing lookup
  (`freqSlider.addEventListener`) throws a `TypeError` at load, so **the rest of
  the file — including the `contactForm` submit handler — never runs.** The demo
  form currently has no working JS behavior, and the hero role-`panel__tab`
  buttons have no JS wiring at all.
- **`styles.css`** styles many classes the current page never uses
  (`.body-diagram`, `.control`, `.timeline`, `.studio-section`, `.panel__controls`),
  while several classes used in `index.html` (`.circuit-diagram`, `.role-node`,
  `.panel__tab`, `.role-card`, `.flow__*`, `.mockup*`, `.hub__*`) have **no
  styling defined**.
- GSAP + ScrollTrigger are loaded in `index.html` but not referenced by
  `script.js`.

When touching JS or CSS, verify against the actual `index.html` markup rather
than assuming the existing file matches. Prefer removing/replacing the stale
EMS-template code over layering on top of it. If you implement the role-tab
switching or the contact-form handler, that is closing this gap — not adding a
new feature to a working file.

## Git workflow

- Active development branch for this work: `claude/claude-md-docs-9vh5xg`.
- Develop on the designated branch, commit with clear messages, and push with
  `git push -u origin <branch>`. Do **not** open a pull request unless explicitly
  asked.
- There are no tests, linters, or CI in this repo. "Verifying" a change means
  opening the page in a browser and checking it renders and behaves as intended.
