# Konstantin / Airsup reuse audit

Checked October 19, 2026. Research and local clones only; no installs, paid API calls, publishing or messages in this audit.

## Identity and scope

Personal account: [Pytro001](https://github.com/Pytro001). GitHub's public profile names Konstantin Saifoulline and links his earlier Huge Conversations page. Stronger evidence: `index.html` and `assets/map.js` in [his website repository](https://github.com/Pytro001/konstantinsaifoulline) exactly matched the bytes served at [his personal site](https://www.konstantinsaifoulline.com/). The live HTML SHA-256 was `32ff50089caa1b4f24f339434732fc3203c2ba48ad6210264e24df88119a29fd`. The site itself did not expose a GitHub link in the pages/scripts checked.

Company account: [AirsupHQ](https://github.com/AirsupHQ), a GitHub user account linking airsup.ai. The public APIs returned 12 personal repositories and three Airsup repositories. This audit selected the six simulation-related repositories below. Unrelated personal projects were not cloned.

The exact `/lab/warehouse-ops` application's source was not found in these repositories. No claim that it is private or unavailable elsewhere. `factoryline` is a separate React Flow factory planner, not the warehouse demo.

## Local inventory

All paths are beneath ignored `.cache/base-contributions/`; clones are shallow. Licenses were read from the actual files, not inferred from a public GitHub URL.

| Repository | Local directory | Pinned commit | License / decision |
|---|---|---|---|
| [AirsupHQ/factory-skill](https://github.com/AirsupHQ/factory-skill) | `airsup-factory-skill` | `9fde7554e6a30e77ea1008dec08f2ba8d8d37f27` | MIT; best operations engine fit; already used by `/ops` |
| [AirsupHQ/machine-skill](https://github.com/AirsupHQ/machine-skill) | `airsup-machine-skill` | `e0bd066ac5beaf48512935de2fc0f0e55636853a` | MIT; rendering and film reference |
| [AirsupHQ/airsup-lab](https://github.com/AirsupHQ/airsup-lab) | `airsup-lab` | `e21864bda5a614ffae8d0a835518be8e2e571dce` | MIT; fonts separately OFL; scene reference |
| [Pytro001/megastructures-engine](https://github.com/Pytro001/megastructures-engine) | `megastructures-engine` | `4f5b82b67e7b7b87c3161aff0fc7e027afab14b3` | MIT; rendering budgets, labels, cutaways |
| [Pytro001/megastructures-tv](https://github.com/Pytro001/megastructures-tv) | `megastructures-tv` | `95d745df875b3ce60d40c02fb6d7c2887a2351b9` | MIT; useful Franklin action pattern |
| [Pytro001/factoryline](https://github.com/Pytro001/factoryline) | `pytro-factoryline` | `7c691fa97c0a5f5369c2501a4b35e194c256f238` | No license found; inspection only, no code incorporation |

Preserve copyright/license notices for incorporated MIT code and check bundled asset notices. Existing attribution is in `vendor/airsup/NOTICE.md`. The new clones have not been incorporated into the application.

## Reuse in priority order

1. **Factory simulation, already integrated.** `factory-skill/runtime/des.js` supplies seeded discrete-event queues, parallel resources, finite buffers, variability and interruptions. Our original `ops-core.js` supplies the deployment scenario. Synthetic inputs remain explicit. It does not model geographic routes, shared crews, actual Base calendars or customer economics. Upstream forecast throughput uses cumulative counters, but station statistics and the bottleneck use a retained rolling window; our adapter computes full-horizon station statistics for the stated forecast period.
2. **Franklin that demonstrates an answer.** `megastructures-tv/server/ask.mjs` sends the current simulation state and control ranges to an LLM, validates returned actions, and separates live, replay and mock modes. Reuse the pattern for `setScenario`, `compareBaseline`, and `explainEvidence`. First example: “Add three installation crews; show which stage limits output next.” Recompute results before explaining them; never let generated prose supply the numerical result. Keep server-owned schemas, validate again in the browser, label replay/mock mode, and support undo. The upstream code is a reference, not a reviewed production boundary: it validates against a client-supplied snapshot. Provider selection remains separate from the simulation contract.
3. **Presentation and recording.** `machine-skill/scripts/record.mjs`, `airsup-lab/src/director.ts`, and the Megastructures rendering budget modules are useful references for repeatable camera tours and slower GPUs. Megawatt already has a Helium-based recorder. Do not replace the static stack with Vite or add a second Three.js version just to adopt a camera effect.

Megastructures TV's README describes an entry for the Build, Ship, Shape Amazon Developer Hackathon and distinguishes preexisting scenes from the new TV/voice work. That is the author's documented submission history; no award or judging outcome was verified. It is not evidence that the warehouse demo came from that event.

## A focused Base interview suite

| Existing page | Decision to demonstrate | Credibility gate |
|---|---|---|
| `/deploy` | Which ERCOT zones deserve further deployment investigation? | Dated real prices, reproducible dispatch rule, losing months, editable assumptions; no claim that zone prices identify eligible homes |
| `/ops` | Does adding installation capacity help, or move the constraint elsewhere? | Baseline/scenario comparison, deterministic replay, conservation tests, explicit synthetic coefficients |
| `/bench` | How does dispatch behave with forecast error, losses and a protected backup reserve? | Inspect the current scenarios and expose the rule, reserve violations and baseline in one short walkthrough |

Prioritize `/deploy` as the evidence-heavy hiring demonstration and `/ops` as its visual companion. Franklin should connect the questions to these existing calculations. The next implementation should be one bounded, testable scenario action, not another platform or decorative simulation. An operator would still need to validate the problem and supply anonymized operational measurements before the capacity model could support actual staffing decisions.

Cloning and source inspection are complete. No claim that all six upstream apps build or pass their test suites on this machine; dependencies and upstream startup scripts were not executed for this audit. Apply while improving this small suite rather than making “perfect” a prerequisite.
