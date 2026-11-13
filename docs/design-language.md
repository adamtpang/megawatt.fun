# Design language: Day strip

**Under revision (2026-11-13, later the same day).** Adam was not satisfied with the first Day strip proof.
Version 2 is `design/proof-v2.html`: a day you can scrub through, with the 3D house, softer shapes and one
panel at a time. Version 1 is kept at `design/v1-day-strip.html`. The rules below describe version 1 and
will be rewritten once a version is approved.

Decided 2026-11-13 by Adam ("go with day strip"). It replaces the look borrowed from Base Power,
which `docs/design-system.md` still describes for the pages not yet restyled.

The browsable version (tokens, component previews, brand book) is the "megawatt.fun" design system
artifact: https://claude.ai/artifact/YQxFC8oC2Js1qrQyzd7M9a (private to Adam unless he shares it).
The proof screen is `design/day-strip-proof.html`.

## What the project is

- **Subject:** what power is worth, where and when.
- **Audience:** people deciding about batteries and large loads: a home, a battery owner such as
  Base, a data center team, and the lenders behind them.
- **Primary job:** pick a place, see the hours that make the money, read the yearly figure.

Three lenses on one engine (decided the same day): home, battery owner, large load.

## What the interface is made of

| Bucket | Count on 2026-11-13 |
| --- | --- |
| Interactive widgets | About 7 kinds: select, range, number, checkbox, tabs, details, one file upload. No accounts, one dialog. |
| Data graphics | The majority: price bars, ranked bars, two maps, tables on 13 pages, the 3D house. |
| Reading content | 5 notes and a handful of static pages. |
| Marketing | None. |

Shape: **data-graphic**, on a static site with no build step and no package.json.

## Decision

- **Component library: none.** Own tokens and plain components. A library would add a framework to
  style widgets the site barely has.
- **Graphics:** hand-drawn HTML and CSS bars and SVG; three.js stays for the house. No chart
  library was evaluated, because the strips are simple enough to draw directly.
- **Design language: Day strip.**

## The six rules

1. One strip per screen. Every tool opens with exactly one day strip (or year strip), time left to
   right. It is the first graphic.
2. Money sits in ledger rows: label left, figure right, a hairline under each, the total between
   heavier rules. No dollar figure is a hero number in a colored card.
3. Color means electrical state and nothing else: charge (teal), run (amber), peak (red), and a
   neutral bar for a quantity with no state.
4. A state is never color alone. It is also named in words in a band or key.
5. Every figure shows where it came from: a numbered source with a date, or the estimate mark.
6. Flat and ruled. No shadows, gradients or filled cards. Four line weights and 3px corners.

Tokens, in three layers: neutrals (paper, sheet, ink, ink-soft, rule, bar) never change; states
(charge, run, run-ink, peak) never change; a partner theme may override neutrals only.

Type: one family, Archivo (SIL OFL), at two widths. Narrow names things and carries every figure;
normal width carries sentences. Figures are tabular. No all-caps labels, no monospace.

Signature element: the day strip.

## Options considered

| Option | Verdict | Evidence |
| --- | --- | --- |
| No component library | Chosen | Counted from the repo on 2026-11-13. |
| shadcn/ui | Rejected | Needs React and a build step the site does not have. Not looked up this session. |
| daisyUI or another class library | Rejected | Needs Tailwind; its default look would fight rules 2 and 6. Not looked up this session. |
| D3 or Observable Plot | Not needed now | Not evaluated. Reopen if charts become many and standard. |
| Keep Base's look | Rejected | The site now serves more than Base. |

## Not done yet

- Only the proof screen uses Day strip. The live pages still use the Base tokens in `site.css`.
- Archivo loads from Google Fonts in the proof. Before shipping, self-host it like Instrument Sans
  and add it to the Content-Security-Policy in `vercel.json`.

## Revisit when

- The site gains accounts, forms or saved state (an app shape would justify a component library).
- A second partner wants its own theme (use the neutral-override layer, not a new language).
- Charts multiply past what hand-drawn strips cover.
