# Base project decision: question before improving

Reviewed October 4, 2026. This is the project author's decision record, not a Base-approved requirement or prediction of a prize.

## Evidence

- [Official event brief](https://luma.com/aitx-94j6): three tracks, Base engineer judges, a hiring event. Open Grid Data asks for useful grid data; Orchestration asks for coordination that holds up under failure; Most Commercializable asks for a product with a defined user/problem. No detailed scoring rubric, requirement to cover all tracks, or complete official winner list was found in the reviewed sources.
- [BaseScanning's own repository](https://github.com/SamGu-NRX/BaseScanning) reports first place in Most Commercializable. Its product helps scan a home and assess installation placement. This is a participant-reported outcome, not independent proof of all its performance claims. It disproves our earlier premise that the field had no homeowner-facing entries.
- [Base's September 22 installation post](https://inside.basepowercompany.com/self-scheduling), by Colin Cassens, reports a scheduling queue reduced from four weeks to a few days. Its stated next work includes programmatic allocation of crews and ingesting constraints/targets. Rebuilding scheduling from scratch would duplicate already-shipped work.
- [Base's telemetry post](https://inside.basepowercompany.com/building-a-telemetry-stack), by Andrew Hitchcock, describes durable SQLite edge storage, commands that expire, and unreliable connections. It establishes relevance of command durability, not a missing Base capability or sponsorship of this fixture.

## 1. Question

| # | Item | Verdict | Why | Owner |
| --- | --- | --- | --- | --- |
| 1 | Make this a guaranteed winner | DELETE | No scoring evidence can establish the counterfactual | Adam; judge criteria beyond brief unknown |
| 2 | Cover all three tracks | DELETE | Official brief does not require it; dilutes the demo | Prior project prompt; no Base owner |
| 3 | Ship a customer-facing dispatch dashboard | DELETE as the objective | No identified customer decision or validated request | [TBD: a Base customer/product owner] |
| 4 | Add forecasts, profit projections and more fleet knobs | DELETE from the next increment | They do not test restart behavior; economics remain unvalidated | Prior project prompt; no Base owner |
| 5 | Copy Base's private control architecture | DELETE | No access or integration contract; public resemblance is insufficient | No Base owner |
| 6 | Demonstrate command behavior under process death | KEEP as an independent hypothesis | Existing in-memory replay cannot test it; falsifiable with actual child processes | Adam for demo; Base adoption owner TBD |
| 7 | Keep reserve, expiry, freshness and an auditable trace | KEEP | Dropping these permits unsafe or misleading test results | Adam for demo; Andrew's post is evidence, not approval |

## 2. Delete

Delete the prize guarantee, all-track pitch, customer-product promise, additional forecasting/economic scope, and proprietary-controller premise. Preserve the old price replay as secondary evidence so its audit and reproducibility are not lost. Add any deleted feature back only when a named user supplies a concrete decision, input contract and acceptance test.

The 10% check: five scope requirements stay deleted. We also attempted to delete expiry and telemetry freshness in temporary copies of the fixture. Both deletions permitted invalid actions: an expired command and a command with stale telemetry were applied. Restore those two checks, with their regression tests. Two of seven attempted deletions were added back (29%). This is a real counterexample check, not an arbitrary feature quota. Local reserve remains a separately tested physical constraint.

## 3. Simplify

The survivor: an offline command-contract fixture, with a non-idempotent synthetic actuator, a volatile baseline, a SQLite receipt ledger, and actual child-process crash/restart. One decision: after losing a receipt, should this command be retried, ignored or held for reconciliation?

Both baselines enforce identical physical reserve/loss constraints. SQLite cannot make a hardware action and a receipt atomic: a crash after action but before receipt leaves uncertainty. The durable fixture pauses that command instead of blindly repeating it. Show missed delivery as well as repeated actions. Do not call this exactly-once physical execution.

## Alternatives and selection

- Installation readiness / crew allocation: stronger evidence of a commercial workflow and a participant-reported winner. Best candidate if an event engineer identifies an unresolved constraint and supplies usable inputs. We lack installation rules, real demand, crew capacity and owner feedback; do not fabricate them or declare a copied scheduler useful.
- Battery siting / grid opportunity analysis: potentially valuable, but a hub-price toy cannot establish local installation value. Requires real decision criteria, settlement/location mappings and uncertainty treatment.
- Durable fault fixture: strongest bounded next contribution for the existing repository. It reuses the bench's command-safety question, reduces dependence on invented economics, and can produce genuine failure evidence without private systems. This is our choice for improving the demonstration, not proof it is Base's highest-priority work.

## 4. Accelerate

One command runs the offline cases. Another runs regression tests. The website displays saved results with their source and downloadable code; a button never pretends to kill a production worker. Review the worst boundary first: actuator acted, worker died before receipt, same command retried.

## 5. Automate last

Automate the repeatable local crash/retry matrix after manually checking the failure boundary and baseline. Do not add agents, a queue service, cloud batteries or deployment infrastructure to the fixture. No external workflows are automated.

## Acceptance and adoption gate

Current acceptance: same ID/payload is not blindly re-applied after restart; changed payload under the same ID is rejected; unknown outcome is explicit; expired/stale commands have no effect; concurrent claimants do not produce two actions; physical energy respects reserve and losses; results reproduce from source.

Before Base could adopt it: a named engineer chooses an actual gap and contract; their device/transport adapter replaces the fake; real time/clock, authentication, command supersession, cancellation, uncertain-action reconciliation, disk failure and device recovery rules are specified; their historical incidents and hardware-in-loop tests pass; maintainers review/own it. Nothing here implies those gates have passed.

Next physical action: Adam can run `python demo/dispatch-bench/restart_fixture.py` and record a 90-second demonstration of the ambiguous receipt boundary. For an in-person event, ask an engineer which recent failure they most want made into a regression test before expanding scope. No message is sent by Codex.
