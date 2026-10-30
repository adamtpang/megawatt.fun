# Base Power: problem and contribution backlog

Research snapshot: October 4, 2026. Owner of this research and any independent Megawatt prototype: Adam. Base adoption owners: **TBD: awaiting a named person and real workflow**. A published author establishes provenance, not approval or ownership of our proposal.

This records the problems discussed and 30 candidate tools. It is not a claim to know every Base problem or their internal priority order. Current signals, historical problems, and our hypotheses are separated below. No candidate has been validated with Base, and no build is selected by this document.

Related: [project decision](base-project-decision.md), [public repositories and BaseScanning review](base-open-source-notes.md).

## Diagnose the business before choosing a feature

Working hypothesis: Base must turn manufactured batteries into installed, controllable capacity that provides backup and useful grid service, with sustainable economics. A bottleneck anywhere in that chain can limit the outcome.

Follow the flow: manufacture and kit -> qualify the property -> permit -> allocate a crew -> install and commission -> keep connected -> dispatch -> settle electricity costs and support the member. Diagnose each stage using volume, waiting time, failure/rework rate, and cost per completed outcome. Public posts cannot establish which stage currently costs Base the most.

For an actual project, get one named user, one recent example, the existing process, and an acceptance test. Prefer extending existing code or making a regression fixture over replacing an already functioning system. The candidate lists below are our proposed experiments, not Base requirements.

## Evidence index

| ID | Primary source | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| S1 | [Colin Cassens: self-scheduling, Sept 22, 2026](https://inside.basepowercompany.com/self-scheduling) | Trained crews constrain supply; geographic/time allocation matters. Self-scheduling and a supply/demand balancer already shipped. Programmatic allocation and additional constraints/targets are stated next work. | That Base needs another booking app, or that our allocation method improves its current system. |
| S2 | [David Willson: deployment scaling, Apr 9, 2025](https://inside.basepowercompany.com/scaling-daily-deployments-from-1-to-50) | Historical permitting, logistics, commissioning and troubleshooting work. Base already developed operations tools. | That all described bottlenecks remain unresolved in October 2026. |
| S3 | [Andrew Hitchcock: telemetry, Apr 9, 2025](https://inside.basepowercompany.com/building-a-telemetry-stack) | Unreliable connectivity and durable edge behavior are relevant engineering concerns; SQLite durability already exists. | A current duplicate-command bug, or compatibility with our fake actuator. |
| S4 | [Zayn Hanif: risk model, Apr 9, 2025](https://inside.basepowercompany.com/building-a-scalable-risk-model) | Fixed retail pricing faces correlated wholesale price/load exposure. Base already built a risk framework and decision tools. | Our ability to validate Base profits without its loads, hedges, settlement and costs. |
| S5 | [Chase Dowling: ADER and capacity, Sept 3, 2026](https://inside.basepowercompany.com/aggregated-ders-and-the-capacity-crunch) | Deployment, dispatchability and location influence grid usefulness. | Current regulatory eligibility of a particular home; proposals are not enacted rules. |
| S6 | [Official product explanation](https://www.basepowercompany.com/how-it-works) | Backup, coordinated battery operation and a reviewed installation journey are core product functions. | A validated demand for a public dispatch dashboard. |
| S7 | [BaseScanning](https://github.com/SamGu-NRX/BaseScanning) | A participant built a guided capture/placement prototype and reports a commercial-track win. | Production accuracy, customer adoption, or independently confirmed award results. |
| S8 | [Base-owned 2024 outage challenge](https://github.com/BasePowerCompany/austin_hackathon_20240920) | Historical interest in outage prediction; a notebook points to a public CSV. | A current 2026 request, a trained model, or permission to reuse data commercially without checking terms. |
| S9 | [BPC address-entry principles](https://github.com/BasePowerCompany/bpc-web-components/blob/main/docs/address-entry-design-principles.md) and [evaluation cases](https://github.com/BasePowerCompany/bpc-web-components/blob/main/src/address-search/EVAL.md) | Actual signup edge cases and existing UX, classification, tests and evaluation work are visible. | That documented regressions remain unfixed, or that the repository is a complete design system. |

## A. Crew allocation and scheduling exceptions

**Current official signal, S1.** Most promising business-priority hypothesis. Existing booking and invitation balancing should be reused. Proposed users: deployment operators and operations software engineers; named requirement owner TBD.

Inputs for a credible pilot: anonymized jobs, visit duration, crew skills/availability, existing bookings, job readiness, travel-time matrix and explicit utility targets. A synthetic pilot can demonstrate feasibility, not real productivity savings. Compare with a simple nearest-ready-job/greedy assignment under identical constraints.

| ID | Candidate tool | Decision supported | Credible evaluation |
| --- | --- | --- | --- |
| A1 | Crew allocation what-if planner | Where should each available crew work next week? | Feasible completed jobs, drive time and target shortfalls versus the greedy baseline; infeasible targets stay visible. |
| A2 | Cancellation/weather recovery assistant | Which schedule changes restore capacity with least disruption? | Recovered slots, displaced bookings and operator time on replayed scenarios; existing commitments stay fixed unless explicitly released. |
| A3 | Schedule constraint explainer | Why cannot this job be assigned, and what change would unblock it? | Correct reasons for blocked jobs and consistent results after a stated constraint changes. |

Kill gate: no unresolved allocation decision, no trustworthy travel/duration inputs, or existing tools already solve the selected case. Do not optimize an illustrative radius as though it were measured driving time.

## B. Property qualification, permits and first-visit readiness

**Historical official signal, S2; recent community prototype, S7.** Proposed users: site reviewers, installer operations and commissioning engineers; named owner TBD. BaseScanning strengthens the case for a clear installation workflow, but does not prove that this is Base's largest bottleneck.

Start with a versioned checklist and labeled synthetic job packets. Compare against a manual checklist. Actual adoption requires a reviewer to label permitted examples and supply approved requirements. AI can extract evidence; a deterministic checklist and human reviewer govern the decision.

| ID | Candidate tool | Decision supported | Credible evaluation |
| --- | --- | --- | --- |
| B1 | Installation readiness checker | Is this packet ready for review, or what specific item is missing? | Missing-item recall, false-ready rate and review time on a held-out labeled set. |
| B2 | Guided photo/evidence capture | What photo or angle should the homeowner capture next? | Fewer missing views and retakes; unseen areas remain unknown. Begin with photos, without requiring a 3D reconstruction platform. |
| B3 | Permit packet QA | Does the packet contain the jurisdiction's required evidence? | Correctly flagged omissions with document/page citations, compared with checklist review. Keep jurisdiction and rule version explicit. |
| B4 | Commissioning log triage | Which failed step needs an engineer or another visit? | Correct routing and issue grouping on labeled logs versus keyword rules; unsupported diagnoses remain unconfirmed. |
| B5 | Installation exception inbox | Which blocked jobs need attention first? | Correct blocker/owner/action, interventions per job and time to resolution; link back to original evidence. |

Kill gate: the selected issue no longer occurs, source rules are unavailable, or the tool generates confident electrical approval from incomplete evidence. Do not copy BaseScanning's placeholder clearances into a real eligibility decision.

## C. Parts, logistics and hardware feedback

**Historical signal, S2; current severity unknown.** Proposed users: warehouse, deployment and quality engineers; named owner TBD. Improve a narrow existing workflow; another ERP is not the default answer.

Pilot inputs: synthetic bills of materials, job requirements, stock and promised arrivals. Compare against a spreadsheet stock check. Real improvements require accurate inventory and defect records.

| ID | Candidate tool | Decision supported | Credible evaluation |
| --- | --- | --- | --- |
| C1 | Job kit readiness checker | Which scheduled jobs lack a required part? | Exact missing-part detection; jobs falsely marked ready; uncertainty in arrivals. |
| C2 | Shortage scenario planner | Which allocation avoids the most blocked visits when a shipment is late? | Feasible jobs protected, shortage exposure and inventory held versus first-come allocation. |
| C3 | Defect/rework evidence linker | Do repeated failures share a part, batch or installation condition? | Correct links on labeled cases; precision of alerts; no causal claim from correlation alone. |

Kill gate: unreliable source inventory, no residual bottleneck, or no actionable response to a predicted shortage.

## D. Fleet availability and incident recovery

**Official relevance, S3; actual missing capability unknown.** Proposed users: fleet, edge and infrastructure engineers; named owner TBD. Existing Megawatt crash/restart work belongs here as an independent engineering sample.

Pilot inputs: synthetic device traces with deliberately injected faults. Baselines: threshold/last-seen rules, manual incident reading, and the existing volatile command implementation as appropriate. No proprietary systems are assumed.

| ID | Candidate tool | Decision supported | Credible evaluation |
| --- | --- | --- | --- |
| D1 | Incident timeline and regression fixture | What happened, and can the failure be reproduced? | Causal event order, source links and a reproducible injected failure. Existing bench is a starting point. |
| D2 | Offline-device recovery queue | Which unavailable devices deserve investigation first? | Recall of injected outages, false alarms, unavailable capacity and recovery time under labeled scenarios. |
| D3 | Uncertain-command reconciliation simulator | After a lost receipt, should a command retry, stop or wait for evidence? | Duplicate actions and missed delivery across crash boundaries. Physical exactly-once execution is not claimed. |
| D4 | Delivered-capacity discrepancy detector | Is the fleet delivering what its commands expected? | Error detection versus basic tolerance checks, including stale telemetry, losses and reserve constraints. |

Kill gate: no real incident/contract to target, synthetic success presented as hardware validation, or uncertain actions silently retried. Retain explicit expiry, freshness and reserve tests.

## E. Procurement exposure and model quality

**Official business relevance, S4; narrow residual gaps unverified.** Proposed users: Markets engineers; named owner TBD. Existing Base risk dashboards and modeling should not be recreated without a concrete gap.

Pilot inputs: public price/weather series and explicitly synthetic household loads. Baselines: persistence forecasts and historical scenarios. Keep time-based holdouts and prevent future data leakage. Hub data cannot stand in for all settlement prices.

| ID | Candidate tool | Decision supported | Credible evaluation |
| --- | --- | --- | --- |
| E1 | Forecast residual/calibration auditor | In which conditions is a forecast least dependable? | Error and interval coverage by period/condition on held-out days, compared with persistence. |
| E2 | Correlated load/price stress explorer | Which assumptions drive the largest modeled exposure? | Preserve paired historical observations; compare with incorrectly independent sampling; report synthetic exposure only. |
| E3 | Grid-data quality validator | Is this price/load input usable before a model consumes it? | Detect injected missing intervals, duplicates, timezone/unit errors and revisions without silently filling them. |

Kill gate: invented revenue floors, one perfect-foresight day promoted as economics, or no decision changed by the analysis. Multi-day dispatch comparisons remain candidate research, not the assumed flagship project.

## F. Deployment location and market participation

**Official strategic relevance, S5; decision inputs unavailable.** Proposed users: Markets, growth/deployment planning and utility partnership teams; named owner TBD.

Pilot inputs: public grid/utility/geographic data and documented mapping quality. Baseline: ranking by one explicit public signal. Real siting decisions need installation feasibility, customer suitability and actual grid/settlement mappings.

| ID | Candidate tool | Decision supported | Credible evaluation |
| --- | --- | --- | --- |
| F1 | Siting opportunity explorer | Which areas merit deeper investigation? | Transparent rankings, sensitivity to weights, coverage gaps and incorrect mappings; no customer profit claims. |
| F2 | Participation evidence packet | What evidence is missing before a resource can enter a program? | Checklist correctness using current official program documents; separate proposals from effective rules. |
| F3 | Portfolio coverage-gap viewer | Where does deployable capacity differ from an operational target? | Reproducible aggregation with missing/uncertain locations visible; target owner must supply the objective. |

Kill gate: no validated geographic mapping, program rules cannot be verified, or a colored map changes no planning decision.

## G. Outage forecasting and preparedness

**Official historical challenge, S8; current priority unknown.** Proposed users: reliability/Markets engineers; named owner TBD.

| ID | Candidate tool | Decision supported | Credible evaluation |
| --- | --- | --- | --- |
| G1 | Outage forecast evaluation harness | Is a forecast good enough to inform preparedness? | Compare climatology/persistence with a simple model on chronological and geographic holdouts; report calibration, rare-event precision/recall and warning lead time. |

The public notebook is a six-cell data-exploration starter, not a validated predictor. First verify data coverage, timestamps, labels, provenance, license and continued availability. Reserve choices would need the cost of false alarms versus missed outages. Kill if valid labels/coverage are absent or the model adds no decision value over a simple baseline.

## H. Member understanding and support

**Our hypotheses, S6 supplies product context only.** Proposed users: members and support staff; named owner TBD. Base already offers backup-duration calculation; do not duplicate it blindly.

Pilot with synthetic telemetry/tickets and current public help articles. Compare with existing help/manual lookup. A non-customer can evaluate comprehension and failure handling, not live integration or support savings.

| ID | Candidate tool | Decision supported | Credible evaluation |
| --- | --- | --- | --- |
| H1 | Battery-state explanation | Why did charge change, and is the displayed information current? | Correct explanations for synthetic states, stale/unknown data shown clearly, comprehension in a short user test. |
| H2 | Backup uncertainty explanation | What assumptions change an estimate of remaining backup? | Bounds under stated load/reserve/loss assumptions; zero load, stale state and missing data handled; no runtime guarantee. |
| H3 | Source-grounded support draft assistant | Which published answer or escalation fits this issue? | Correct citations, refusal on unsupported questions and review time versus help search. Drafts only; no autonomous messages. |

Kill gate: no recurring customer confusion, the existing product solves it, or the feature turns uncertainty into false assurance. The unofficial Home Assistant integration is a learning source, not an approved API contract.

## I. Signup address quality and UX

**Current public implementation and regression evidence, S9.** Proposed users: prospective members and growth/product engineers; named owner TBD. Most direct publicly inspectable full-stack contribution route discovered so far.

Start with existing pure classifiers and synthetic validation payloads. Avoid paid Maps calls or Base account endpoints. Existing tests are the baseline; add a failing case only after reproducing a real gap.

| ID | Candidate tool | Decision supported | Credible evaluation |
| --- | --- | --- | --- |
| I1 | Address-state regression case explorer | Does each input produce the right prompt, editable field or redirect intent? | Minimal reproducible classification/routing mismatch and a focused regression test; rural and unit cases remain explicit. |
| I2 | Address-entry accessibility/async audit | Can keyboard users complete the flow, including errors and slow responses? | Reproducible focus, keyboard, loading and race failures with a small reviewed fix; measure task completion locally. |

Kill gate: no reproduced defect, wholesale rewrites, paid API dependence for the demo, or assuming a public repository permits copying without checking its license.

## J. Company hypotheses needing internal evidence

These might matter more than any visible software issue. They are **not diagnosed Base problems**. No current firsthand severity data was reviewed. Named owners TBD.

| ID | Candidate tool | What must be established first | Baseline / evidence |
| --- | --- | --- | --- |
| J1 | Manufacturing yield/quality exception analyzer | Which actual line defect limits usable output? | Existing quality process; labeled defect data and measured reduction in diagnosis time. |
| J2 | Deployment capital/cash-cycle scenario worksheet | Does financing or cash timing constrain installations? | Existing finance model; actual approved assumptions; sensitivity analysis rather than invented unit economics. |
| J3 | Developer failure-to-regression assistant | Which recurring CI/integration issue wastes engineering time? | Existing incident/test workflow; historical failures and a reproducible test. AI drafts reviewed fixtures rather than auto-merging code. |

## Shortlist for the next decision

| Route | Why investigate it | Smallest credible 48-hour shape | What could disqualify it |
| --- | --- | --- | --- |
| **I1/I2: improve existing Base web-component code** | Best direct match to full-stack work and publicly inspectable code. | One reproduced defect, small local patch, focused test and before/after evidence. | No real defect found; unclear reuse/contribution terms; maintaining it requires inaccessible dependencies. |
| **B1/B2: installation evidence readiness** | Clear user/task; BaseScanning demonstrates a strong product framing. | One synthetic packet, missing-evidence list and reviewer view; compare with a checklist. | No validated requirements, redundant product, or unsafe automated approval. |
| **A1: crew allocation** | Strongest current official next-work signal. | One anonymized/synthetic planning scenario with identical constraints for greedy and improved assignment. | No actual operator decision or inputs; toy gains fail on realistic constraints. |
| **D1/D3: existing Megawatt reliability fixture** | Already bounded, reproducible and testable without private data. | Convert one specific failure into a regression case and explain retry/hold outcomes. | No actual Base gap or owner; improves the demo without helping the company. |

These are priorities for learning, not numerical ROI rankings. The public web repo creates a route we should investigate before building a new platform.

## Apply the ordered algorithm

| # | Item | Verdict | Why | Owner |
| --- | --- | --- | --- | --- |
| 1 | Record the evidence and candidate backlog | KEEP | Makes the choice reviewable and prevents repeatedly rebuilding speculative ideas. | Adam |
| 2 | Build a guaranteed hackathon winner | DELETE | No counterfactual result or full judging rubric exists. | Adam's earlier ambition; no Base owner |
| 3 | Build all 30 tools | DELETE from execution scope | A backlog is an option set; no demonstrated need supports 30 builds. | Adam; adoption owners TBD |
| 4 | Replace Base's scheduler, ERP, telemetry or risk dashboard | DELETE from default scope | Existing capabilities are documented; duplication needs a specific unresolved failure. | [TBD: named Base maintainer] |
| 5 | Copy BaseScanning's entire platform | DELETE | Does not establish an original contribution or validated requirements. | Adam |
| 6 | Diagnose one existing public-code gap | SURVIVES as research | A reproduced failure can justify a small patch without proprietary claims. | Adam for prototype; Base maintainer TBD |
| 7 | Preserve uncertainty, source provenance and human review | SURVIVES for any decision prototype | Missing evidence must not become an unsupported approval or savings claim. | Adam; domain reviewer TBD |

**Deleted:** prize guarantees, all-tool execution, default replacements and platform copying. Add back scope only when a named user supplies a concrete unresolved decision and acceptance criteria.

**Survivors:** Adam's research record and investigation of one existing-code gap. Simplify to one input, one decision and one comparable outcome. Accelerate by checking that failure locally before polishing a site. Automate only a manually validated repeating workflow.

**The 10% check:** the first pass removed four scope assumptions without an add-back, so it failed the skill's deletion check. A harder review also proposed removing rule provenance and the unknown/missing-evidence state. Both must be restored: the inspected placement rules contain placeholders, and unobserved geometry cannot support a clearance decision. That is two restorations out of six considered deletions (33%). This is a conceptual requirements review, not an executed deletion experiment. The earlier fixture's empirical add-back check is recorded in [the decision document](base-project-decision.md).

**Next physical action:** Adam can open `bpc-web-components`' address-entry principles and classifier tests, trace one difficult input through the current code, and record whether a real failure exists before selecting the next build.
