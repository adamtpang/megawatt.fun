# What would make this useful to an operator?

The current artifact compares 15 settlement-point markets, screens three county cohorts, and lets a reviewer score property/grid scenarios under explicit weights. It cannot select 10,000 installable addresses or quote Base customer economics. Software cannot manufacture the missing evidence.

## Market module checks (October 19, 2026)

- Raw annual archives validated offline: 15 series × 8,760 physical hours, each matched to four RTM intervals. DST and settlement-point types retained; LZEW excluded.
- 33 Node tests and five Python tests pass. Coverage includes reserve/loss conservation, negative cashflow, all monthly ledgers, weight direction/sensitivity, missing-input exclusions, duplicate intervals, DST, cache hashes and same-document price corrections. TypeScript declarations pass strict checking.
- Replaying the dataset produces byte-identical results, market diagnostics and a 180-row monthly CSV. LZ_WEST loses money in December 2025 and February, May and June 2026; none are clipped.
- Local desktop/mobile browser checks: all 15 points selectable, twelve monthly rows, synthetic candidate A → B when energy receives all weight, all-zero weights remove results, no page overflow at 390 px. Property fields start missing, not prequalified.
- These checks validate software behavior and reproducibility, not a commercial forecast. No operator review, real property qualification, paid AI call or public release was performed.

## One short user test

Intended reviewer: a deployment or utility-partner engineer. Ask them to select the county they would investigate first, change the energy/size weight, and explain why their choice did or did not change. Then ask which missing input could reverse the decision. Success means they can distinguish price-zone value, market size and actual installation eligibility without the builder coaching them. This test has not yet been conducted; no Base adoption is claimed.

Ask these four questions before building another view:

1. What decision do you make today, and what happens if you choose the wrong site?
2. Which records tell you a site is eligible and installable, and how stale may they be?
3. Is energy cashflow useful at this stage, or are feeder headroom, installation throughput and utility rules the binding constraints?
4. What would make you reject this shortlist even if its price data were correct?

## Minimum evidence contract for a real pilot

| Input | Minimum fields | Acceptance check |
|---|---|---|
| Qualified cohort | Opaque cohort ID, eligible count, geography, utility territory, evidence date/source | Counts are verified installations or prospects; never substitute county housing totals |
| Electrical location | Settlement point, feeder/substation reference, capacity or constraint, responsible reviewer | Mapping is confirmed; unresolved sites remain excluded |
| Install feasibility | Siting/electrical approval, crew capacity, permit status, expected installation cost | Every exclusion has a reason; no fabricated addresses |
| Load and tariff | Consented interval load, time zone, tariff effective dates, export and demand-charge rules | Missing intervals and DST explicitly checked; synthetic profiles remain separate |
| Fleet contract | Ownership, revenue share, service commitments, reserve obligations, operating costs | Finance/operator approves the interpretation; no independent stacking of incompatible services |
| Outcome | Actual install, curtailment, availability, cash ledger and review date | Compare prospective recommendations against realized outcomes and the baseline |

Use anonymized aggregates for a public demonstration. Customer addresses, meter identifiers and private terms belong in an approved private environment, not this static site or Franklin prompts.

## Pilot boundary

Start with three verified cohorts and an exported decision report. Validate prospective performance over unseen months and use a dispatch rule that respects simultaneous service commitments. Obtain an operator review before using the ranking to spend money or schedule installations. Only then add a real allocation optimizer, live fleet controls or more geographical coverage.

## Franklin deployment boundary

Guide mode is sufficient for the demo. For a public AI connection, use a server-side provider with a spending cap, shared durable rate limiting, request-size limits and observed failure behavior. Never attach a public page to a personal coding-agent shell. Local Codex or Claude can assist development and private analysis, but this adapter deliberately has no shell or file tools. The present OpenRouter adapter remains disabled; no model purchase or paid request is required to reproduce any result.
