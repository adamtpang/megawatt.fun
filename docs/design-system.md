# Megawatt design system

Shared components and tokens live in `site.css`; tool layouts live in `deploy.css` and `bench.css`. Keep shared rules in one place rather than appending competing overrides.

## Reference

Refreshed from [Base Power's public site](https://www.basepowercompany.com/) on October 19, 2026, including its current MarketingLayout CSS and visible browser controls. Earlier measurements remain in `base-design-reference.json`; the private research folder `docs/base-current` holds the refreshed CSS, extracted tokens and reference capture notes. This is an independent Megawatt interface, not a Base product or official design system.

| Purpose | Value |
| --- | --- |
| Canvas | #f0eeeb |
| Raised surface | #ffffff |
| Text / header | #292826 |
| Muted text | #54524f |
| Border | #d8d7d5 |
| Primary button | #b2dd79 |
| Headings / button text | #1e4d2b |
| Selected surface | #d6f0b4 |
| Positive indicator | #77a45a |
| Failure indicator | #bf5249 |

The published site uses the system sans-serif stack. Base's PP Neue Montreal was trialled locally but is not published: no webfont license covers redistribution, so the font files stay in the gitignored `assets/fonts/`. Base logos and imagery are not used.

## Components

- Sans serif headings, weight 600 and charcoal, matching Base's [duration calculator page](https://www.basepowercompany.com/duration-calculator). Deployment heading: 48px / 1.1 desktop, 36px phone. Body: 16px / 1.5 with normal tracking. Numbers use tabular figures; key energy values use green.
- Controls: 8px corners, at least 44px targets, clear focus outlines. Cards: 16px corners, white surfaces and 24–32px padding.
- Spacing: 4, 8, 12, 16, 24, 32, 48, 64px. Compact tools use less vertical space than marketing pages to keep results visible.
- Light warm header with dark navigation, matching Base's calculator rather than its photographic homepage hero. White selected navigation surfaces, 8px corners and 44px minimum targets. Deployment section navigation stays visible while scrolling and marks the current section. Franklin sits in the header and opens a compact panel.
- Green actions, labeled green/red outcomes. Color never carries meaning alone. Respect reduced motion.

## Copy

One question. One action. One visible consequence. Use ordinary words first; put exact mechanisms, assumptions, accounting, logs and downloads in expandable details. Keep the independent/synthetic-data disclosure visible.

The Battery backup test asks the visitor to repeat a battery command. Two panels show how many simulated batteries used reserved backup, with and without safeguards, and how much energy each delivered. Engineer details retain the underlying four-policy comparison and reproducible evidence. Styling does not change the replay model.

The deployment tool presents map, shortlist and economics in order. Unknown site qualification and missing contract inputs remain visible. Monthly results, ranking mechanics and detailed assumptions are progressively disclosed, never removed to make a result look better. Franklin is an evidence guide until an explicitly configured model connection is available.

The map and evidence share a single white bordered card with an internal divider. This follows the public calculator's enclosing form surface. Button padding (12px/16px), weights (600), radii (8px controls / 16px cards), charcoal (#292826), canvas (#f0eeeb) and green action (#b2dd79) are directly measured. The layout, county map, section navigation and Franklin are Megawatt adaptations; no claim is made about Base's private internal-tool UI.

## Component classes (Base system, 2026-11-02)

The block "Base design system components" at the end of `site.css` mirrors Base's public `--bpc` tokens and component rules. Tool pages opt in with `<body class="tool-page">`. Use these instead of page-local copies:

| Class | Base source | Use |
| --- | --- | --- |
| `.eyebrow` | `.bpc-eyebrow`: 600, 12px, 0.12em tracking, uppercase | Label above a page heading |
| `.tool-page h1/h2/h3` | display-sm/md, heading-md/sm | Page type scale |
| `.badge` + `-green -solid -white -yellow -orange -red -blue` | `.bpc-badge`: 4px corners, 12px, 500, uppercase | Sourced green, assumption yellow, partly white, yours solid green, risk red, stale orange |
| `.btn`, `.btn-outline`, `.btn-sm` | `.bpc-button-filled`, `.bpc-button-outline` | Actions |
| `.card` | `.bpc-card`: white, 1px grey-20, 16px corners | Panels |
| `.ds-table` | (Megawatt) uppercase header, charcoal rule | Data tables |
| `.notice`, `-green`, `-red` | (Megawatt) tinted note | Disclaimers and status |

Deliberate differences: Instrument Sans stands in for the licensed PP Neue Montreal and Clarendon Wide; muted text is grey-80, not grey-60, for WCAG AA on the canvas; no Base logo or imagery. The site stays independent and says so on every tool.

## Review

Check Guide, Roadmap, Tools, Battery and Bench on desktop and a 390px phone. Verify no horizontal overflow, readable plots and controls, keyboard operation, closed details by default, and the duplicate-command result (32/100 unguarded, 0/100 guarded for the saved default fixture).
