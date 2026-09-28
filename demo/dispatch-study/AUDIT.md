# Dispatch audit — 2026-09-08

| Finding | Evidence in original code | Resolution / remaining limit |
|---|---|---|
| Single supplied day / foresight | `PlanDay` sorts all prices before choosing actions; `main.go` passes one CSV and reports 365 times that day's result | Verified. Study separates forecast scheduling from realized settlement and evaluates multiple synthetic days. Still one committed closed cycle per day, explicitly documented. |
| Unsupported revenue floor | Package comment, README and index claimed a floor despite perfect foresight | Removed in active README, CLI and index. Omitted value streams do not cancel optimistic execution assumptions in a provable way. |
| Not always the best single cycle | Full-capacity fill at every boundary could add negative marginal trades | Fixed marginal buy/sell matching. `[0,50,0,50,0,50]`, 3 kWh/1 kW/100%: old $0.05 versus corrected $0.10. |
| No household reserve/state verification | Capacity bounds only inside charge/discharge allocation; no reserve input or realized replay | Added `PlanWithReserve` and independently accounted `Replay`; endpoint inventory equal to reserve. No outage coverage claim. |
| Losses already present | `RoundTripEff` reduced discharge energy | Confirmed; not claiming losses are newly introduced. Study measures sensitivity and checks conservation under the existing convention. |
| Implicit duration | `fill` treats kW as interval kWh | Explicit hourly-only contract retained. Non-hourly data is not supported; labels are not parsed as durations. |
| Invalid inputs | Nonfinite values and duplicate labels previously accepted | Battery and planner/replay price validation hardened. General CSV header handling and ERCOT schema completeness are not comprehensively hardened in this change. |
| Single-day economics extrapolated | Fleet multiplication and annualization; capex prose inferred investment conclusions | Annualized CLI removed; fleet multiplication labeled arithmetic. Capex presets remain unverified assumptions. |
| Historical provenance incomplete | Vendored CSV and a trimmed three-row parser fixture with a claimed timestamp exist, but no complete raw capture found | Synthetic data generated and exported separately; old CSV not represented as independently verified. |

The existing suite passed before changes. The new regression, independent discrete exhaustive oracle, randomized energy conservation and replay rejection tests supplement it. The supplied handoffs establish that the project was built with coding-agent assistance; this packet should not be represented as unaided work. The repository demonstrates a small Go planner, parser, tests and static presentation, not deployed physical control or production fleet operations.

No existing user changes to `kardashev.html`, `style.css`, `repos.yaml`, or other unrelated files were edited. No commits, pushes, publication, deployment, paid services or messages were performed.

