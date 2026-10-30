# Base Power public code and BaseScanning lessons

**October 19 update:** [the current repository learning guide](base-repo-learning/README.md) covers 12 public repositories, including four additions and changes to the web component. The eight-repository inventory below is preserved as the October 4 snapshot.

Reviewed October 4, 2026. Read-only source inspection: no third-party project code executed, no account APIs called, no paid services, publication or contact. Related: [30 candidate tools](base-problem-backlog.md).

## Public organization

Yes: [BasePowerCompany on GitHub](https://github.com/BasePowerCompany). Its [public repository API](https://api.github.com/orgs/BasePowerCompany/repos?per_page=100) returned eight repositories at review time. The Base-branded outage challenge and marketing-component code corroborate the company context. This is distinct from `github.com/base` and `base-org`, which concern the Coinbase blockchain.

The organization profile has no public members or populated company website field in the API response. No verified-domain badge was observed. Do not infer access to the company's private code from this public inventory.

| Repository | Scope / relationship | Value for Adam |
| --- | --- | --- |
| [bpc-web-components](https://github.com/BasePowerCompany/bpc-web-components) | Base-owned TypeScript marketing-site components, including address entry. | **Read first.** Actual UX principles, state/routing code, pure classification tests, and CSS. Closest match to full-stack work. |
| [austin_hackathon_20240920](https://github.com/BasePowerCompany/austin_hackathon_20240920) | Base-owned 2024 outage-prediction challenge and starter notebook. | **Read second.** Historical problem brief and a public data pointer; not the September 2026 challenge. |
| [mcupsdk-am263p4](https://github.com/BasePowerCompany/mcupsdk-am263p4) | Checked-in TI AM263P4 SDK copy for tracking HAL fixes. | Embedded/firmware context; substantial vendor code rather than a beginner web project. |
| [mcupsdk-core](https://github.com/BasePowerCompany/mcupsdk-core) | Fork of Texas Instruments MCU+ SDK. | Drivers/protocols; distinguish vendor code from Base changes. |
| [go-xmlsec](https://github.com/BasePowerCompany/go-xmlsec) | Fork of crewjam's Go XML security bindings. | Infrastructure/library contribution route if a concrete reproducible issue appears. |
| [talos](https://github.com/BasePowerCompany/talos) | Fork of ory/talos API-key server. | Auth/infrastructure context; the upstream description does not prove Base deployment. |
| [coreboot](https://github.com/BasePowerCompany/coreboot) | Fork of Dasharo coreboot. | Firmware context; inspect changes versus upstream before attributing functionality to Base. |
| [edk2](https://github.com/BasePowerCompany/edk2) | Fork of Dasharo EDK II. | Same attribution caution; low priority for this full-stack demonstration. |

Public visibility is not automatically an open-source license. GitHub's license metadata was empty for the web-components and 2024 notebook repositories at review time; review terms before redistributing or incorporating their code. The web package's `private: true` prevents normal npm publication; it does not mean the GitHub repository is private. No fleet-control or Markets risk-model implementation was found among these eight public repositories.

## What the web-components repository teaches us

Reviewed main commit [`3f9ba192ca7bb85af5e36f032fcd1c91b4bec6df`](https://github.com/BasePowerCompany/bpc-web-components/tree/3f9ba192ca7bb85af5e36f032fcd1c91b4bec6df), committed September 22, 2026.

Read in this order:

1. [Address-entry design principles](https://github.com/BasePowerCompany/bpc-web-components/blob/3f9ba192ca7bb85af5e36f032fcd1c91b4bec6df/docs/address-entry-design-principles.md).
2. [Architecture](https://github.com/BasePowerCompany/bpc-web-components/blob/3f9ba192ca7bb85af5e36f032fcd1c91b4bec6df/src/address-search/DESIGN.md).
3. [Classifier](https://github.com/BasePowerCompany/bpc-web-components/blob/3f9ba192ca7bb85af5e36f032fcd1c91b4bec6df/src/address-search/addressValidation.ts) and [tests](https://github.com/BasePowerCompany/bpc-web-components/blob/3f9ba192ca7bb85af5e36f032fcd1c91b4bec6df/src/address-search/addressValidation.test.ts).
4. [Evaluation cases](https://github.com/BasePowerCompany/bpc-web-components/blob/3f9ba192ca7bb85af5e36f032fcd1c91b4bec6df/src/address-search/EVAL.md), [styles](https://github.com/BasePowerCompany/bpc-web-components/blob/3f9ba192ca7bb85af5e36f032fcd1c91b4bec6df/src/address-search/styles.module.css), and shared modal components.

Useful UX lessons: make the normal path require few actions; show progress promptly; make each warning explain the observed issue and next action; keep recovery editable; use one consistent modal; evaluate whether warnings actually help. Apply the principles to Megawatt's tasks rather than copying address-specific rules into a battery controller.

Architecture lessons: separate UI, external autocomplete/session handling, flow behavior, and shared submission contracts. The CSS includes concrete control styles, but this repo is not a complete published Base design system. Its address regression examples are evidence of previous misses and an existing evaluation set, not proof those bugs remain open. Do not use any keys or account endpoints for an independent local study.

## Historical outage challenge

Reviewed main commit [`3119da703a1a53ca5889a06f3bc333ec29c9a868`](https://github.com/BasePowerCompany/austin_hackathon_20240920/tree/3119da703a1a53ca5889a06f3bc333ec29c9a868), committed August 20, 2024. The name references September 20, 2024.

The [notebook](https://github.com/BasePowerCompany/austin_hackathon_20240920/blob/3119da703a1a53ca5889a06f3bc333ec29c9a868/base_power_outage_prediction.ipynb) has six cells: download a CSV, load it with pandas, inspect it and plot outage duration versus customers affected. It contains no trained forecast or held-out accuracy result. Its public CSV pointer is `https://storage.googleapis.com/outage_data_export/texas_outage_event_data.csv`; download availability, licensing and dataset quality were not validated in this review.

A useful contribution would begin with chronological evaluation, label/coverage checks and a simple baseline. A prettier outage map alone does not establish preparedness value. This is historical evidence, not an active challenge invitation.

## Did BaseScanning come from the recent hackathon?

**Yes.** Its README names a four-person team and the September 25, 2026 start. The [official event brief](https://luma.com/aitx-94j6) identifies September 25-27 at Base HQ in Austin, with commercial, grid-data and orchestration tracks. The [GitHub repository API](https://api.github.com/repos/SamGu-NRX/BaseScanning) records creation on September 26, 2026 UTC. [Media releases](https://github.com/SamGu-NRX/BaseScanning/releases) are dated September 27 and explicitly are recordings, not app releases.

The repository description reports **first place, Most Commercializable**. That is the team's claim; an independent official winner announcement was not found in the reviewed event page. Do not promote it to independently verified judging evidence.

The current repository includes post-event changes. This review pins main at [`c813182a808c957ccc981fa56490c6c29d3c1560`](https://github.com/SamGu-NRX/BaseScanning/tree/c813182a808c957ccc981fa56490c6c29d3c1560), committed October 1, 2026. It is not a frozen snapshot of everything demonstrated within 48 hours.

## What to learn from BaseScanning

The product has an immediately legible task: help a homeowner capture the wall near the meter and help a reviewer assess possible battery placement. Its public rules include demo assumptions. The README acknowledges field-test failures and accuracy limits. Those disclosures are more useful engineering evidence than the repository description's sweeping reliability claims.

| Lesson | Source / code reference | What we should apply |
| --- | --- | --- |
| Put one real-world decision first | [Overview](https://github.com/SamGu-NRX/BaseScanning/blob/c813182a808c957ccc981fa56490c6c29d3c1560/docs/00-overview.md) and homeowner/reviewer workflow | Pick a user and a next action before designing a dashboard. |
| Separate perception from evaluation | [Solver](https://github.com/SamGu-NRX/BaseScanning/blob/c813182a808c957ccc981fa56490c6c29d3c1560/server/solver.py) | Models produce observations; sourced rules and uncertainty govern results. An LLM is not the installation authority. |
| Missing evidence is a product state | Solver's missing-view outputs and three-state checks | Return a specific request for evidence instead of guessing. |
| Keep rules inspectable | [Rules YAML](https://github.com/SamGu-NRX/BaseScanning/blob/c813182a808c957ccc981fa56490c6c29d3c1560/server/rules.yaml) | Version values, source labels and placeholder status. Public demo rules are not approved Base policy. |
| Test properties, not just attractive examples | [Property tests](https://github.com/SamGu-NRX/BaseScanning/blob/c813182a808c957ccc981fa56490c6c29d3c1560/server/tests/test_properties.py) | Check boundaries, removed evidence, mirrored scenes and stricter rules. Software invariants do not prove measurement accuracy. |
| Use real field attempts to discover failures | [Build 4.1 runs](https://github.com/SamGu-NRX/BaseScanning/blob/c813182a808c957ccc981fa56490c6c29d3c1560/experiments/device-field-test/build-4.1/README.md) | Record device, build, environment, actual outcome and failure; preserve privacy. |
| Distinguish completed, stale and unrun evidence | [Verification scoreboard](https://github.com/SamGu-NRX/BaseScanning/blob/c813182a808c957ccc981fa56490c6c29d3c1560/verification/SCOREBOARD.md) | Tie every result to source and input versions; mark missing validation explicitly. |
| Do not make full 3D reconstruction a prerequisite | [Research handoff](https://github.com/SamGu-NRX/BaseScanning/blob/c813182a808c957ccc981fa56490c6c29d3c1560/docs/06-research-handoff.md) | A small evidence loop can be valuable before a photorealistic model exists. Keep capture, upload, analysis and decision states separate. |

Specific inspected solver behavior: clearance PASS requires the entire measurement interval to clear the threshold; equality is UNSURE. Placement candidates include a regular grid plus transition boundaries. Unobserved coverage cannot pass. Unknown checks return manual review and missing-evidence requests. Strict policy can route decisions to review. These are implementation observations, not results from rerunning tests here.

Important documentation mismatch: the README says the solver is only in PR #11 and main is a skeleton. The reviewed main commit actually contains `server/solver.py`, `rules.yaml`, API schemas and numerous tests. The README's branch instructions are stale relative to this tree. The scoreboard also describes particular September 27 branch commits; its reported test counts are not verification of current main.

The rule file permits demo automatic decisions and labels unsourced placeholders. Therefore a demo PASS must never be presented as approval to install a battery. Accuracy, concealment/occlusion, non-LiDAR devices, equipment reading and integration require validation beyond synthetic geometry checks. We did not rerun iOS, server or reconstruction tests, inspect private material, or validate the live app's accuracy.

## Community repositories, clearly separate from Base-owned code

| Repository | Why inspect it | Relationship / limits |
| --- | --- | --- |
| [SamGu-NRX/BaseScanning](https://github.com/SamGu-NRX/BaseScanning) | Product framing, uncertainty, geometry rules, field evidence. | Hackathon participant; MIT repository; deployment and performance claims not independently validated here. |
| [Regantih/gridsignal](https://github.com/Regantih/gridsignal) | Fleet recovery demo and human approval framing. | Participant repository identifying the 2026 hackathon; no verified prize or Base adoption claim. |
| [jerrit/ha-base-power](https://github.com/jerrit/ha-base-power) | Member-facing telemetry, stale/unknown states and parser edge cases. | Explicitly unofficial and unendorsed; uses a private API that can change. Adam is a non-customer, so learn from code and synthetic cases without claiming live access. |

## Implication for Megawatt

The best lesson is a clear task and trustworthy evidence, not more infrastructure or stronger branding. Our dispatch bench shows command behavior under failures; it is not a member product or proof of Base's most expensive problem. Keep it as a bounded engineering sample. Before choosing a new hackathon-style build, inspect the actual public web-component code for a small reproducible gap, or validate an installation-readiness workflow with a named reviewer.

No claim is made that a project would have won, that Base would ship it, or that all code visible publicly can be copied into Megawatt. No product implementation was changed by this research note.
