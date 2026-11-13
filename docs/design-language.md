# Design language: IBM Carbon

Decided 2026-11-13 by Adam ("carbon looks great, the first one"), after seeing the same megawatt screen
rendered in IBM Carbon, Web Awesome and a home-grown look (`design/previews/`).

The browsable version (tokens, component previews, brand book) is the "megawatt.fun" design system
artifact: https://claude.ai/artifact/YQxFC8oC2Js1qrQyzd7M9a (private to Adam unless he shares it).

## What the project is

- **Subject:** what power is worth, where and when.
- **Audience:** people deciding about batteries and large loads: a home, a battery owner such as Base, a
  lender, a data center team. Later, the people who make and move the power.
- **Primary job:** pick a place, see the hours that make the money, read the yearly figure.

## Decision

- **Design language: IBM Carbon, white theme.** Type, color, spacing, square corners and components are
  Carbon's own. megawatt adds only what Carbon has no component for: the price chart, the number row, the
  year bars and the stage with the 3D house.
- **How it is loaded.** The site's Content-Security-Policy allows styles and fonts from this site only, so
  Carbon is vendored: `vendor/carbon/styles.min.css` is `@carbon/styles` 1.119.0 (Apache-2.0) with its
  font rules removed, and IBM Plex Sans (SIL OFL) is in `fonts/`. `scripts/vendor-carbon.py` rebuilds both.
- **Shared by every page:** `shell.css` (the font and the header) and `nav.js` (menu, current page).
- **Homepage:** real Carbon components, plus `day.css` for the parts megawatt adds.
- **The other pages:** they share `site.css`, written against Base Power's public tokens. A Carbon theme
  block at the end of that file re-points those tokens at Carbon's values, so the pages changed color,
  type and corner radius together without being rewritten. Converting each to real Carbon components
  happens as each page is next worked on.

## Rules

1. Blue (`#0f62fe`) is the only brand color. It marks what can be pressed and where you are.
2. Three data colors, used only for data: teal is charging, orange is discharging and money earned by it,
   red is a grid peak hour and charges set by it. Each is also named in words.
3. Money is a data table: label left, figure right, total last. No hero number in a colored box.
4. Square and flat. No rounded corners except tags, no shadows except the open menu.
5. Page headings and figures are weight 300. Small headings are 600. Nothing is bold for emphasis.
6. Every figure shows where it came from: a source line with a date, or an "estimate" tag.

## Options considered

Versions, licences and release dates were read from the npm registry on 2026-11-13.

| Option | Verdict | Evidence |
| --- | --- | --- |
| IBM Carbon | Chosen | Apache-2.0. `@carbon/styles` 1.119.0. Rendered side by side; Adam picked it. |
| Web Awesome 3.14.0 | Rejected | MIT. Rendered side by side. Rounded and friendly; four cards for four numbers wasted a phone screen. |
| Our own look | Rejected | Rendered side by side. Tight, but every new component would be our own decision. |
| Pico CSS | Out | Its own site says it is no longer maintained. |
| Primer CSS, Tabler, Fluent, GOV.UK, USWDS | Listed, not rendered | All maintained and usable on a static site. Not chosen. |
| shadcn/ui, Radix Themes, Mantine, Ant Design | Out | Each needs React and a build step the site does not have. |

## History

Earlier on 2026-11-13 two home-grown directions were tried and rejected: "Day strip" (kept at
`design/v1-day-strip.html`), which read like a spreadsheet, and a rounder version with a display face,
which read as vibecoded. The scrub-a-day idea and the lender math survived both and are on the homepage.

## Not done yet

- Older pages use Carbon's tokens, not Carbon's components. Their tables, tabs and forms keep their own markup.
- The PJM page's house scene still uses the old green palette.
- The unused `fonts/bricolage-grotesque-latin-800-normal.woff2` is still in the repo.

## Revisit when

- The site becomes an app with accounts and a build step (then Carbon's React or web components fit better
  than vendored CSS).
- Carbon ships a major version (re-run `scripts/vendor-carbon.py` and check the homepage).
