# Megawatt: Apple design review

Reviewed 2026-10-13 using `C:/Users/adamp/.agents/skills/apple-design/SKILL.md`. Scope: local HTML, CSS, interaction code, and existing design notes. This is a source review; rendered layout, interaction timing, screen-reader behavior, and production appearance were not tested.

## Direction

Keep Megawatt's warm canvas, white surfaces, and green accent. Apply the skill's purpose, simplicity, feedback, typography, and accessibility principles to the behavior. The bench's purpose is to let someone repeat a battery instruction and understand why safeguards matter. The guide's purpose is to let someone explore civilization-scale energy. Each page should have one obvious interaction and a visible consequence.

## First improvements, in order

1. **Show the safeguard tradeoff.** `bench.js` calculates both backup violations and energy delivered, but `bench.css` hides `.delivery-number`. Keep both visible: “32 of 100 used backup” and “X kWh delivered”; alongside “0 of 100 used backup” and “Y kWh delivered.” Use actual replay values. Retain the simulation disclosure. A person should be able to see the decision without opening engineering details.
2. **Make the destination obvious.** Replace the navigation label “Dispatch Bench” with “Battery backup test”; introduce the action with “What happens when a battery instruction arrives twice?” Keep the engineering terminology inside details. These are proposed labels, not edits already applied.
3. **Unify the actual design system.** `site.css` repeatedly redefines headers, focus rings, typography, and radius tokens; `bench.css` repeatedly overrides desktop/mobile styles. Consolidate the final rules into one token/component layer after checking all pages. Use the existing 44px minimum targets, size-specific heading tracking, body tracking near zero, and a deliberate type scale. The design document should describe the resulting styles.
4. **Add immediate press feedback.** The reviewed shared/bench rules define hover and selected states but no shared `:active` treatment. Give buttons a subtle press background change; optional small scaling must respect reduced motion. Commit actions on click/release, preserving keyboard behavior. Sliders already update on `input`; measure replay cost before introducing scheduling or animation.
5. **Keep motion useful and optional.** The Earth already uses a static fallback for reduced motion, and the network supports stepping instead of autoplay. Both read the preference only at initialization; consider reacting to a preference change while the page is open. Preserve those controls. Introduce springs only if a real draggable interaction needs them; the current bench has no such requirement.
6. **Repair the homepage head.** `index.html` contains a stray `<text ...>…</text></svg>` fragment without an opening SVG/icon link, before its stylesheet links. Remove the fragment and verify parsed head/body placement, metadata, and the existing ICO link in a browser.

## Five-minute acceptance check

- At 390px and desktop width, a new visitor can say what is simulated, perform the duplicate-command experiment, and explain both backup protection and delivered-energy differences.
- Keyboard users can reach every control, identify focus, change the experiment, and open/close details without losing their place.
- At 200% text size, labels and controls remain usable; horizontal scrolling is confined to intentionally wide engineering tables.
- Reduced-motion mode provides the same information without continuous scene motion. The simple result is understandable without the dot colors.
- Moving a slider updates its value immediately; rapid changes never lock input or leave a stale result. Measure this at the maximum supported fleet size before claiming responsiveness.

Recommended first implementation: expose the delivery comparison and clarify the bench label, then verify the interaction in a local browser. CSS consolidation follows once that small experience is assessed. No source/UI changes or deployment were made by this review.

## Implementation follow-up · October 19, 2026

All six review items now have local changes: delivered energy is visible; navigation says Battery backup test; shared and bench CSS overrides were consolidated; press feedback respects reduced motion; Earth reacts to media changes when its renderer is active and the network switches to manual stepping; stray favicon SVG fragments were removed. The static Earth fallback remains static if the page initially loads with reduced motion.

Verified in isolated Helium at 390px and desktop width. Guide, Roadmap, Tools, Battery and backup test had no document overflow or captured JavaScript exceptions. The duplicate-command test showed 32/100 reserve violations without safeguards and 0/100 with safeguards, with delivered kWh visible. The deployment page's 720px viewport check approximates a 1440px screen at 200% zoom; it is not a full assistive-technology audit. In a foreground tab, changing reduced motion stopped network autoplay and changed the control to Step an hour; restoring normal motion left it paused with a Play button. Initial background-tab emulation did not deliver media change events, so the check was repeated foreground.

No production deployment or user study is claimed. See `base-current/COMPLETION.md` for release boundaries.
